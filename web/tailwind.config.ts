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
