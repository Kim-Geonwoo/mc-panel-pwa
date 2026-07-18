"use client";

// tab-content 블록 — 활성 탭의 콘텐츠(레이아웃 content 우선, 없으면 기본 매핑)를
// 렌더한다. keepMounted 블록(chat-feed)을 포함한 탭은 비활성이어도 마운트를
// 유지하고, 숨김 처리는 그 블록이 ctx.tab을 보고 스스로 한다(현행 동작과 동일).
//
// 스타일 적용 지점 없음(T4.2) — 이 블록의 루트는 Fragment이고 탭 콘텐츠 블록들이
// 화면 flex 체인에 직접 참여한다. 자체 DOM 요소를 만들면 그 체인이 끊기므로 style은
// 의도적으로 미적용한다(여백·색 등은 각 콘텐츠 블록에 개별 지정).
import { Fragment } from "react";
import { usePanel } from "../context";
import { REGISTRY } from "../registry";
import BlockRenderer, { blockKey } from "../BlockRenderer";
import { planTabContent } from "../tabContentPlan";

export default function TabContent() {
  const { layout, tab, visibleTabs } = usePanel();
  const plan = planTabContent(
    visibleTabs,
    tab,
    layout.tabs,
    (ty) => Object.hasOwn(REGISTRY, ty) && REGISTRY[ty].keepMounted === true,
  );
  return (
    <>
      {plan.map((e) =>
        e.mounted ? (
          <Fragment key={e.tabId}>
            {e.blocks.map((b, i) => (
              <BlockRenderer key={blockKey(b, i)} node={b} />
            ))}
          </Fragment>
        ) : null,
      )}
    </>
  );
}
