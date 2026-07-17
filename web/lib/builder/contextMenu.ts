// 컨텍스트 메뉴 순수 로직 — 포지셔닝(뷰포트 클램프·플립)과 roving tabindex 탐색을
// DOM 없이 단위 테스트할 수 있게 분리했다. components/studio/ContextMenu.tsx가 소비한다.

// 메뉴 항목 모델 — 실행 항목 또는 구분선. 대상 식별(경로 등)은 항목을 만드는 쪽이
// onRun 클로저에 고정한다(메뉴 표시 중 선택이 바뀌어도 실행 대상이 흔들리지 않도록).
export type ContextMenuAction = {
  id: string;
  label: string;
  shortcut?: string; // 표기·aria-keyshortcuts용 문자열(단축키 바인딩 자체는 호출부 몫)
  danger?: boolean; // 삭제류 — 위험 색상으로 표기
  disabled?: boolean; // APG: 포커스는 받되 실행만 차단(aria-disabled)
  onRun: () => void;
};
export type ContextMenuItem = ContextMenuAction | "separator";

// 뷰포트 가장자리 최소 여백(px).
const MARGIN = 4;

// (x,y)=열림 좌표(clientX/Y 기준), (w,h)=메뉴 실측 크기, (vw,vh)=뷰포트 크기.
// 가로는 클램프(shift)만, 세로는 하단 공간이 부족하면 위로 flip한 뒤 다시 클램프한다.
// position:fixed 좌표계를 전제한다(스크롤·transform 오프셋 무관).
export function placeMenu(
  x: number,
  y: number,
  w: number,
  h: number,
  vw: number,
  vh: number,
): { left: number; top: number } {
  const left = Math.max(MARGIN, Math.min(x, vw - w - MARGIN));
  let top = y;
  if (y + h + MARGIN > vh) top = y - h; // 하단 부족 — 위로 flip
  top = Math.max(MARGIN, Math.min(top, vh - h - MARGIN)); // flip 후에도 뷰포트로 클램프
  return { left, top };
}

// dir 방향의 다음 항목 인덱스(끝에서 순환). separator는 건너뛰고 disabled는 APG대로
// 포커스 대상에 포함한다. 실행 항목이 하나도 없으면 -1.
export function nextItemIndex(items: readonly ContextMenuItem[], current: number, dir: 1 | -1): number {
  const n = items.length;
  if (n === 0) return -1;
  let i = ((current % n) + n) % n; // 범위 밖 current도 안전하게 정규화
  for (let step = 0; step < n; step++) {
    i = (i + dir + n) % n;
    if (items[i] !== "separator") return i;
  }
  return -1;
}

// 첫/마지막 실행 항목 인덱스(separator 제외). 없으면 -1. Home/End·열림 직후 포커스용.
export function edgeItemIndex(items: readonly ContextMenuItem[], edge: "first" | "last"): number {
  if (edge === "first") {
    for (let i = 0; i < items.length; i++) if (items[i] !== "separator") return i;
  } else {
    for (let i = items.length - 1; i >= 0; i--) if (items[i] !== "separator") return i;
  }
  return -1;
}
