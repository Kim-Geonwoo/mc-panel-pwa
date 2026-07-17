// 스튜디오 undo/redo 히스토리 — 순수 함수. Layout은 editOps가 불변으로 다루므로
// 스냅샷을 참조로만 쌓는다(복사 비용 없음). past는 HISTORY_LIMIT으로 상한한다.
import type { Layout } from "./schema";

export type StudioHistory = { past: Layout[]; present: Layout; future: Layout[] };

export const HISTORY_LIMIT = 50;

export function initHistory(l: Layout): StudioHistory {
  return { past: [], present: l, future: [] };
}

// 새 상태를 쌓는다. 동일 참조(no-op 편집)는 히스토리를 오염시키지 않도록 무시하고,
// 새 편집은 redo 스택을 비운다(일반적인 편집기 규칙).
export function pushHistory(h: StudioHistory, next: Layout, limit = HISTORY_LIMIT): StudioHistory {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-limit), present: next, future: [] };
}

export function undoHistory(h: StudioHistory): StudioHistory {
  if (h.past.length === 0) return h;
  return {
    past: h.past.slice(0, -1),
    present: h.past[h.past.length - 1],
    future: [h.present, ...h.future],
  };
}

export function redoHistory(h: StudioHistory): StudioHistory {
  if (h.future.length === 0) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

export function canUndo(h: StudioHistory): boolean {
  return h.past.length > 0;
}

export function canRedo(h: StudioHistory): boolean {
  return h.future.length > 0;
}
