import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen as rtl, fireEvent, within } from "@testing-library/react";
import { LangProvider } from "../../lib/i18n";
import StyleFields from "./StyleFields";

beforeEach(() => localStorage.setItem("panel-lang", "ko"));

function setup(value: unknown, layout = false) {
  const onCommit = vi.fn();
  render(
    <LangProvider>
      <StyleFields value={value} layout={layout} onCommit={onCommit} />
    </LangProvider>,
  );
  return onCommit;
}

describe("StyleFields (스타일 토큰 폼 — T4.3)", () => {
  it("토큰 셀렉트는 즉시 커밋한다", () => {
    const onCommit = setup(undefined);
    fireEvent.change(rtl.getByLabelText("바깥 여백"), { target: { value: "4" } });
    expect(onCommit).toHaveBeenLastCalledWith({ m: "4" });
  });

  it("기본(빈 옵션) 선택은 키를 해제하고, 마지막 키 해제는 undefined(=style 제거)", () => {
    const onCommit = setup({ m: "4", p: "2" });
    fireEvent.change(rtl.getByLabelText("바깥 여백"), { target: { value: "" } });
    expect(onCommit).toHaveBeenLastCalledWith({ p: "2" });
  });

  it("유일 키를 해제하면 undefined로 커밋한다", () => {
    const onCommit = setup({ m: "4" });
    fireEvent.change(rtl.getByLabelText("바깥 여백"), { target: { value: "" } });
    expect(onCommit).toHaveBeenLastCalledWith(undefined);
  });

  it("방향별 접이식: 값이 없으면 접힘, 토글로 펼침, 방향 값이 있으면 초기 펼침", () => {
    const onCommit = setup(undefined);
    expect(rtl.queryByLabelText("mx")).toBeNull();
    fireEvent.click(rtl.getByRole("button", { name: "방향별" }));
    fireEvent.change(rtl.getByLabelText("mx"), { target: { value: "3" } });
    expect(onCommit).toHaveBeenLastCalledWith({ mx: "3" });
  });

  it("방향 키가 이미 있으면 접이식이 처음부터 펼쳐진다", () => {
    setup({ mt: "2" });
    expect(rtl.getByLabelText("mt")).toHaveValue("2");
  });

  it("gap·align·justify는 layout 블록에서만 노출된다", () => {
    setup(undefined, false);
    expect(rtl.queryByLabelText("간격")).toBeNull();
    expect(rtl.queryByLabelText("교차축 정렬")).toBeNull();
  });

  it("layout 블록에서는 gap 커밋이 동작한다", () => {
    const onCommit = setup(undefined, true);
    fireEvent.change(rtl.getByLabelText("간격"), { target: { value: "3" } });
    expect(onCommit).toHaveBeenLastCalledWith({ gap: "3" });
  });

  it("grow 토글: 켜면 true, 끄면 키 제거(부재=기본)", () => {
    const on = setup(undefined);
    fireEvent.click(rtl.getByLabelText("남는 공간 채우기"));
    expect(on).toHaveBeenLastCalledWith({ grow: true });
  });

  it("grow 해제는 undefined로 커밋한다", () => {
    const onCommit = setup({ grow: true });
    fireEvent.click(rtl.getByLabelText("남는 공간 채우기"));
    expect(onCommit).toHaveBeenLastCalledWith(undefined);
  });

  it("색 토큰 세그먼트: 클릭=커밋, 재클릭=해제", () => {
    const onCommit = setup({ bg: "card" });
    const group = rtl.getByRole("group", { name: "배경색" });
    fireEvent.click(within(group).getByRole("button", { name: "accent" }));
    expect(onCommit).toHaveBeenLastCalledWith({ bg: "accent" });
    fireEvent.click(within(group).getByRole("button", { name: "card" }));
    expect(onCommit).toHaveBeenLastCalledWith(undefined); // 활성 토큰 재클릭 = 해제
  });

  it("hex는 blur 커밋, 유효값만 통과한다", () => {
    const onCommit = setup(undefined);
    const input = rtl.getByLabelText("글자색 hex");
    fireEvent.change(input, { target: { value: "#12ab34" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenLastCalledWith({ fg: "#12ab34" });
  });

  it("무효 hex는 커밋을 차단하고 에러를 표기한다", () => {
    const onCommit = setup(undefined);
    const input = rtl.getByLabelText("배경색 hex");
    fireEvent.change(input, { target: { value: "red" } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(rtl.getByText("형식: #RRGGBB")).toBeInTheDocument();
  });

  it("hex 입력을 비우고 blur하면 hex 값만 해제한다", () => {
    const onCommit = setup({ bg: "#112233" });
    const input = rtl.getByLabelText("배경색 hex");
    expect(input).toHaveValue("#112233");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenLastCalledWith(undefined);
  });

  it("무효 style 값(비객체)은 빈 폼으로 관용한다(resolveStyle과 동일)", () => {
    setup("garbage");
    expect(rtl.getByLabelText("바깥 여백")).toHaveValue("");
  });
});
