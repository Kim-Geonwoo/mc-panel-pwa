import { describe, it, expect } from "vitest";
import { placeMenu, nextItemIndex, edgeItemIndex, type ContextMenuItem } from "./contextMenu";

// 뷰포트 1000×600, 메뉴 200×150 고정으로 배치 수식을 검증한다.
const place = (x: number, y: number) => placeMenu(x, y, 200, 150, 1000, 600);

describe("placeMenu", () => {
  it("keeps the menu at the pointer when there is room", () => {
    expect(place(100, 100)).toEqual({ left: 100, top: 100 });
  });

  it("clamps horizontally against the right edge (shift, not flip)", () => {
    // 1000 - 200 - 4(여백) = 796
    expect(place(950, 100)).toEqual({ left: 796, top: 100 });
  });

  it("clamps horizontally against the left edge", () => {
    expect(place(-30, 100)).toEqual({ left: 4, top: 100 });
  });

  it("flips above the pointer when the bottom lacks space", () => {
    // 500 + 150 + 4 > 600 → top = 500 - 150 = 350
    expect(place(100, 500)).toEqual({ left: 100, top: 350 });
  });

  it("clamps after flipping when the top also lacks space", () => {
    // 590에서 flip하면 440 — 아래 클램프 한도(600-150-4=446) 안이라 그대로,
    // 100에서는 flip 불필요. 매우 작은 뷰포트에서 flip 결과가 음수면 여백으로 클램프.
    expect(placeMenu(10, 60, 200, 150, 1000, 100)).toEqual({ left: 10, top: 4 });
  });

  it("falls back to the margin when the menu is larger than the viewport", () => {
    expect(placeMenu(50, 50, 2000, 1000, 1000, 600)).toEqual({ left: 4, top: 4 });
  });
});

const item = (id: string, disabled = false): ContextMenuItem => ({ id, label: id, disabled, onRun: () => {} });

describe("nextItemIndex / edgeItemIndex", () => {
  // [실행, 구분선, disabled, 실행] — 구분선만 건너뛰고 disabled는 포커스 대상.
  const items: ContextMenuItem[] = [item("a"), "separator", item("b", true), item("c")];

  it("moves forward skipping separators and wraps around", () => {
    expect(nextItemIndex(items, 0, 1)).toBe(2); // separator 스킵, disabled 포함
    expect(nextItemIndex(items, 2, 1)).toBe(3);
    expect(nextItemIndex(items, 3, 1)).toBe(0); // 순환
  });

  it("moves backward skipping separators and wraps around", () => {
    expect(nextItemIndex(items, 0, -1)).toBe(3); // 역방향 순환
    expect(nextItemIndex(items, 3, -1)).toBe(2);
    expect(nextItemIndex(items, 2, -1)).toBe(0);
  });

  it("normalizes an out-of-range current index without throwing", () => {
    expect(nextItemIndex(items, -1, 1)).toBe(0);
    expect(nextItemIndex(items, 99, 1)).toBe(0);
  });

  it("returns -1 when there is nothing to focus", () => {
    expect(nextItemIndex([], 0, 1)).toBe(-1);
    expect(nextItemIndex(["separator"], 0, 1)).toBe(-1);
    expect(edgeItemIndex([], "first")).toBe(-1);
    expect(edgeItemIndex(["separator", "separator"], "last")).toBe(-1);
  });

  it("finds the first and last actionable items", () => {
    expect(edgeItemIndex(items, "first")).toBe(0);
    expect(edgeItemIndex(items, "last")).toBe(3);
    expect(edgeItemIndex(["separator", item("x")], "first")).toBe(1);
  });
});
