"use client";

// PaneResizer — 사이드 패널과 캔버스 사이의 4px 세로 리사이즈 핸들(윈도 스플리터).
// 폭 상태는 StudioApp이 소유하는 제어 컴포넌트다: 드래그(Pointer Events +
// setPointerCapture)와 키보드 ←→(±16px)는 onResize로 미리보기하고, 제스처가 끝나는
// 시점(pointerup/cancel·키 조작·더블클릭=기본 폭 복원)에 onCommit(최종 폭)으로
// 저장을 위임한다. 클램프·방향 계산은 paneSize의 순수 로직(movePane)만 쓴다.
import { useRef } from "react";
import { useI18n } from "../../lib/i18n";
import {
  movePane,
  PANE_DEFAULTS,
  PANE_LIMITS,
  type PaneSide,
} from "../../lib/builder/paneSize";

// 키보드 화살표 1회당 조절량(px).
const KEY_STEP = 16;

export default function PaneResizer({
  side,
  width,
  onResize,
  onCommit,
}: {
  side: PaneSide;
  width: number;
  onResize: (w: number) => void;
  onCommit: (w: number) => void;
}) {
  const { t } = useI18n();
  // 드래그 기준점 — 시작 시점의 포인터 x·패널 폭과 마지막 미리보기 폭. 이동량
  // 기반 계산이라 width prop의 렌더 지연과 무관하게 좌표가 어긋나지 않고,
  // pointerup에서 상태 왕복 없이 last를 그대로 확정할 수 있다.
  const drag = useRef<{ x: number; w: number; last: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // 주 버튼/터치만
    // 드래그 중 텍스트 선택을 막는다. preventDefault가 포커스 이동도 막으므로
    // 키보드 조작 연속성을 위해 포커스는 수동으로 준다.
    e.preventDefault();
    e.currentTarget.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: width, last: width };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const next = movePane(side, drag.current.w, e.clientX - drag.current.x);
    drag.current.last = next;
    if (next !== width) onResize(next);
  };

  // pointercancel도 같은 경로 — 마지막 미리보기 폭을 확정(저장)한다. 캡처 해제는
  // 브라우저가 pointerup/cancel에서 자동으로 한다.
  const onPointerEnd = () => {
    if (!drag.current) return;
    const w = drag.current.last;
    drag.current = null;
    onCommit(w);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    let next: number;
    if (e.key === "ArrowLeft") next = movePane(side, width, -KEY_STEP);
    else if (e.key === "ArrowRight") next = movePane(side, width, KEY_STEP);
    else return;
    e.preventDefault();
    if (next !== width) onResize(next);
    onCommit(next);
  };

  // 더블클릭 = 기본 폭 복원.
  const onDoubleClick = () => {
    const d = PANE_DEFAULTS[side];
    if (d !== width) onResize(d);
    onCommit(d);
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={PANE_LIMITS[side].min}
      aria-valuemax={PANE_LIMITS[side].max}
      aria-label={t(side === "left" ? "studio.pane.leftAria" : "studio.pane.rightAria")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
      // 평시엔 투명(패널 자체 경계선이 구분자) — hover/포커스에서만 강조해 기존
      // 시각과 동일하게 유지한다. touch-none은 터치 드래그가 스크롤로 새는 것을 막는다.
      className="w-1 shrink-0 cursor-col-resize touch-none bg-transparent transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
    />
  );
}
