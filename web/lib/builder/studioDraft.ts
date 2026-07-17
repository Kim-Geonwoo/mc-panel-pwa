// 스튜디오 드래프트 영속화 — localStorage에 자동저장되는 편집본을 다룬다.
// 저장본은 신뢰불가 입력으로 취급한다: 로드 시 parseLayout으로 재검증하고,
// JSON 손상·스키마 위반·스토리지 접근 실패는 전부 null(=서버본 사용)로 수렴한다.
import { parseLayout, type Layout } from "./schema";

export const DRAFT_KEY = "mc_sv_panel_studio_draft";

// 저장된 드래프트를 읽는다. 없음/손상/검증 실패 → null (호출부가 서버본으로 폴백).
export function loadDraft(): Layout | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return parseLayout(JSON.parse(raw));
  } catch {
    return null;
  }
}

// 드래프트를 저장한다. 스토리지 실패(쿼터·프라이빗 모드)는 조용히 무시 — 편집은 계속된다.
export function saveDraft(l: Layout): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(l));
  } catch {
    /* 무시 */
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* 무시 */
  }
}
