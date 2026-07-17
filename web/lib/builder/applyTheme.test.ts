import { describe, it, expect, beforeEach } from "vitest";
import { applyTheme } from "./applyTheme";

describe("applyTheme", () => {
  beforeEach(() => document.documentElement.removeAttribute("style"));

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
  });
});
