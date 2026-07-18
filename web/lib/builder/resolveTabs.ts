import type { Layout } from "./schema";

// 개인 표시설정(tabPrefs)이 있는 탭 — perf/timeline 토글 판정용으로만 존치한다.
// 렌더 대상은 더 이상 이 목록으로 제한하지 않는다(미지 탭 통과 — v2 B1 수정).
export type KnownTab = "chat" | "perf" | "timeline";

const DEFAULT_ORDER: KnownTab[] = ["chat", "perf", "timeline"];

// resolveTabs는 서버 레이아웃의 tabs와 개인 표시설정(tabPrefs)을 합쳐 보이는 탭
// 순서를 만든다. 규칙: ①레이아웃 순서를 따르고 ②중복 id는 첫 항목만 남기고
// ③enabled:false는 제외하고 ④개인 설정이 끈 perf/timeline은 제외한다. 미지 id도
// 그대로 통과한다 — 라벨 폴백은 Tabbar(labelFor), 콘텐츠 부재 시 빈 배열은
// planTabContent가 처리한다. 채팅은 항상 포함해 회귀를 막는다(현행 UI는 채팅을
// 항상 표시). 레이아웃이 없으면 기본 순서를 쓴다.
export function resolveTabs(
  layout: Pick<Layout, "tabs"> | undefined,
  prefs: { perf: boolean; timeline: boolean },
): string[] {
  const source: Array<{ id: string; enabled?: boolean }> = layout?.tabs?.length
    ? layout.tabs
    : DEFAULT_ORDER.map((id) => ({ id }));
  const out: string[] = [];
  for (const tb of source) {
    if (out.includes(tb.id)) continue;
    if (tb.enabled === false) continue;
    if (tb.id === "perf" && !prefs.perf) continue;
    if (tb.id === "timeline" && !prefs.timeline) continue;
    out.push(tb.id);
  }
  if (!out.includes("chat")) out.unshift("chat");
  return out;
}
