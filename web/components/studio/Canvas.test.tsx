import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, fireEvent, screen as rtl } from "@testing-library/react";
import { LangProvider } from "../../lib/i18n";
import { PanelProvider, usePanel } from "../../lib/builder/context";
import type { Block, Layout } from "../../lib/builder/schema";
import type { ScopedPath } from "../../lib/builder/studioScope";
import StudioCanvas from "./Canvas";

// 캔버스는 실제 PanelProvider+블록(폴링 포함)을 마운트한다 — 네트워크 계층만 영원히
// 대기하는 목으로 바꿔 폴링을 무해화한다(상수·에러 클래스 등은 원본 유지).
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  const pending = () => new Promise<never>(() => {});
  return {
    ...actual,
    fetchStatus: vi.fn(pending),
    getMe: vi.fn(pending),
    fetchChat: vi.fn(pending),
    fetchChatBefore: vi.fn(pending),
    fetchPerf: vi.fn(pending),
    fetchTimeline: vi.fn(pending),
    sendChat: vi.fn(pending),
  };
});

beforeAll(() => {
  // jsdom에는 Element.scrollTo가 없다 — ChatFeed의 스크롤 고정(rAF 콜백)이 던지지
  // 않도록 no-op 심을 둔다.
  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = () => {};
  }
});

beforeEach(() => localStorage.setItem("panel-lang", "ko"));

// 화면 트리: text([0]) / tabbar([1]) / tab-content([2]).
const screenTree: Block = {
  type: "vstack",
  props: { key: "root" },
  children: [
    { type: "text", props: { key: "s1", ko: "화면 문구" } },
    { type: "tabbar", props: { key: "tb" } },
    { type: "tab-content", props: { key: "tc" } },
  ],
};

// 물질화된 chat(명시 content) + 기본 매핑 없는 커스텀 탭 shop(빈 탭).
const layoutMaterialized: Layout = {
  version: 1,
  tabs: [
    {
      id: "chat",
      label: { ko: "채팅", en: "Chat" },
      content: [{ type: "text", props: { key: "c1", ko: "탭 안 문구" } }],
    },
    { id: "shop", label: { ko: "상점", en: "Shop" } },
  ],
};

// 유령 chat(content 없음 → 기본 매핑 chat-feed 폴백).
const layoutGhost: Layout = {
  version: 1,
  tabs: [{ id: "chat", label: { ko: "채팅", en: "Chat" } }],
};

function draw(opts: {
  layout: Layout;
  editing?: boolean;
  selected?: ScopedPath | null;
  previewTab?: string;
}) {
  const onSelect = vi.fn();
  const onPreviewTab = vi.fn();
  const utils = render(
    <LangProvider>
      <StudioCanvas
        layout={opts.layout}
        screen={screenTree}
        editing={opts.editing ?? true}
        selected={opts.selected ?? null}
        onSelect={onSelect}
        previewTab={opts.previewTab ?? "chat"}
        onPreviewTab={onPreviewTab}
        onLogout={() => {}}
      />
    </LangProvider>,
  );
  return { ...utils, onSelect, onPreviewTab };
}

describe("StudioCanvas (T2.3 — 탭 콘텐츠 선택·프리뷰 탭 제어)", () => {
  it("selects a materialized tab-content block with a tab-scoped path", () => {
    const { container, onSelect } = draw({ layout: layoutMaterialized });
    // data-spath는 spathId 형식 — 탭 스코프 "t:chat|0"
    expect(container.querySelector('[data-spath="t:chat|0"]')).not.toBeNull();
    fireEvent.click(rtl.getByText("탭 안 문구"));
    expect(onSelect).toHaveBeenLastCalledWith({ scope: { kind: "tab", tabId: "chat" }, path: [0] });
  });

  it("selects screen blocks with a screen-scoped path (spathId 형식)", () => {
    const { container, onSelect } = draw({ layout: layoutMaterialized });
    expect(container.querySelector('[data-spath="s|0"]')).not.toBeNull();
    fireEvent.click(rtl.getByText("화면 문구"));
    expect(onSelect).toHaveBeenLastCalledWith({ scope: { kind: "screen" }, path: [0] });
  });

  it("intercepts tabbar clicks in editing mode: selects the tabbar block, no tab switch", () => {
    const { onSelect, onPreviewTab } = draw({ layout: layoutMaterialized });
    fireEvent.click(rtl.getByRole("tab", { name: "상점" }));
    expect(onSelect).toHaveBeenLastCalledWith({ scope: { kind: "screen" }, path: [1] });
    expect(onPreviewTab).not.toHaveBeenCalled();
  });

  it("lets the preview tabbar switch tabs via tabControl when not editing", () => {
    const { onSelect, onPreviewTab } = draw({ layout: layoutMaterialized, editing: false });
    fireEvent.click(rtl.getByRole("tab", { name: "상점" }));
    expect(onPreviewTab).toHaveBeenCalledWith("shop");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("ghost tab content is not selectable: click resolves to the tab-content block, notice shown", () => {
    const { container, onSelect } = draw({ layout: layoutGhost });
    // 유령 콘텐츠에는 탭 스코프 래퍼가 없다
    expect(container.querySelector('[data-spath^="t:"]')).toBeNull();
    const notice = rtl.getByText(/기본 구성 탭/);
    fireEvent.click(notice);
    // 안내(유령 콘텐츠 내부) 클릭은 화면 스코프의 tab-content 블록([2]) 선택으로 승격
    expect(onSelect).toHaveBeenLastCalledWith({ scope: { kind: "screen" }, path: [2] });
  });

  it("hides the ghost notice outside editing mode", () => {
    draw({ layout: layoutGhost, editing: false });
    expect(rtl.queryByText(/기본 구성 탭/)).toBeNull();
  });

  it("shows the empty-tab placeholder only in editing mode", () => {
    const a = draw({ layout: layoutMaterialized, previewTab: "shop" });
    expect(rtl.getByText("빈 탭 — 팔레트에서 블록을 추가하세요.")).toBeInTheDocument();
    a.unmount();
    draw({ layout: layoutMaterialized, previewTab: "shop", editing: false });
    expect(rtl.queryByText("빈 탭 — 팔레트에서 블록을 추가하세요.")).toBeNull();
  });
});

describe("StudioCanvas (T3.1 — Shift+클릭 실제 동작 통과)", () => {
  it("일반 클릭은 선택만 하고 내부 onClick은 실행하지 않는다", () => {
    const { onSelect, onPreviewTab } = draw({ layout: layoutMaterialized });
    fireEvent.click(rtl.getByRole("tab", { name: "상점" }));
    expect(onSelect).toHaveBeenLastCalledWith({ scope: { kind: "screen" }, path: [1] });
    expect(onPreviewTab).not.toHaveBeenCalled();
  });

  it("Shift+클릭은 내부 onClick(탭 전환)을 실행하고 선택하지 않는다", () => {
    const { onSelect, onPreviewTab } = draw({ layout: layoutMaterialized });
    fireEvent.click(rtl.getByRole("tab", { name: "상점" }), { shiftKey: true });
    expect(onPreviewTab).toHaveBeenCalledWith("shop");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("mousedown 기본동작: 일반은 차단, Shift는 통과(입력 포커스 허용)", () => {
    draw({ layout: layoutMaterialized });
    const tab = rtl.getByRole("tab", { name: "상점" });
    // fireEvent는 defaultPrevented면 false를 반환한다
    expect(fireEvent.mouseDown(tab)).toBe(false);
    expect(fireEvent.mouseDown(tab, { shiftKey: true })).toBe(true);
  });

  it("Shift 힌트는 편집 모드에서만 보인다", () => {
    const a = draw({ layout: layoutMaterialized });
    expect(rtl.getByText(/Shift\+클릭 = 실제 동작 실행/)).toBeInTheDocument();
    a.unmount();
    draw({ layout: layoutMaterialized, editing: false });
    expect(rtl.queryByText(/Shift\+클릭 = 실제 동작 실행/)).toBeNull();
  });
});

// tabControl 회귀 가드 — 부재 시 PanelProvider는 기존 내부 탭 상태 그대로(메인 패널
// 경로), 존재 시 외부 상태를 그대로 소비한다.
function TabProbe() {
  const { tab, setTab } = usePanel();
  return (
    <button type="button" onClick={() => setTab("perf")}>
      {tab}
    </button>
  );
}

describe("PanelProvider tabControl (additive)", () => {
  it("keeps the internal tab state when tabControl is absent (기존 동작)", () => {
    render(
      <PanelProvider layout={{ version: 1 }} onLogout={() => {}}>
        <TabProbe />
      </PanelProvider>,
    );
    const btn = rtl.getByRole("button");
    expect(btn).toHaveTextContent("chat"); // 기본 탭 동일
    fireEvent.click(btn);
    expect(btn).toHaveTextContent("perf"); // 내부 useState 경로 동작
  });

  it("uses the external state when tabControl is present", () => {
    const setTab = vi.fn();
    render(
      <PanelProvider layout={{ version: 1 }} onLogout={() => {}} tabControl={{ tab: "timeline", setTab }}>
        <TabProbe />
      </PanelProvider>,
    );
    const btn = rtl.getByRole("button");
    expect(btn).toHaveTextContent("timeline"); // 외부 값이 곧 현재 탭
    fireEvent.click(btn);
    expect(setTab).toHaveBeenCalledWith("perf"); // setTab은 외부로 위임
    expect(btn).toHaveTextContent("timeline"); // 외부가 갱신하지 않는 한 불변(제어형)
  });
});
