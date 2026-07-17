import type { CSSProperties } from "react";
import type { ThemeSpec } from "./schema";

// applyTheme는 서버 레이아웃의 테마 토큰(mode·accent·radius)을 문서에 반영한다.
// 테마 미지정(기본 레이아웃)이면 아무것도 건드리지 않아 현행과 픽셀 동일(회귀 0).
// 값은 열거/정규식으로만 소비한다 — 임의 문자열이 스타일에 흘러들 경로가 없다.

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// radius 토큰 → Tailwind lg/xl/2xl 라운드 변수 스케일. md는 Tailwind 기본과 동일
// (globals.css :root 기본값 = 회귀 0 기준점). 시각 확정 전 제안치 — 값만 여기서 조정한다.
export const RADIUS_SCALE: Record<
  NonNullable<ThemeSpec["radius"]>,
  { "--r-lg": string; "--r-xl": string; "--r-2xl": string }
> = {
  sm: { "--r-lg": "0.375rem", "--r-xl": "0.5rem", "--r-2xl": "0.625rem" },
  md: { "--r-lg": "0.5rem", "--r-xl": "0.75rem", "--r-2xl": "1rem" },
  lg: { "--r-lg": "0.75rem", "--r-xl": "1rem", "--r-2xl": "1.25rem" },
};

// 무효값(비열거)을 걸러 스케일을 얻는다. 프로토타입 키(__proto__ 등)도 hasOwn으로 차단.
function radiusScale(radius: unknown) {
  return typeof radius === "string" && Object.hasOwn(RADIUS_SCALE, radius)
    ? RADIUS_SCALE[radius as NonNullable<ThemeSpec["radius"]>]
    : undefined;
}

// 사용자 수동 테마 선택(ThemeToggle이 localStorage "theme"에 저장) 존재 여부.
// 읽기 실패(프라이버시 모드 등)는 "선택 없음"으로 본다 — layout.tsx themeInit과 동일 처리.
function manualTheme(): string | null {
  try {
    return localStorage.getItem("theme");
  } catch {
    return null;
  }
}

function prefersDark(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function applyTheme(theme?: ThemeSpec): void {
  if (typeof document === "undefined" || !theme) return;
  const root = document.documentElement;

  // mode — 수동 선택(localStorage) 부재 시에만 서버 mode를 적용한다(ThemeToggle의
  // "수동 선택 우선" 원칙 보존). 실행 순서: layout.tsx의 themeInit(페인트 전,
  // 수동 선택 ?? prefers-color-scheme)이 먼저 클래스를 놓고, 본 함수는 레이아웃
  // fetch 후 호출되어 그 위에 서버 mode를 덮어쓴다. auto는 themeInit과 같은 판정이라
  // 결과가 동일하다(멱등). 무효 mode는 어느 분기에도 걸리지 않아 무시된다.
  if (!manualTheme()) {
    if (theme.mode === "light") root.classList.remove("dark");
    else if (theme.mode === "dark") root.classList.add("dark");
    else if (theme.mode === "auto") root.classList.toggle("dark", prefersDark());
  }

  if (theme.accent && HEX_RE.test(theme.accent)) {
    root.style.setProperty("--accent", theme.accent);
  }

  // radius — 문서 전역 라운드 변수 3종을 스케일 표 리터럴로 덮어쓴다.
  // 무효·부재 시 미변경(globals.css :root 기본 = md 스케일 유지).
  const scale = radiusScale(theme.radius);
  if (scale) {
    for (const [k, v] of Object.entries(scale)) root.style.setProperty(k, v);
  }
}

// 캔버스 스코프 프리뷰 — 드래프트 테마를 폰 프레임 div 범위에만 적용할 클래스·인라인
// 변수를 산출하는 순수 함수(문서 전역 오염 없음). mode는 dark/light 클래스로 강제하고
// (light는 다크 문서 안 강제용 — globals.css의 .light 재선언 블록 참조), accent·radius는
// 인라인 CSS 변수라 프레임 이하에서만 유효하다. 기본 테마(undefined·빈 객체)는
// { className: "", style: undefined } — 프레임 DOM이 현행과 동일(회귀 0).
export function canvasThemeStyle(theme?: ThemeSpec): {
  className: string;
  style?: CSSProperties;
} {
  let className = "";
  const vars: Record<string, string> = {};
  if (theme) {
    // auto·무효 mode는 클래스 없음 = 문서 테마 상속(프리뷰어의 현재 화면과 동일 판정).
    if (theme.mode === "dark") className = "dark";
    else if (theme.mode === "light") className = "light";
    if (theme.accent && HEX_RE.test(theme.accent)) vars["--accent"] = theme.accent;
    const scale = radiusScale(theme.radius);
    if (scale) Object.assign(vars, scale);
  }
  return {
    className,
    style: Object.keys(vars).length > 0 ? (vars as CSSProperties) : undefined,
  };
}
