import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig의 jsx:"preserve"(Next 기본)를 그대로 두면 vitest가 JSX를 변환하지 못하므로
  // 테스트에서는 automatic 런타임으로 강제한다(vite 8는 rolldown 기반 — oxc 옵션).
  oxc: { jsx: { runtime: "automatic" } },
  test: { environment: "jsdom", setupFiles: ["./vitest.setup.ts"], globals: true },
});
