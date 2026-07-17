import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      // Semantic tokens backed by CSS variables (see globals.css) so light/dark
      // switch with the `.dark` class on <html>.
      colors: {
        bg: "var(--bg)",
        card: "var(--card)",
        card2: "var(--card2)",
        line: "var(--line)",
        fg: "var(--fg)",
        muted: "var(--muted)",
        danger: "var(--danger)",
        accent: {
          DEFAULT: "var(--accent)",
          fg: "var(--accent-fg)",
        },
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)",
      },
      // 모서리 토큰 — globals.css :root의 --r-* 변수를 소비한다(폴백=Tailwind 기본값
      // 0.5/0.75/1rem → 변수 미로드 시에도 회귀 0). applyTheme(theme.radius)가 문서
      // 전역을, 스튜디오 캔버스는 canvasThemeStyle이 프레임 스코프로 덮어쓴다.
      // 전수 grep 결과 스케일 대상은 lg/xl/2xl 계열뿐(rounded-md/sm/3xl 사용처 0).
      // rounded(기본)·rounded-full·rounded-[2rem](폰 프레임)은 의도적으로 제외.
      borderRadius: {
        lg: "var(--r-lg, 0.5rem)",
        xl: "var(--r-xl, 0.75rem)",
        "2xl": "var(--r-2xl, 1rem)",
      },
      keyframes: {
        shake: {
          "0%,100%": { transform: "translateX(0)" },
          "20%,60%": { transform: "translateX(-7px)" },
          "40%,80%": { transform: "translateX(7px)" },
        },
      },
      animation: { shake: "shake 0.4s ease-in-out" },
    },
  },
  plugins: [],
};

export default config;
