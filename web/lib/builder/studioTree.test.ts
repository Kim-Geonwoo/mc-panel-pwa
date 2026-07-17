import { describe, expect, it } from "vitest";
import type { Block } from "./schema";
import {
  dragRows,
  flattenScreen,
  isDescendant,
  isSamePosition,
  keyedScreen,
  projectDrop,
  rowId,
} from "./studioTree";

// 고정 트리 — 컨테이너(vstack/hstack)와 leaf(text/logo/spacer)를 섞는다.
//   root(vstack)
//   ├─ [0] A(text)
//   ├─ [1] B(hstack) ── [1,0] B1(logo), [1,1] B2(spacer)
//   └─ [2] C(text)
const base = (): Block => ({
  type: "vstack",
  children: [
    { type: "text", props: { key: "A" } },
    {
      type: "hstack",
      props: { key: "B" },
      children: [
        { type: "logo", props: { key: "B1" } },
        { type: "spacer", props: { key: "B2" } },
      ],
    },
    { type: "text", props: { key: "C" } },
  ],
});

const isContainer = (t: string) => t === "vstack" || t === "hstack" || t === "header";
const INDENT = 20;

describe("flattenScreen", () => {
  it("lists descendants in DFS order with paths and depths", () => {
    const rows = flattenScreen(base());
    expect(rows.map((r) => r.id)).toEqual(["0", "1", "1.0", "1.1", "2"]);
    expect(rows.map((r) => r.depth)).toEqual([0, 0, 1, 1, 0]);
    expect(rowId([1, 0])).toBe("1.0");
  });
});

describe("dragRows / isDescendant", () => {
  it("removes the active node's descendants but keeps the node itself", () => {
    const rows = flattenScreen(base());
    expect(dragRows(rows, [1]).map((r) => r.id)).toEqual(["0", "1", "2"]);
    expect(isDescendant([1], [1, 0])).toBe(true);
    expect(isDescendant([1], [1])).toBe(false);
  });
});

describe("projectDrop", () => {
  it("reorders within the root (drag A after C)", () => {
    const rows = flattenScreen(base());
    expect(projectDrop(base(), rows, "0", "2", 0, INDENT, isContainer)).toEqual({
      parentPath: [],
      index: 3,
      depth: 0,
    });
  });

  it("nests into a container when dragged right (drag C between B1 and B2)", () => {
    const rows = flattenScreen(base());
    expect(projectDrop(base(), rows, "2", "1.1", INDENT, INDENT, isContainer)).toEqual({
      parentPath: [1],
      index: 1,
      depth: 1,
    });
  });

  it("drops as the first child when over a container row at depth+1", () => {
    const rows = flattenScreen(base());
    expect(projectDrop(base(), rows, "0", "1", INDENT, INDENT, isContainer)).toEqual({
      parentPath: [1],
      index: 0,
      depth: 1,
    });
  });

  it("un-nests when dragged left (drag B2 after C at root)", () => {
    const rows = flattenScreen(base());
    expect(projectDrop(base(), rows, "1.1", "2", -INDENT, INDENT, isContainer)).toEqual({
      parentPath: [],
      index: 3,
      depth: 0,
    });
  });

  it("refuses a leaf as parent and falls back to a shallower container", () => {
    const rows = flattenScreen(base());
    // C(text) 아래로 깊게 끌어도 부모는 컨테이너여야 하므로 루트의 형제로 낙착된다.
    expect(projectDrop(base(), rows, "1.0", "2", 3 * INDENT, INDENT, isContainer)).toEqual({
      parentPath: [],
      index: 3,
      depth: 0,
    });
  });

  it("returns null when over a descendant of the active node", () => {
    const rows = flattenScreen(base());
    expect(projectDrop(base(), rows, "1", "1.0", 0, INDENT, isContainer)).toBeNull();
  });

  it("returns null when no container parent exists at any depth", () => {
    const root: Block = { type: "text", children: [{ type: "spacer" }, { type: "spacer" }] };
    const rows = flattenScreen(root);
    expect(projectDrop(root, rows, "0", "1", 0, INDENT, isContainer)).toBeNull();
  });
});

describe("isSamePosition", () => {
  it("detects both no-op indices (fromIdx and fromIdx+1)", () => {
    expect(isSamePosition([1, 0], { parentPath: [1], index: 0, depth: 1 })).toBe(true);
    expect(isSamePosition([1, 0], { parentPath: [1], index: 1, depth: 1 })).toBe(true);
    expect(isSamePosition([1, 0], { parentPath: [1], index: 2, depth: 1 })).toBe(false);
    expect(isSamePosition([1, 0], { parentPath: [], index: 0, depth: 0 })).toBe(false);
  });
});

describe("keyedScreen", () => {
  it("assigns keys to key-less nodes, keeps existing keys, never mutates the input", () => {
    const src: Block = {
      type: "vstack",
      children: [{ type: "text" }, { type: "logo", props: { key: "keep" } }],
    };
    const out = keyedScreen(src);
    expect(typeof out.props?.key).toBe("string");
    expect(typeof out.children?.[0].props?.key).toBe("string");
    expect(out.children?.[1].props?.key).toBe("keep");
    expect(src.children?.[0].props).toBeUndefined(); // 원본 불변
  });
});
