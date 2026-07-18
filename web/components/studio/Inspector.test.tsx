import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen as rtl, fireEvent } from "@testing-library/react";
import { LangProvider } from "../../lib/i18n";
import type { Block } from "../../lib/builder/schema";
import type { BlockPath } from "../../lib/builder/editOps";
import type { FieldSpec } from "../../lib/builder/registry";
import Inspector, { FieldWidget } from "./Inspector";

beforeEach(() => localStorage.setItem("panel-lang", "ko"));

// 고정 화면 트리 — 직접 입력 text([0]) / logo([1]) / 사전 키+표시명 text([2]).
const screenRoot: Block = {
  type: "vstack",
  props: { key: "root" },
  children: [
    { type: "text", props: { key: "t1", ko: "안녕", en: "hi" } },
    { type: "logo", props: { key: "l1" } },
    { type: "text", props: { key: "t2", i18n: "panel.title", name: "제목 텍스트" } },
  ],
};

function setup(selected: BlockPath | null, screen: Block = screenRoot) {
  const cbs = { onUpdateProps: vi.fn(), onRemove: vi.fn() };
  render(
    <LangProvider>
      <Inspector screen={screen} selected={selected} {...cbs} />
    </LangProvider>,
  );
  return cbs;
}

describe("Inspector (schema-driven 일반 폼 — T5.1)", () => {
  it("선택이 없으면 안내 문구만 보인다", () => {
    setup(null);
    expect(rtl.getByText("캔버스나 구조 트리에서 블록을 선택하세요.")).toBeInTheDocument();
  });

  it("헤더는 displayName(props.name 우선, 없으면 레지스트리 라벨)을 쓴다", () => {
    setup([2]);
    expect(rtl.getByText("제목 텍스트")).toBeInTheDocument();
  });

  it("이름 필드는 renameProps 규칙(트림)으로 커밋한다", () => {
    const cbs = setup([0]);
    const input = rtl.getByLabelText("표시 이름");
    fireEvent.change(input, { target: { value: "  새 이름  " } });
    fireEvent.blur(input);
    expect(cbs.onUpdateProps).toHaveBeenCalledWith([0], {
      key: "t1",
      ko: "안녕",
      en: "hi",
      name: "새 이름",
    });
  });

  it("루트 선택: 제목은 '화면', 이름·삭제는 없고 스타일 폼(layout 필드 포함)은 있다", () => {
    setup([]);
    expect(rtl.getByText("화면")).toBeInTheDocument();
    expect(rtl.queryByLabelText("표시 이름")).toBeNull();
    expect(rtl.queryByRole("button", { name: "블록 삭제" })).toBeNull();
    expect(rtl.getByLabelText("간격")).toBeInTheDocument(); // vstack = layout
  });

  it("삭제 버튼은 onRemove를 호출한다", () => {
    const cbs = setup([0]);
    fireEvent.click(rtl.getByRole("button", { name: "블록 삭제" }));
    expect(cbs.onRemove).toHaveBeenCalledWith([0]);
  });

  // ── text 블록: 기존 수기 폼과 동작 동등성(회귀 고정) ──────────────────────
  it("text(직접 입력): 사전 키는 빈 옵션, ko/en 입력 노출, 모양 기본은 body", () => {
    setup([0]);
    expect(rtl.getByLabelText("사전 키")).toHaveValue("");
    expect(rtl.getByLabelText("문구(한국어)")).toHaveValue("안녕");
    expect(rtl.getByLabelText("문구(영어)")).toHaveValue("hi");
    expect(rtl.getByLabelText("모양")).toHaveValue("body");
  });

  it("text: ko 문구 blur 커밋", () => {
    const cbs = setup([0]);
    const input = rtl.getByLabelText("문구(한국어)");
    fireEvent.change(input, { target: { value: "반가워" } });
    fireEvent.blur(input);
    expect(cbs.onUpdateProps).toHaveBeenCalledWith([0], { key: "t1", ko: "반가워", en: "hi" });
  });

  it("text: 모양 선택은 즉시 커밋", () => {
    const cbs = setup([0]);
    fireEvent.change(rtl.getByLabelText("모양"), { target: { value: "title" } });
    expect(cbs.onUpdateProps).toHaveBeenCalledWith([0], {
      key: "t1",
      ko: "안녕",
      en: "hi",
      variant: "title",
    });
  });

  it("text(사전 키 사용): ko/en 입력은 숨고, 키 해제 시 i18n이 제거된다", () => {
    const cbs = setup([2]);
    expect(rtl.getByLabelText("사전 키")).toHaveValue("panel.title");
    expect(rtl.queryByLabelText("문구(한국어)")).toBeNull();
    expect(rtl.queryByLabelText("문구(영어)")).toBeNull();
    fireEvent.change(rtl.getByLabelText("사전 키"), { target: { value: "" } });
    expect(cbs.onUpdateProps).toHaveBeenCalledWith([2], { key: "t2", name: "제목 텍스트" });
  });

  // ── logo 블록: 숫자 필드 동등성 + 스타일 미지원 안내 ──────────────────────
  it("logo: 크기 미지정 시 44를 표시하고, blur 커밋은 [16,128]로 클램프한다", () => {
    const cbs = setup([1]);
    const input = rtl.getByLabelText("크기(px)");
    expect(input).toHaveValue(44);
    fireEvent.change(input, { target: { value: "300" } });
    fireEvent.blur(input);
    expect(cbs.onUpdateProps).toHaveBeenCalledWith([1], { key: "l1", size: 128 });
  });

  it("logo(noStyle): 스타일 폼 대신 미지원 안내를 표기한다", () => {
    setup([1]);
    expect(rtl.getByText("이 블록은 아직 스타일을 지원하지 않습니다.")).toBeInTheDocument();
    expect(rtl.queryByLabelText("바깥 여백")).toBeNull();
  });

  // ── 스타일 폼 배선(공통 섹션) ─────────────────────────────────────────────
  it("text(element): 스타일 폼은 있고 layout 한정 필드(간격)는 없다", () => {
    setup([0]);
    expect(rtl.getByLabelText("바깥 여백")).toBeInTheDocument();
    expect(rtl.queryByLabelText("간격")).toBeNull();
  });

  it("스타일 변경은 다른 props를 보존한 채 props.style로 커밋된다", () => {
    const cbs = setup([0]);
    fireEvent.change(rtl.getByLabelText("바깥 여백"), { target: { value: "2" } });
    expect(cbs.onUpdateProps).toHaveBeenCalledWith([0], {
      key: "t1",
      ko: "안녕",
      en: "hi",
      style: { m: "2" },
    });
  });

  it("스타일을 전부 해제하면 style 키 자체가 제거된다", () => {
    const screen: Block = {
      ...screenRoot,
      children: [{ type: "text", props: { key: "t1", ko: "안녕", style: { m: "2" } } }],
    };
    const cbs = setup([0], screen);
    fireEvent.change(rtl.getByLabelText("바깥 여백"), { target: { value: "" } });
    expect(cbs.onUpdateProps).toHaveBeenCalledWith([0], { key: "t1", ko: "안녕" });
  });
});

// ── FieldWidget 단독: 아직 블록 메타에 없는 kind(toggle·multiEnum)의 커밋 규약 ──
describe("FieldWidget (kind별 커밋)", () => {
  function setupWidget(f: FieldSpec, value: unknown) {
    const onCommit = vi.fn();
    render(
      <LangProvider>
        <FieldWidget f={f} value={value} onCommit={onCommit} />
      </LangProvider>,
    );
    return onCommit;
  }

  const toggleSpec: FieldSpec = { kind: "toggle", prop: "x", label: { ko: "토글", en: "Toggle" } };

  it("toggle: 켜면 true", () => {
    const onCommit = setupWidget(toggleSpec, undefined);
    fireEvent.click(rtl.getByLabelText("토글"));
    expect(onCommit).toHaveBeenLastCalledWith(true);
  });

  it("toggle 해제는 undefined(키 제거)로 커밋한다", () => {
    const onCommit = setupWidget(toggleSpec, true);
    fireEvent.click(rtl.getByLabelText("토글"));
    expect(onCommit).toHaveBeenLastCalledWith(undefined);
  });

  const multiSpec: FieldSpec = {
    kind: "multiEnum",
    prop: "sections",
    label: { ko: "구성", en: "Sections" },
    options: [
      { v: "a", label: { ko: "가", en: "A" } },
      { v: "b", label: { ko: "나", en: "B" } },
      { v: "c", label: { ko: "다", en: "C" } },
    ],
  };

  it("multiEnum: 체크는 options 순서로 정규화되고, 해제도 커밋된다", () => {
    const onCommit = setupWidget(multiSpec, ["c", "a"]);
    fireEvent.click(rtl.getByLabelText("나")); // b 추가 → options 순서로 정규화
    expect(onCommit).toHaveBeenLastCalledWith(["a", "b", "c"]);
    fireEvent.click(rtl.getByLabelText("가")); // a 해제(원값 [c,a] 기준)
    expect(onCommit).toHaveBeenLastCalledWith(["c"]);
  });

  it("multiEnum: 마지막 체크 해제는 undefined로 커밋한다", () => {
    const onCommit = setupWidget(
      { ...multiSpec, options: [{ v: "a", label: { ko: "가", en: "A" } }] },
      ["a"],
    );
    fireEvent.click(rtl.getByLabelText("가"));
    expect(onCommit).toHaveBeenLastCalledWith(undefined);
  });
});
