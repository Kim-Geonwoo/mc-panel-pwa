// 스튜디오 좌·우 패널 폭 — 클램프·이동 계산과 localStorage 저장/복원의 순수 로직.
// 저장본은 신뢰불가 입력으로 취급한다: 파싱 실패·타입 위반은 기본값으로, 범위 밖
// 숫자는 클램프로 수렴하고, 스토리지 접근 실패는 조용히 무시한다(편집은 계속된다).

export const PANES_KEY = "mc_sv_panel_studio_panes";

export type PaneSide = "left" | "right";
export type PaneWidths = { left: number; right: number };

// 기본 폭은 기존 고정 클래스 w-60/w-80(240/320px)과 동일 — 저장본 없으면 회귀 0.
export const PANE_DEFAULTS: PaneWidths = { left: 240, right: 320 };
export const PANE_LIMITS: Record<PaneSide, { min: number; max: number }> = {
  left: { min: 180, max: 360 },
  right: { min: 240, max: 480 },
};

// 폭을 정수로 반올림해 패널별 min–max로 자른다. 유한수가 아니면 기본 폭.
export function clampPane(side: PaneSide, width: number): number {
  if (!Number.isFinite(width)) return PANE_DEFAULTS[side];
  const { min, max } = PANE_LIMITS[side];
  return Math.min(max, Math.max(min, Math.round(width)));
}

// 핸들의 화면상 x 이동량(px)을 폭에 반영한다 — 좌패널은 오른쪽(+x)으로 끌면
// 커지고 우패널은 반대다. 드래그와 키보드 화살표가 이 계산을 공유해 화살표
// 방향 = 핸들의 화면상 이동 방향이라는 스플리터 관례를 지킨다.
export function movePane(side: PaneSide, base: number, deltaX: number): number {
  return clampPane(side, base + (side === "left" ? deltaX : -deltaX));
}

// 저장된 폭을 읽는다. 없음/손상/타입 위반 → 기본값, 범위 밖 숫자 → 클램프.
// 한쪽만 유효하면 그쪽은 살리고 나머지만 기본값으로 채운다.
export function loadPanes(): PaneWidths {
  try {
    const raw = localStorage.getItem(PANES_KEY);
    if (!raw) return { ...PANE_DEFAULTS };
    const parsed: unknown = JSON.parse(raw);
    const o =
      typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    return {
      left: clampPane("left", typeof o.left === "number" ? o.left : NaN),
      right: clampPane("right", typeof o.right === "number" ? o.right : NaN),
    };
  } catch {
    return { ...PANE_DEFAULTS };
  }
}

// 폭을 저장한다. 스토리지 실패(쿼터·프라이빗 모드)는 조용히 무시.
export function savePanes(w: PaneWidths): void {
  try {
    localStorage.setItem(PANES_KEY, JSON.stringify(w));
  } catch {
    /* 무시 */
  }
}
