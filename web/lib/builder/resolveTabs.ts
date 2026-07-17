import type { Layout } from "./schema";

// 증분 1이 다루는 알려진 탭. 렌더링은 Panel에 하드코딩되어 있으므로 레이아웃은
// 이들의 표시 여부·순서만 정한다(미지 탭의 일반 렌더링은 증분 2).
export type KnownTab = "chat" | "perf" | "timeline";

const KNOWN_ORDER: KnownTab[] = ["chat", "perf", "timeline"];

function isKnown(id: string): id is KnownTab {
  return (KNOWN_ORDER as string[]).includes(id);
}

// resolveTabs는 서버 레이아웃의 tabs와 개인 표시설정(tabPrefs)을 합쳐 보이는 탭
// 순서를 만든다. 규칙: ①레이아웃 순서를 따르되 알려진 탭만 남기고 ②enabled:false는
// 제외하고 ③개인 설정이 끈 perf/timeline은 제외한다. 채팅은 항상 포함해 회귀를
// 막는다(현행 UI는 채팅을 항상 표시). 레이아웃이 없으면 기본 순서를 쓴다.
export function resolveTabs(
  layout: Pick<Layout, "tabs"> | undefined,
  prefs: { perf: boolean; timeline: boolean },
): KnownTab[] {
  const source: Array<{ id: string; enabled?: boolean }> = layout?.tabs?.length
    ? layout.tabs
    : KNOWN_ORDER.map((id) => ({ id }));
  const out: KnownTab[] = [];
  for (const tb of source) {
    if (!isKnown(tb.id) || out.includes(tb.id)) continue;
    if (tb.enabled === false) continue;
    if (tb.id === "perf" && !prefs.perf) continue;
    if (tb.id === "timeline" && !prefs.timeline) continue;
    out.push(tb.id);
  }
  if (!out.includes("chat")) out.unshift("chat");
  return out;
}
