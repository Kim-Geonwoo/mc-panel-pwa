"use client";

// Panel — SDUI 셸. 공유 상태는 PanelProvider가 소유하고, 화면은 서버 레이아웃의
// screen 트리(부재 시 번들 DEFAULT_SCREEN = 현행 UI)를 BlockRenderer가 그린다.
// 각 영역의 로컬 상태(채팅·시트·모달)는 해당 블록이 소유한다.
import type { Layout } from "../lib/builder/schema";
import { PanelProvider } from "../lib/builder/context";
import { DEFAULT_SCREEN } from "../lib/builder/registry";
import BlockRenderer from "../lib/builder/BlockRenderer";

export default function Panel({ onLogout, layout }: { onLogout: () => void; layout: Layout }) {
  return (
    <PanelProvider layout={layout} onLogout={onLogout}>
      <BlockRenderer node={layout.screen ?? DEFAULT_SCREEN} />
    </PanelProvider>
  );
}
