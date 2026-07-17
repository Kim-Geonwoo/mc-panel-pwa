import type { ThemeSpec } from "./schema";

// applyTheme는 서버 레이아웃의 테마 토큰을 문서에 반영한다. 증분 1은 accent만 적용한다
// (기본 레이아웃엔 accent가 없어 무변화 = 회귀 0). mode의 서버 주도 적용은 기존
// ThemeToggle(localStorage 우선)과의 충돌을 피하려 후속 증분으로 미룬다.
export function applyTheme(theme?: ThemeSpec): void {
  if (typeof document === "undefined" || !theme) return;
  if (theme.accent && /^#[0-9a-fA-F]{6}$/.test(theme.accent)) {
    document.documentElement.style.setProperty("--accent", theme.accent);
  }
}
