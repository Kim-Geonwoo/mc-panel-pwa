import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampPane,
  loadPanes,
  movePane,
  PANE_DEFAULTS,
  PANE_LIMITS,
  PANES_KEY,
  savePanes,
} from "./paneSize";

// jsdom의 localStorage를 그대로 쓴다 — 각 테스트가 남긴 상태를 정리한다.
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("clampPane", () => {
  it("passes through in-range widths, rounded to integers", () => {
    expect(clampPane("left", 240)).toBe(240);
    expect(clampPane("left", 240.6)).toBe(241);
    expect(clampPane("right", 320.4)).toBe(320);
  });

  it("clamps to per-side min/max", () => {
    expect(clampPane("left", 0)).toBe(PANE_LIMITS.left.min);
    expect(clampPane("left", 99999)).toBe(PANE_LIMITS.left.max);
    expect(clampPane("right", 0)).toBe(PANE_LIMITS.right.min);
    expect(clampPane("right", 99999)).toBe(PANE_LIMITS.right.max);
  });

  it("falls back to the side default for non-finite input", () => {
    expect(clampPane("left", NaN)).toBe(PANE_DEFAULTS.left);
    expect(clampPane("right", Infinity)).toBe(PANE_DEFAULTS.right);
    expect(clampPane("right", -Infinity)).toBe(PANE_DEFAULTS.right);
  });
});

describe("movePane", () => {
  it("grows the left pane when the handle moves right", () => {
    expect(movePane("left", 240, 16)).toBe(256);
    expect(movePane("left", 240, -16)).toBe(224);
  });

  it("grows the right pane when the handle moves left (mirrored)", () => {
    expect(movePane("right", 320, -16)).toBe(336);
    expect(movePane("right", 320, 16)).toBe(304);
  });

  it("clamps the moved width", () => {
    expect(movePane("left", 350, 100)).toBe(PANE_LIMITS.left.max);
    expect(movePane("left", 190, -100)).toBe(PANE_LIMITS.left.min);
    expect(movePane("right", 470, -100)).toBe(PANE_LIMITS.right.max);
    expect(movePane("right", 250, 100)).toBe(PANE_LIMITS.right.min);
  });
});

describe("loadPanes / savePanes", () => {
  it("roundtrips saved widths", () => {
    savePanes({ left: 300, right: 400 });
    expect(loadPanes()).toEqual({ left: 300, right: 400 });
  });

  it("returns defaults when nothing is stored", () => {
    expect(loadPanes()).toEqual(PANE_DEFAULTS);
  });

  it("returns defaults for corrupted JSON", () => {
    localStorage.setItem(PANES_KEY, "{not json");
    expect(loadPanes()).toEqual(PANE_DEFAULTS);
  });

  it("returns defaults for non-object payloads", () => {
    localStorage.setItem(PANES_KEY, JSON.stringify("wide"));
    expect(loadPanes()).toEqual(PANE_DEFAULTS);
    localStorage.setItem(PANES_KEY, JSON.stringify(null));
    expect(loadPanes()).toEqual(PANE_DEFAULTS);
  });

  it("returns defaults for wrong-typed fields", () => {
    localStorage.setItem(PANES_KEY, JSON.stringify({ left: "300", right: null }));
    expect(loadPanes()).toEqual(PANE_DEFAULTS);
  });

  it("clamps out-of-range stored widths", () => {
    localStorage.setItem(PANES_KEY, JSON.stringify({ left: 10, right: 99999 }));
    expect(loadPanes()).toEqual({
      left: PANE_LIMITS.left.min,
      right: PANE_LIMITS.right.max,
    });
  });

  it("keeps the valid side when only the other is invalid", () => {
    localStorage.setItem(PANES_KEY, JSON.stringify({ left: 300 }));
    expect(loadPanes()).toEqual({ left: 300, right: PANE_DEFAULTS.right });
  });

  it("returns defaults when storage reads throw", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(loadPanes()).toEqual(PANE_DEFAULTS);
  });

  it("does not throw when storage writes fail", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => savePanes(PANE_DEFAULTS)).not.toThrow();
  });
});
