// 레이아웃 계수 질의 — 팔레트 중복 배치 가드(B8)의 순수 로직. 화면 트리·각 탭
// content에 더해, 렌더러가 암묵적으로 쓰는 기본값(screen 부재 시 DEFAULT_SCREEN,
// 명시 content 없는 known 탭의 기본 매핑 chat→chat-feed 등)까지 계수한다 —
// 기본 구성과 겹치는 암묵 중복 배치를 막기 위함이다. 기본 매핑의 단일 소스는
// tabContentPlan(planTabContent)이라 여기서 매핑을 중복 정의하지 않는다.
import { DEFAULT_LAYOUT } from "../api";
import { DEFAULT_SCREEN } from "./registry";
import type { Block, Layout } from "./schema";
import { planTabContent } from "./tabContentPlan";

// 트리(자신 포함)에서 type이 일치하는 노드 수를 센다.
function countInTree(b: Block, type: string): number {
  let n = b.type === type ? 1 : 0;
  for (const c of b.children ?? []) n += countInTree(c, type);
  return n;
}

// 레이아웃 전체(화면 + 탭 콘텐츠 + 암묵 기본값)에서 type 블록 수를 센다.
export function countBlockType(l: Layout, type: string): number {
  // 화면: 드래프트에 screen이 없으면 캔버스·발행 뷰가 기본 화면을 쓴다 —
  // 그 암묵 트리도 계수해야 기본 배치(tabbar 등)와의 중복을 막을 수 있다.
  let n = countInTree(l.screen ?? DEFAULT_SCREEN, type);
  // 탭 목록: resolveTabs와 동일하게 비어 있으면 기본 탭으로 폴백하고 중복 id는
  // 첫 항목만 남긴다. enabled:false 탭도 계수한다(재활성화 시 중복 방지 — 보수적).
  const tabs = l.tabs?.length ? l.tabs : DEFAULT_LAYOUT.tabs ?? [];
  const ids = [...new Set(tabs.map((t) => t.id))];
  // chat 탭은 목록에 없어도 항상 렌더된다(resolveTabs의 강제 포함 규칙과 동일).
  if (!ids.includes("chat")) ids.push("chat");
  // activeTab 불일치 + keepMounted 전부 통과 = 탭마다 전체 블록 목록을 얻는다
  // (명시 content 우선, 없으면 known 탭 기본 매핑 — planTabContent의 규칙 재사용).
  for (const e of planTabContent(ids, "", tabs, () => true)) {
    for (const b of e.blocks) n += countInTree(b, type);
  }
  return n;
}
