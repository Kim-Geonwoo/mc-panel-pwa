import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LangProvider } from "../i18n";
import BlockRenderer from "./BlockRenderer";
import type { Block } from "./schema";

// 패널 공유 상태 목 — context 블록(conn-banner·tabbar·server-status·settings-button·
// chat-feed)을 PanelProvider 전체 기동 없이 렌더하기 위한 최소 셈. 값은 T4.2 회귀
// 고정 테스트가 기대하는 분기(connLost 배너 표시, chat 탭 활성)를 고정한다.
vi.mock("./context", () => ({
  usePanel: () => ({
    layout: {},
    onLogout: () => {},
    tab: "chat",
    setTab: () => {},
    tabRef: { current: "chat" },
    visibleTabs: ["chat", "perf", "timeline"],
    tabPrefs: { perf: true, timeline: true },
    updateTabPrefs: () => {},
    status: null,
    tpsHist: [],
    up: false,
    players: [],
    nick: "tester",
    setNick: () => {},
    unread: 0,
    setUnread: () => {},
    connLost: true,
    setConnLost: () => {},
  }),
}));

// chat-feed의 폴링이 실제 네트워크를 치지 않도록 채팅 API만 결정적 응답으로 목 처리.
vi.mock("../api", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../api")>();
  return {
    ...orig,
    fetchChat: async () => ({ messages: [], last_id: 0 }),
    fetchChatBefore: async () => ({ messages: [] }),
    sendChat: async () => ({}),
  };
});

beforeAll(() => {
  // jsdom에는 Element.scrollTo가 없다 — chat-feed의 스크롤 고정(rAF 콜백)이 던지지 않게 스텁.
  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = () => {};
  }
});

// jsdom의 브라우저 언어는 en-US — 저장된 선택을 ko로 고정해 현행 기본과 동일하게 검증.
beforeEach(() => localStorage.setItem("panel-lang", "ko"));

function draw(node: Block) {
  return render(
    <LangProvider>
      <BlockRenderer node={node} />
    </LangProvider>,
  );
}

// 렌더 결과의 첫 요소(대부분 블록의 루트)를 돌려주는 축약 헬퍼.
function rootOf(node: Block): HTMLElement {
  return draw(node).container.firstElementChild as HTMLElement;
}

describe("BlockRenderer", () => {
  it("renders a nested layout tree", () => {
    draw({
      type: "vstack",
      children: [
        { type: "text", props: { ko: "안녕", en: "Hello" } },
        { type: "hstack", children: [{ type: "text", props: { ko: "중첩", en: "Nested" } }] },
      ],
    });
    expect(screen.getByText("안녕")).toBeInTheDocument();
    expect(screen.getByText("중첩")).toBeInTheDocument();
  });

  it("falls back on an unknown type without throwing (siblings still render)", () => {
    draw({
      type: "vstack",
      children: [{ type: "no-such-block" }, { type: "text", props: { ko: "생존" } }],
    });
    expect(screen.getByText(/unknown block/)).toBeInTheDocument(); // dev 표기
    expect(screen.getByText("생존")).toBeInTheDocument();
  });

  it("falls back when props fail schema validation (distinct dev message)", () => {
    draw({ type: "text", props: { variant: "huge" } });
    expect(screen.getByText(/invalid props: text/)).toBeInTheDocument();
  });

  it("uses props.key or type-scoped index as stable child keys (no crash on reorder)", () => {
    const { rerender } = render(
      <LangProvider>
        <BlockRenderer
          node={{
            type: "vstack",
            children: [
              { type: "text", props: { key: "a", ko: "첫" } },
              { type: "text", props: { key: "b", ko: "둘" } },
            ],
          }}
        />
      </LangProvider>,
    );
    rerender(
      <LangProvider>
        <BlockRenderer
          node={{
            type: "vstack",
            children: [
              { type: "text", props: { key: "b", ko: "둘" } },
              { type: "text", props: { key: "a", ko: "첫" } },
            ],
          }}
        />
      </LangProvider>,
    );
    expect(screen.getByText("첫")).toBeInTheDocument();
    expect(screen.getByText("둘")).toBeInTheDocument();
  });

  it("is safe against prototype-polluting type names", () => {
    expect(() => draw({ type: "__proto__" })).not.toThrow();
    expect(() => draw({ type: "constructor" })).not.toThrow();
  });

  it("renders the title text via the i18n whitelist key", () => {
    draw({ type: "text", props: { i18n: "panel.title", variant: "title" } });
    expect(screen.getByRole("heading")).toHaveTextContent("마크서버");
  });

  it("never throws on random trees (seeded, known+unknown mix)", () => {
    // 시드 고정 의사난수(mulberry32) — 재현 가능한 무작위 트리 30개.
    let s = 20260717;
    const rnd = () => {
      s |= 0; s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const types = ["vstack", "hstack", "spacer", "text", "logo", "bogus", "__proto__"];
    const junkProps = () =>
      [undefined, {}, { ko: "x" }, { variant: "huge" }, { size: -1 }, { i18n: "evil.key" }][
        Math.floor(rnd() * 6)
      ];
    const tree = (depth: number): Block => ({
      type: types[Math.floor(rnd() * types.length)],
      props: junkProps() as Block["props"],
      children:
        depth > 0 && rnd() < 0.7
          ? Array.from({ length: Math.floor(rnd() * 3) }, () => tree(depth - 1))
          : undefined,
    });
    for (let i = 0; i < 30; i++) {
      expect(() => draw(tree(5)).unmount()).not.toThrow();
    }
  });
});

// ── T4.2: 스타일 토큰의 블록 루트 병합 ────────────────────────────────────────────
describe("BlockRenderer — 스타일 토큰 적용(T4.2)", () => {
  it("layout 블록: 루트 요소에 기본 클래스 뒤로 토큰 클래스가 병합된다(래퍼 div 없음)", () => {
    const { container } = draw({
      type: "vstack",
      props: { style: { p: "4", bg: "card" } },
      children: [{ type: "text", props: { ko: "내용" } }],
    });
    const root = container.firstElementChild as HTMLElement;
    // 루트 div 자체가 스타일을 받는다 — 자식은 그대로 flex 체인의 직계.
    expect(root.className).toBe("flex min-h-0 flex-1 flex-col p-4 bg-card");
    expect(root.firstElementChild).toHaveTextContent("내용");
  });

  it("hex 색은 인라인 style로만 배정되고 클래스는 기본 그대로다", () => {
    const root = rootOf({ type: "text", props: { ko: "빨강", style: { fg: "#ff0000" } } });
    expect(root.className).toBe("text-sm text-fg"); // hex 전용 → 클래스 무변화
    expect(root).toHaveStyle({ color: "#ff0000" });
  });

  it("spacer: grow:false는 무배출이라 기본 flex-1이 유지되고, 다른 토큰은 뒤에 병합된다", () => {
    const off = rootOf({ type: "spacer", props: { style: { grow: false } } });
    expect(off.className).toBe("flex-1");
    expect(off.getAttribute("style")).toBeNull();
    const sized = rootOf({ type: "spacer", props: { style: { w: "full" } } });
    expect(sized.className).toBe("flex-1 w-full");
  });

  it("propsSchema 블록(text·logo)이 style 키 때문에 검증 실패로 떨어지지 않는다", () => {
    // text: 기존 props + 유효 style → 정상 렌더 + 병합
    const h1 = rootOf({
      type: "text",
      props: { i18n: "panel.title", variant: "title", style: { mt: "4" } },
    });
    expect(h1.tagName).toBe("H1");
    expect(h1.className).toBe("text-lg font-bold tracking-tight mt-4");
    // logo: style 키가 있어도 폴백 없이 렌더(스타일 적용 지점은 아직 없음 — simple.tsx 주석)
    const { container } = draw({ type: "logo", props: { size: 44, style: { m: "2" } } });
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.queryByText(/invalid props/)).not.toBeInTheDocument();
  });

  it("무효 style은 스타일만 무시되고 블록은 정상 렌더된다(격리)", () => {
    // 비객체 style
    const a = rootOf({ type: "text", props: { ko: "생존A", style: "red" } });
    expect(a).toHaveTextContent("생존A");
    expect(a.className).toBe("text-sm text-fg");
    expect(a.getAttribute("style")).toBeNull();
    // 아는 키의 무효 토큰
    const b = rootOf({ type: "vstack", props: { style: { m: "99" } } });
    expect(b.className).toBe("flex min-h-0 flex-1 flex-col");
    expect(screen.queryByText(/invalid props/)).not.toBeInTheDocument();
  });

  it("server-status: 주 시각 요소(상태 카드)에만 적용되고 바깥 래퍼는 불변이다", () => {
    const { container } = draw({
      type: "server-status",
      props: { style: { radius: "full", bg: "#112233" } },
    });
    const wrap = container.firstElementChild as HTMLElement;
    expect(wrap.className).toBe("shrink-0 px-5"); // 카드 밖 래퍼는 그대로
    const card = wrap.firstElementChild as HTMLElement;
    expect(card.className).toBe("rounded-2xl border border-line bg-card p-4 shadow-card rounded-full");
    expect(card).toHaveStyle({ backgroundColor: "#112233" });
  });

  it("settings-button: 기어 버튼에 병합된다(시트 제외)", () => {
    const { container } = draw({ type: "settings-button", props: { style: { m: "2" } } });
    const btn = container.querySelector("button") as HTMLElement;
    expect(btn.classList.contains("m-2")).toBe(true);
    expect(btn.classList.contains("rounded-full")).toBe(true); // 기본 클래스 유지
  });

  it("tabbar·chat-feed: 각 루트 컨테이너에 병합된다", () => {
    const { container: tb } = draw({ type: "tabbar", props: { style: { mx: "0" } } });
    const tablist = tb.querySelector('[role="tablist"]') as HTMLElement;
    expect(tablist.classList.contains("mx-0")).toBe(true);
    expect(tablist.classList.contains("rounded-2xl")).toBe(true);
    const { container: cf } = draw({ type: "chat-feed", props: { style: { p: "2" } } });
    const feedRoot = cf.firstElementChild as HTMLElement;
    expect(feedRoot.classList.contains("p-2")).toBe(true);
    expect(feedRoot.classList.contains("flex-col")).toBe(true);
  });
});

// ── T4.2: 회귀 고정 — style 부재 시 DOM 클래스가 기존 출력과 문자 그대로 동일 ─────────
// 기대 문자열은 T4.2 이전 소스의 클래스 리터럴을 그대로 옮긴 회귀 픽스처다.
// 이 테스트가 깨지면 메인 패널의 무스타일 렌더가 바뀌었다는 뜻이므로 신중히 갱신할 것.
describe("블록 클래스 회귀 고정(T4.2 — style 부재)", () => {
  const FIXTURE: Array<{ node: Block; expected: string; pick?: (c: HTMLElement) => HTMLElement }> = [
    { node: { type: "vstack" }, expected: "flex min-h-0 flex-1 flex-col" },
    { node: { type: "hstack" }, expected: "flex items-center gap-2" },
    { node: { type: "spacer" }, expected: "flex-1" },
    { node: { type: "header" }, expected: "pt-safe flex shrink-0 items-center justify-between px-5 pb-3" },
    { node: { type: "text", props: { ko: "본문" } }, expected: "text-sm text-fg" },
    { node: { type: "text", props: { ko: "제목", variant: "title" } }, expected: "text-lg font-bold tracking-tight" },
    { node: { type: "text", props: { ko: "캡션", variant: "caption" } }, expected: "text-[11px] text-muted" },
    {
      node: { type: "conn-banner" }, // 목 connLost=true — 배너 표시 분기
      expected:
        "mx-5 mb-2 shrink-0 rounded-xl border border-line bg-card px-3 py-1.5 text-center text-xs font-medium text-danger",
    },
    { node: { type: "tabbar" }, expected: "mx-4 mt-1 flex shrink-0 gap-1 rounded-2xl bg-card2 p-1" },
    {
      node: { type: "settings-button" },
      expected:
        "grid h-9 w-9 place-items-center rounded-full border border-line bg-card text-muted transition-colors hover:text-fg active:scale-95",
    },
    {
      node: { type: "server-status" },
      expected: "rounded-2xl border border-line bg-card p-4 shadow-card",
      pick: (c) => c.firstElementChild as HTMLElement, // 래퍼(shrink-0 px-5) 안의 카드
    },
    {
      // 기존 join(" ")이 남기던 말미 공백까지 문자 그대로 보존한다(chat 탭 활성 분기).
      node: { type: "chat-feed" },
      expected: "relative flex min-h-0 flex-1 flex-col ",
    },
  ];

  it.each(FIXTURE.map((f) => [f.node.type + (f.node.props?.variant ? `:${f.node.props.variant}` : ""), f] as const))(
    "%s — 클래스·style 속성이 기존과 동일",
    (_name, f) => {
      const first = rootOf(f.node);
      const el = f.pick ? f.pick(first) : first;
      expect(el.className).toBe(f.expected);
      expect(el.getAttribute("style")).toBeNull();
    },
  );
});
