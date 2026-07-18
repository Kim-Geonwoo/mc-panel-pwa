import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { LangProvider } from "../../i18n";
import BlockRenderer from "../BlockRenderer";
import { REGISTRY } from "../registry";
import { SETTINGS_SECTION_IDS } from "../../../components/SettingsSheet";
import type { Block } from "../schema";

// 패널 공유 상태 목 — PanelProvider 전체 기동 없이 settings-button을 렌더하기 위한 최소 셈.
vi.mock("../context", () => ({
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
    connLost: false,
    setConnLost: () => {},
  }),
}));

// 시트 마운트 시의 fetchPushConfig를 결정적 응답으로 목 처리(실네트워크 차단).
vi.mock("../../api", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../api")>();
  return {
    ...orig,
    fetchPushConfig: async () => ({ key: "", events: [] }),
    logout: async () => {},
    setNickname: async () => {},
    subscribePush: async () => {},
    unsubscribePush: async () => {},
  };
});

beforeEach(() => localStorage.setItem("panel-lang", "ko"));

function draw(node: Block) {
  return render(
    <LangProvider>
      <BlockRenderer node={node} />
    </LangProvider>,
  );
}

// 기어 버튼 클릭으로 시트를 열고 마운트 이펙트의 비동기 setState를 흘려보낸다.
async function openSheet() {
  fireEvent.click(screen.getByRole("button", { name: "설정" }));
  await act(async () => {});
}

describe("settings-button — sections props(T5.2, 발행 렌더 경로)", () => {
  it("sections 부재: 버튼 렌더 + 시트에 5개 섹션 전체가 나온다(현행 동작)", async () => {
    const { container } = draw({ type: "settings-button" });
    expect(screen.getByRole("button", { name: "설정" })).toBeInTheDocument();
    await openSheet();
    expect(container.querySelectorAll("section")).toHaveLength(5);
  });

  it("sections 부분집합: 지정한 섹션만 시트에 나온다", async () => {
    const { container } = draw({
      type: "settings-button",
      props: { sections: ["push", "logout"] },
    });
    await openSheet();
    expect(container.querySelectorAll("section")).toHaveLength(2);
    expect(screen.getByRole("heading", { level: 3, name: "알림" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
    expect(screen.queryByText("탭 표시")).toBeNull();
  });

  it("무효 sections(비배열)여도 버튼이 생존한다 — 폴백 없음, 시트는 전체", async () => {
    const { container } = draw({
      type: "settings-button",
      props: { sections: "bogus" },
    });
    expect(screen.queryByText(/invalid props/)).toBeNull();
    expect(screen.getByRole("button", { name: "설정" })).toBeInTheDocument();
    await openSheet();
    expect(container.querySelectorAll("section")).toHaveLength(5);
  });

  it("무효 원소가 섞인 배열: 버튼 생존 + 유효 섹션만 반영", async () => {
    const { container } = draw({
      type: "settings-button",
      props: { sections: ["push", 123, "junk"] },
    });
    expect(screen.queryByText(/invalid props/)).toBeNull();
    await openSheet();
    expect(container.querySelectorAll("section")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 3, name: "알림" })).toBeInTheDocument();
  });
});

describe("settings-button — registry 메타(propsSchema·fields)", () => {
  const def = REGISTRY["settings-button"];

  it("propsSchema: 무효 sections는 .catch로 부재 강등되어 검증이 실패하지 않는다", () => {
    const schema = def.propsSchema!;
    // 비배열·무효 원소 — 성공(폴백 금지)하되 sections는 부재로
    for (const bad of [123, "x", { a: 1 }, ["push", "bogus"], [1, 2]]) {
      const r = schema.safeParse({ sections: bad });
      expect(r.success).toBe(true);
      expect((r as { data: { sections?: unknown } }).data.sections).toBeUndefined();
    }
    // 유효값·부재는 그대로 통과
    const ok = schema.safeParse({ sections: ["push", "logout"] });
    expect(ok.success).toBe(true);
    expect((ok as { data: { sections?: unknown } }).data.sections).toEqual(["push", "logout"]);
    expect(schema.safeParse({}).success).toBe(true);
    // style 키가 섞여도 검증 실패 사유가 되지 않는다(styleProp 관용)
    expect(schema.safeParse({ sections: ["lang"], style: { m: "99" } }).success).toBe(true);
  });

  it("fields: multiEnum 옵션이 시트 섹션 튜플과 같은 id를 같은 순서로 커버한다", () => {
    const f = def.fields?.find((x) => x.prop === "sections");
    expect(f?.kind).toBe("multiEnum");
    if (f?.kind !== "multiEnum") throw new Error("multiEnum 필드가 없습니다");
    expect(f.options.map((o) => o.v)).toEqual([...SETTINGS_SECTION_IDS]);
  });
});
