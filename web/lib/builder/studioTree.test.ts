import { describe, expect, it } from "vitest";
import type { Block, Layout } from "./schema";
import { moveNode } from "./editOps";
import { TAB_ROOT_TYPE, getScopeRoot, writeScopeRoot, type EditScope } from "./studioScope";
import {
  dragRows,
  flattenScoped,
  flattenScreen,
  ghostTabContent,
  isDescendant,
  isSamePosition,
  keyedBlocks,
  keyedScreen,
  projectDrop,
  renameProps,
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

describe("keyedBlocks", () => {
  it("assigns keys across the array (descendants included), keeps existing keys, never mutates", () => {
    const src: Block[] = [
      { type: "text" },
      { type: "vstack", children: [{ type: "logo", props: { key: "keep" } }, { type: "spacer" }] },
    ];
    const out = keyedBlocks(src);
    expect(out).toHaveLength(2);
    expect(typeof out[0].props?.key).toBe("string");
    expect(typeof out[1].props?.key).toBe("string");
    expect(out[1].children?.[0].props?.key).toBe("keep");
    expect(typeof out[1].children?.[1].props?.key).toBe("string");
    expect(src[0].props).toBeUndefined(); // 원본 불변
    expect(keyedBlocks([])).toEqual([]);
  });
});

describe("flattenScoped", () => {
  it("prefixes row ids with the scope while keeping paths and depths", () => {
    const rows = flattenScoped(base(), { kind: "screen" });
    expect(rows.map((r) => r.id)).toEqual(["s|0", "s|1", "s|1.0", "s|1.1", "s|2"]);
    const tabRows = flattenScoped(base(), { kind: "tab", tabId: "chat" });
    expect(tabRows.map((r) => r.id)).toEqual(["t:chat|0", "t:chat|1", "t:chat|1.0", "t:chat|1.1", "t:chat|2"]);
    expect(tabRows.map((r) => r.depth)).toEqual([0, 0, 1, 1, 0]);
    expect(tabRows.map((r) => r.path)).toEqual([[0], [1], [1, 0], [1, 1], [2]]);
  });
});

describe("ghostTabContent", () => {
  const label = { ko: "탭", en: "Tab" };

  it("returns the default mapping for a known tab without explicit content", () => {
    expect(ghostTabContent({ id: "chat", label })).toEqual([{ type: "chat-feed" }]);
    expect(ghostTabContent({ id: "perf", label })).toEqual([{ type: "perf-view" }]);
  });

  it("treats an explicit empty array as missing (same fallback rule as planTabContent)", () => {
    expect(ghostTabContent({ id: "timeline", label, content: [] })).toEqual([
      { type: "timeline-view" },
    ]);
  });

  it("returns null when explicit content exists or there is no default mapping", () => {
    expect(ghostTabContent({ id: "chat", label, content: [{ type: "text" }] })).toBeNull();
    expect(ghostTabContent({ id: "info", label })).toBeNull(); // 미지 탭 = 빈 편집 가능 섹션
  });
});

describe("renameProps", () => {
  it("sets a trimmed, 40-char-clamped name and keeps other keys (key included)", () => {
    const out = renameProps({ key: "k1", ko: "x" }, `  ${"a".repeat(50)}  `);
    expect(out).toEqual({ key: "k1", ko: "x", name: "a".repeat(40) });
  });

  it("removes the name key on an empty (or whitespace) value", () => {
    expect(renameProps({ key: "k1", name: "old" }, "   ")).toEqual({ key: "k1" });
  });

  it("returns null when nothing changes (same value / empty on a nameless node)", () => {
    expect(renameProps({ name: "same", key: "k1" }, " same ")).toBeNull();
    expect(renameProps({ key: "k1" }, "")).toBeNull();
    expect(renameProps(undefined, "  ")).toBeNull();
  });
});

describe("tab-scope drag round trip", () => {
  it("projectDrop with scoped ids feeds moveNode and writes back into tabs[].content", () => {
    const content: Block[] = [
      { type: "text", props: { key: "a" } },
      { type: "vstack", props: { key: "b" }, children: [] },
      { type: "logo", props: { key: "c" } },
    ];
    const l: Layout = {
      version: 1,
      tabs: [{ id: "chat", label: { ko: "채팅", en: "Chat" }, content }],
    };
    const scope: EditScope = { kind: "tab", tabId: "chat" };
    const root = getScopeRoot(l, scope, { type: "vstack" })!;
    const rows = flattenScoped(root, scope);
    // 가상 탭 루트를 컨테이너로 인정해야 depth 0 재배치가 가능하다(StructureTree와 동일 규칙).
    const isC = (t: string) => t === TAB_ROOT_TYPE || t === "vstack";
    const tgt = projectDrop(root, rows, "t:chat|0", "t:chat|2", 0, INDENT, isC)!;
    expect(tgt).toEqual({ parentPath: [], index: 3, depth: 0 });
    const out = writeScopeRoot(l, scope, moveNode(root, [0], tgt.parentPath, tgt.index));
    expect(out.tabs![0].content!.map((b) => b.props?.key)).toEqual(["b", "c", "a"]);
    expect(JSON.stringify(out)).not.toContain(TAB_ROOT_TYPE); // 가상 루트 미유입
    expect(l.tabs![0].content!.map((b) => b.props?.key)).toEqual(["a", "b", "c"]); // 원본 불변
  });
});
