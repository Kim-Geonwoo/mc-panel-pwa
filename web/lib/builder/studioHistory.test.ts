import { describe, expect, it } from "vitest";
import type { Layout } from "./schema";
import {
  canRedo,
  canUndo,
  initHistory,
  pushHistory,
  redoHistory,
  undoHistory,
} from "./studioHistory";

const L = (title: string): Layout => ({ version: 1, meta: { title } });

describe("studioHistory", () => {
  it("starts with nothing to undo or redo", () => {
    const h = initHistory(L("a"));
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it("push then undo restores the previous present", () => {
    let h = initHistory(L("a"));
    h = pushHistory(h, L("b"));
    expect(canUndo(h)).toBe(true);
    h = undoHistory(h);
    expect(h.present.meta?.title).toBe("a");
    expect(canRedo(h)).toBe(true);
  });

  it("redo re-applies an undone state", () => {
    let h = pushHistory(initHistory(L("a")), L("b"));
    h = undoHistory(h);
    h = redoHistory(h);
    expect(h.present.meta?.title).toBe("b");
    expect(canRedo(h)).toBe(false);
  });

  it("a new push clears the redo stack", () => {
    let h = pushHistory(initHistory(L("a")), L("b"));
    h = undoHistory(h);
    h = pushHistory(h, L("c"));
    expect(canRedo(h)).toBe(false);
    expect(h.present.meta?.title).toBe("c");
  });

  it("ignores pushes of the identical reference (no-op edits)", () => {
    const h0 = initHistory(L("a"));
    expect(pushHistory(h0, h0.present)).toBe(h0);
  });

  it("caps the past at the limit, dropping the oldest", () => {
    let h = initHistory(L("0"));
    for (let i = 1; i <= 60; i++) h = pushHistory(h, L(String(i)), 50);
    expect(h.past.length).toBe(50);
    // 가장 오래된 것부터 잘려나가므로 남은 past의 첫 항목은 10이다.
    expect(h.past[0].meta?.title).toBe("10");
    expect(h.present.meta?.title).toBe("60");
  });

  it("undo/redo at the boundary are no-ops", () => {
    const h = initHistory(L("a"));
    expect(undoHistory(h)).toBe(h);
    expect(redoHistory(h)).toBe(h);
  });
});
