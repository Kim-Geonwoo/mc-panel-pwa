// tab-content 블록의 렌더 계획 — 순수 함수라 레지스트리 없이 단위 테스트할 수 있다.
import type { Block, TabSpec } from "./schema";

export type TabPlanEntry = {
  tabId: string;
  // 실제로 렌더할 블록: 활성 탭은 전체, 비활성 탭은 keepMounted 블록만 —
  // 스스로 숨지 못하는 블록이 비활성 탭에서 노출되는 것을 막는다.
  blocks: Block[];
  active: boolean;
  // 렌더 여부: 활성 탭이거나, keepMounted 블록을 포함해 숨김 상태로도 마운트를
  // 유지해야 하는 탭(채팅 — 스크롤·입력 보존). 숨김 처리는 블록 자신이 한다.
  mounted: boolean;
};

// 알려진 탭의 기본 콘텐츠(레이아웃이 content를 명시하지 않을 때) — 현행 UI 매핑.
const DEFAULT_CONTENT: Record<string, Block[]> = {
  chat: [{ type: "chat-feed" }],
  perf: [{ type: "perf-view" }],
  timeline: [{ type: "timeline-view" }],
};

export function planTabContent(
  visibleTabs: string[],
  activeTab: string,
  layoutTabs: TabSpec[] | undefined,
  isKeepMounted: (type: string) => boolean,
): TabPlanEntry[] {
  return visibleTabs.map((tabId) => {
    const lt = layoutTabs?.find((x) => x.id === tabId);
    const all = lt?.content?.length ? lt.content : DEFAULT_CONTENT[tabId] ?? [];
    const active = tabId === activeTab;
    const blocks = active ? all : all.filter((b) => isKeepMounted(b.type));
    return {
      tabId,
      blocks,
      active,
      mounted: active || blocks.length > 0,
    };
  });
}
