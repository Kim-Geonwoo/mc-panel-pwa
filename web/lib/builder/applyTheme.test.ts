import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { applyTheme, canvasThemeStyle, RADIUS_SCALE } from "./applyTheme";
import type { ThemeSpec } from "./schema";

// 문서 상태(스타일·클래스)와 수동 선택(localStorage)을 매 테스트 전 초기화한다.
beforeEach(() => {
  document.documentElement.removeAttribute("style");
  document.documentElement.className = "";
  localStorage.removeItem("theme");
});
afterEach(() => vi.unstubAllGlobals());

describe("applyTheme", () => {
  it("sets --accent for a valid hex color", () => {
    applyTheme({ accent: "#123456" });
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#123456");
  });

  it("ignores an invalid accent (no injection)", () => {
    applyTheme({ accent: "url(x);color:red" as unknown as `#${string}` });
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("");
  });

  it("no-ops without a theme", () => {
    applyTheme(undefined);
    expect(document.documentElement.getAttribute("style")).toBeNull();
    expect(document.documentElement.className).toBe("");
  });

  it("applies mode=dark when there is no manual selection", () => {
    applyTheme({ mode: "dark" });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("applies mode=light by removing the dark class", () => {
    document.documentElement.classList.add("dark");
    applyTheme({ mode: "light" });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("applies mode=auto from prefers-color-scheme", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    applyTheme({ mode: "auto" });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("does not touch mode when a manual selection exists (ThemeToggle 우선)", () => {
    localStorage.setItem("theme", "dark");
    document.documentElement.classList.add("dark");
    applyTheme({ mode: "light" });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("ignores an invalid mode (dark 클래스 불변)", () => {
    document.documentElement.classList.add("dark");
    applyTheme({ mode: "blink" as unknown as ThemeSpec["mode"] });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it.each(["sm", "md", "lg"] as const)("sets the 3 radius variables for %s", (r) => {
    applyTheme({ radius: r });
    const st = document.documentElement.style;
    expect(st.getPropertyValue("--r-lg")).toBe(RADIUS_SCALE[r]["--r-lg"]);
    expect(st.getPropertyValue("--r-xl")).toBe(RADIUS_SCALE[r]["--r-xl"]);
    expect(st.getPropertyValue("--r-2xl")).toBe(RADIUS_SCALE[r]["--r-2xl"]);
  });

  it("ignores an invalid radius (변수 미설정)", () => {
    applyTheme({ radius: "huge" as unknown as ThemeSpec["radius"] });
    expect(document.documentElement.style.getPropertyValue("--r-lg")).toBe("");
  });

  it("ignores a prototype-key radius (no prototype pollution read)", () => {
    applyTheme({ radius: "__proto__" as unknown as ThemeSpec["radius"] });
    expect(document.documentElement.getAttribute("style")).toBeNull();
  });
});

describe("canvasThemeStyle", () => {
  it("returns empty className and no style for a default theme (회귀 0)", () => {
    expect(canvasThemeStyle(undefined)).toEqual({ className: "", style: undefined });
    expect(canvasThemeStyle({})).toEqual({ className: "", style: undefined });
  });

  it("maps mode to a scoped class (auto = 상속)", () => {
    expect(canvasThemeStyle({ mode: "dark" }).className).toBe("dark");
    expect(canvasThemeStyle({ mode: "light" }).className).toBe("light");
    expect(canvasThemeStyle({ mode: "auto" }).className).toBe("");
  });

  it("maps radius to scoped --r-* variables", () => {
    const { style } = canvasThemeStyle({ radius: "lg" });
    expect(style).toEqual(RADIUS_SCALE.lg);
  });

  it("maps a valid accent to a scoped --accent variable", () => {
    const { style } = canvasThemeStyle({ accent: "#abcdef" });
    expect(style).toEqual({ "--accent": "#abcdef" });
  });

  it("drops invalid accent/radius (style 없음)", () => {
    const out = canvasThemeStyle({
      accent: "red" as unknown as `#${string}`,
      radius: "huge" as unknown as ThemeSpec["radius"],
    });
    expect(out).toEqual({ className: "", style: undefined });
  });

  it("does not mutate the document (순수 함수)", () => {
    canvasThemeStyle({ mode: "dark", radius: "lg", accent: "#123456" });
    expect(document.documentElement.getAttribute("style")).toBeNull();
    expect(document.documentElement.className).toBe("");
  });
});
