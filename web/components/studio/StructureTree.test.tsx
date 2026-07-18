import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen as rtl, fireEvent } from "@testing-library/react";
import { LangProvider } from "../../lib/i18n";
import type { Block, TabSpec } from "../../lib/builder/schema";
import StructureTree from "./StructureTree";

beforeEach(() => localStorage.setItem("panel-lang", "ko"));

// 고정 화면 트리 — 표시명(props.name) 있는 행과 없는 행을 섞는다.
const screenRoot: Block = {
  type: "vstack",
  props: { key: "root" },
  children: [
    { type: "text", props: { key: "t1", name: "환영 문구" } },
    { type: "logo", props: { key: "l1" } },
  ],
};

// 탭 3종: 유령(chat — content 없음) / 편집 가능(info — 명시 content) / 유령+비활성(perf).
const tabs: TabSpec[] = [
  { id: "chat", label: { ko: "채팅", en: "Chat" } },
  { id: "info", label: { ko: "정보", en: "Info" }, content: [{ type: "text", props: { key: "x", ko: "hi" } }] },
  { id: "perf", label: { ko: "성능", en: "Performance" }, enabled: false },
];

function setup() {
  const cbs = {
    onSelect: vi.fn(),
    onMove: vi.fn(),
    onRemove: vi.fn(),
    onRename: vi.fn(),
    onMaterialize: vi.fn(),
    onContextMenu: vi.fn(),
  };
  render(
    <LangProvider>
      <StructureTree screen={screenRoot} tabs={tabs} selected={null} {...cbs} />
    </LangProvider>,
  );
  return cbs;
}

describe("StructureTree (scoped sections)", () => {
  it("renders the screen section plus one section per tab, labels via displayName", () => {
    setup();
    expect(rtl.getByText("화면")).toBeInTheDocument(); // 화면 섹션 헤더
    expect(rtl.getByText("환영 문구")).toBeInTheDocument(); // props.name 우선
    expect(rtl.getByText("로고")).toBeInTheDocument(); // name 없음 → 레지스트리 라벨
    expect(rtl.getByText("정보")).toBeInTheDocument(); // 탭 헤더(라벨)
    // perf: 탭 헤더 라벨 + 유령 행(perf-view 라벨)이 모두 "성능"
    expect(rtl.getAllByText("성능").length).toBeGreaterThanOrEqual(2);
    // chat: 탭 헤더 라벨 + 유령 행(chat-feed 라벨)이 모두 "채팅"
    expect(rtl.getAllByText("채팅").length).toBeGreaterThanOrEqual(2);
  });

  it("shows ghost tabs as default-content rows with a materialize button", () => {
    const cbs = setup();
    // 유령 섹션은 chat·perf 2곳 — 배지·버튼이 각각 존재
    expect(rtl.getAllByText("기본 구성")).toHaveLength(2);
    const buttons = rtl.getAllByRole("button", { name: "편집 시작" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]);
    expect(cbs.onMaterialize).toHaveBeenCalledWith("chat");
    // 유령 행에는 삭제·드래그 버튼이 없다(비편집) — 삭제 버튼은 화면 2행 + info 1행뿐
    expect(rtl.getAllByLabelText("블록 삭제")).toHaveLength(3);
  });

  it("dims a disabled tab section only", () => {
    setup();
    // 섹션 판별은 헤더의 mono 탭 id로 한다(라벨 텍스트는 블록 라벨과 겹칠 수 있다).
    expect(rtl.getByText("perf").closest(".opacity-60")).not.toBeNull();
    expect(rtl.getByText("chat").closest(".opacity-60")).toBeNull();
  });

  it("selects scoped paths: section roots from headers, rows from labels", () => {
    const cbs = setup();
    fireEvent.click(rtl.getByText("화면"));
    expect(cbs.onSelect).toHaveBeenLastCalledWith({ scope: { kind: "screen" }, path: [] });
    fireEvent.click(rtl.getByText("정보"));
    expect(cbs.onSelect).toHaveBeenLastCalledWith({ scope: { kind: "tab", tabId: "info" }, path: [] });
    // info 탭의 text 행 — name 없음 → 라벨 "텍스트"(화면의 text 행은 name이 있어 유일)
    fireEvent.click(rtl.getByText("텍스트"));
    expect(cbs.onSelect).toHaveBeenLastCalledWith({ scope: { kind: "tab", tabId: "info" }, path: [0] });
  });

  it("removes with the scoped path", () => {
    const cbs = setup();
    const dels = rtl.getAllByLabelText("블록 삭제"); // DOM 순서: 화면[0],화면[1],info[0]
    fireEvent.click(dels[2]);
    expect(cbs.onRemove).toHaveBeenCalledWith({ scope: { kind: "tab", tabId: "info" }, path: [0] });
  });

  it("renames via double-click: Enter commits the input value with the scoped path", () => {
    const cbs = setup();
    fireEvent.doubleClick(rtl.getByText("환영 문구"));
    const input = rtl.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("환영 문구"); // 현재 name이 초기값
    fireEvent.change(input, { target: { value: "메인 타이틀" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(cbs.onRename).toHaveBeenCalledWith(
      { scope: { kind: "screen" }, path: [0] },
      "메인 타이틀",
    );
    expect(rtl.queryByRole("textbox")).toBeNull(); // 입력 종료
  });

  it("renames via blur commit, including an empty value (clear request)", () => {
    const cbs = setup();
    fireEvent.doubleClick(rtl.getByText("환영 문구"));
    const input = rtl.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(cbs.onRename).toHaveBeenCalledWith({ scope: { kind: "screen" }, path: [0] }, "");
    expect(rtl.queryByRole("textbox")).toBeNull();
  });

  it("cancels a rename on Escape without committing", () => {
    const cbs = setup();
    fireEvent.doubleClick(rtl.getByText("로고"));
    const input = rtl.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe(""); // name 없는 행은 빈 입력에서 시작
    fireEvent.change(input, { target: { value: "임시" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(cbs.onRename).not.toHaveBeenCalled();
    expect(rtl.queryByRole("textbox")).toBeNull();
  });

  it("reports a row right-click with the scoped path and pointer coordinates (T6.3)", () => {
    const cbs = setup();
    // 행 요소는 data-treerow(=spathId)로 특정한다 — Shift+F10 앵커 조회와 같은 셀렉터.
    const row = document.querySelector('[data-treerow="t:info|0"]')!;
    const notCanceled = fireEvent.contextMenu(row, { clientX: 9, clientY: 8 });
    expect(notCanceled).toBe(false); // 브라우저 기본 메뉴 차단
    expect(cbs.onContextMenu).toHaveBeenCalledWith(
      { scope: { kind: "tab", tabId: "info" }, path: [0] },
      9,
      8,
    );
  });

  it("ghost rows are not wired for the context menu (T6.3 — 유령은 메뉴 미표시)", () => {
    const cbs = setup();
    expect(document.querySelector('[data-treerow^="t:chat"]')).toBeNull(); // 유령 행엔 행 마킹도 없다
    const ghostRow = document.querySelector(".border-dashed")!; // chat 유령 섹션의 점선 행
    const notCanceled = fireEvent.contextMenu(ghostRow);
    expect(notCanceled).toBe(true); // 가로채지 않음
    expect(cbs.onContextMenu).not.toHaveBeenCalled();
  });

  it("shows the empty hint for an editable tab without rows", () => {
    const cbs = {
      onSelect: vi.fn(),
      onMove: vi.fn(),
      onRemove: vi.fn(),
      onRename: vi.fn(),
      onMaterialize: vi.fn(),
    };
    // 미지 id + content 없음 = 기본 매핑 없음 → 유령이 아니라 "빈 편집 가능" 섹션
    render(
      <LangProvider>
        <StructureTree
          screen={screenRoot}
          tabs={[{ id: "shop", label: { ko: "상점", en: "Shop" } }]}
          selected={null}
          {...cbs}
        />
      </LangProvider>,
    );
    expect(rtl.getByText("비어 있음 — 팔레트에서 블록을 추가하세요.")).toBeInTheDocument();
    fireEvent.click(rtl.getByText("상점"));
    expect(cbs.onSelect).toHaveBeenLastCalledWith({ scope: { kind: "tab", tabId: "shop" }, path: [] });
  });
});
