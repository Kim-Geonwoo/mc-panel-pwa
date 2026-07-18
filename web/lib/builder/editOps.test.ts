import { describe, it, expect } from "vitest";
import { BlockSchema, type Block } from "./schema";
import {
  getAt,
  insertAt,
  removeAt,
  moveNode,
  updateProps,
  duplicateAt,
  wrapAt,
  unwrapAt,
  countNodes,
  maxDepth,
  type BlockPath,
} from "./editOps";

// 고정 트리 — props.key로 노드 정체를 추적한다(재정렬 검증이 읽기 쉽도록).
//   root(vstack)
//   ├─ [0] A(text)
//   ├─ [1] B(hstack) ── [1,0] B1(logo), [1,1] B2(spacer)
//   └─ [2] C(button)
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
    { type: "button", props: { key: "C" } },
  ],
});

const keysOf = (b: Block | null) => (b?.children ?? []).map((c) => c.props?.key);

describe("getAt", () => {
  it("returns the root itself for []", () => {
    const tr = base();
    expect(getAt(tr, [])).toBe(tr);
  });

  it("resolves nested paths", () => {
    const tr = base();
    expect(getAt(tr, [1])?.props?.key).toBe("B");
    expect(getAt(tr, [1, 1])?.props?.key).toBe("B2");
  });

  it("returns null for out-of-range or impossible paths", () => {
    const tr = base();
    expect(getAt(tr, [9])).toBeNull();
    expect(getAt(tr, [-1])).toBeNull();
    expect(getAt(tr, [0, 0])).toBeNull(); // leaf 아래로는 내려갈 수 없다
    expect(getAt(tr, [1, 0, 0, 0])).toBeNull();
  });
});

describe("insertAt", () => {
  it("inserts into children at the given index", () => {
    const tr = base();
    const res = insertAt(tr, [], 1, { type: "text", props: { key: "N" } });
    expect(keysOf(res)).toEqual(["A", "N", "B", "C"]);
  });

  it("clamps the index (negative to 0, overflow to the end)", () => {
    const tr = base();
    expect(keysOf(insertAt(tr, [], -5, { type: "text", props: { key: "N" } }))).toEqual(["N", "A", "B", "C"]);
    expect(keysOf(insertAt(tr, [], 99, { type: "text", props: { key: "N" } }))).toEqual(["A", "B", "C", "N"]);
  });

  it("creates the children array when inserting under a leaf", () => {
    const tr = base();
    const res = insertAt(tr, [0], 0, { type: "text", props: { key: "N" } });
    expect(keysOf(getAt(res, [0]))).toEqual(["N"]);
  });

  it("assigns props.key to the block and all descendants missing one", () => {
    const tr = base();
    const block: Block = { type: "vstack", children: [{ type: "text" }, { type: "spacer" }] };
    const res = insertAt(tr, [], 0, block);
    const added = getAt(res, [0])!;
    const keys = [added, ...(added.children ?? [])].map((n) => n.props?.key);
    for (const k of keys) expect(typeof k).toBe("string");
    expect(new Set(keys).size).toBe(keys.length); // 자동 부여 key는 서로 달라야 한다
    expect(block.props?.key).toBeUndefined(); // 원본 block은 변형하지 않는다(사본 삽입)
  });

  it("preserves an existing props.key", () => {
    const tr = base();
    const res = insertAt(tr, [], 0, { type: "text", props: { key: "keep", ko: "x" } });
    expect(getAt(res, [0])?.props).toEqual({ key: "keep", ko: "x" });
  });

  it("does not mutate the input tree and shares untouched subtrees", () => {
    const tr = base();
    const snapshot = structuredClone(tr);
    const res = insertAt(tr, [1], 0, { type: "text", props: { key: "N" } });
    expect(tr).toEqual(snapshot); // 원본 불변
    expect(res).not.toBe(tr);
    expect(res.children?.[0]).toBe(tr.children?.[0]); // 변경 경로 밖은 참조 공유
    expect(res.children?.[2]).toBe(tr.children?.[2]);
    expect(res.children?.[1]).not.toBe(tr.children?.[1]); // 변경 경로는 새 객체
  });

  it("returns the original tree for an invalid parent path", () => {
    const tr = base();
    expect(insertAt(tr, [9], 0, { type: "text" })).toBe(tr);
    expect(insertAt(tr, [0, 3], 0, { type: "text" })).toBe(tr);
  });
});

describe("removeAt", () => {
  it("removes a top-level child", () => {
    const tr = base();
    expect(keysOf(removeAt(tr, [1]))).toEqual(["A", "C"]);
  });

  it("removes a nested child immutably", () => {
    const tr = base();
    const res = removeAt(tr, [1, 0]);
    expect(keysOf(getAt(res, [1]))).toEqual(["B2"]);
    expect(keysOf(getAt(tr, [1]))).toEqual(["B1", "B2"]); // 원본 불변
    expect(res.children?.[0]).toBe(tr.children?.[0]); // 참조 공유
  });

  it("refuses to remove the root", () => {
    const tr = base();
    expect(removeAt(tr, [])).toBe(tr);
  });

  it("returns the original tree for an invalid path", () => {
    const tr = base();
    expect(removeAt(tr, [9])).toBe(tr);
    expect(removeAt(tr, [0, 0])).toBe(tr);
    expect(removeAt(tr, [1, 5])).toBe(tr);
  });
});

describe("moveNode", () => {
  it("reorders forward within the same parent (index corrected after removal)", () => {
    const tr = base();
    // toIndex는 제거 전 좌표: "원래 인덱스 2 앞" — 제거 후 1로 보정되어 [B, A, C]
    expect(keysOf(moveNode(tr, [0], [], 2))).toEqual(["B", "A", "C"]);
    expect(keysOf(moveNode(tr, [0], [], 3))).toEqual(["B", "C", "A"]); // 맨 끝으로
  });

  it("reorders backward within the same parent (no correction)", () => {
    const tr = base();
    expect(keysOf(moveNode(tr, [2], [], 0))).toEqual(["C", "A", "B"]);
  });

  it("moves into a different parent, adjusting sibling paths shifted by removal", () => {
    const tr = base();
    // A([0]) 제거로 B가 [0]이 되므로 toParentPath [1]은 내부에서 보정되어야 한다
    const res = moveNode(tr, [0], [1], 1);
    expect(keysOf(res)).toEqual(["B", "C"]);
    expect(keysOf(getAt(res, [0]))).toEqual(["B1", "A", "B2"]);
    expect(keysOf(tr)).toEqual(["A", "B", "C"]); // 원본 불변
  });

  it("refuses to move a node into itself or its descendant", () => {
    const tr = base();
    expect(moveNode(tr, [1], [1], 0)).toBe(tr); // 자기 자신을 부모로
    expect(moveNode(tr, [1], [1, 0], 0)).toBe(tr); // 자기 자손을 부모로
  });

  it("refuses to move the root", () => {
    const tr = base();
    expect(moveNode(tr, [], [1], 0)).toBe(tr);
  });

  it("returns the original tree for an invalid fromPath", () => {
    const tr = base();
    expect(moveNode(tr, [9], [], 0)).toBe(tr);
  });

  it("returns the original tree (node not lost) for an invalid toParentPath", () => {
    const tr = base();
    const res = moveNode(tr, [0], [2, 0], 0); // C(leaf)의 자식은 존재하지 않는 부모
    expect(res).toBe(tr);
    expect(keysOf(tr)).toEqual(["A", "B", "C"]);
  });
});

describe("updateProps", () => {
  it("replaces props wholesale", () => {
    const tr = base();
    const res = updateProps(tr, [1, 0], { ko: "x", key: "Z" });
    expect(getAt(res, [1, 0])?.props).toEqual({ ko: "x", key: "Z" });
  });

  it("keeps the existing props.key when the new props omit it", () => {
    const tr = base();
    const passed = { ko: "x" };
    const res = updateProps(tr, [0], passed);
    expect(getAt(res, [0])?.props).toEqual({ ko: "x", key: "A" });
    expect(passed).toEqual({ ko: "x" }); // 호출자 객체를 변형하지 않는다
    expect(getAt(res, [0])?.props).not.toBe(passed); // 별도 사본(외부 변형 격리)
  });

  it("preserves children and does not mutate the input tree", () => {
    const tr = base();
    const res = updateProps(tr, [1], { align: "center" });
    expect(keysOf(getAt(res, [1]))).toEqual(["B1", "B2"]);
    expect(getAt(tr, [1])?.props).toEqual({ key: "B" });
  });

  it("returns the original tree for an invalid path", () => {
    const tr = base();
    expect(updateProps(tr, [9], { ko: "x" })).toBe(tr);
    expect(updateProps(tr, [0, 0], { ko: "x" })).toBe(tr);
  });
});

// 트리의 모든 문자열 key 수집 — 재발급 유일성 검증용(루트처럼 key 없는 노드는 제외).
const collectKeys = (b: Block, acc: string[] = []): string[] => {
  if (typeof b.props?.key === "string") acc.push(b.props.key);
  for (const c of b.children ?? []) collectKeys(c, acc);
  return acc;
};

// n단 vstack 사슬(maxDepth === n). 깊이 경계 테스트용.
const chain = (n: number): Block =>
  n <= 1 ? { type: "text", props: { key: `d${n}` } } : { type: "vstack", props: { key: `d${n}` }, children: [chain(n - 1)] };

describe("duplicateAt", () => {
  it("inserts the copy as the next sibling with a fresh key", () => {
    const tr = base();
    const res = duplicateAt(tr, [0]);
    expect(keysOf(res).slice(0, 1)).toEqual(["A"]);
    expect(keysOf(res).slice(2)).toEqual(["B", "C"]);
    const copy = getAt(res, [1])!;
    expect(copy.type).toBe("text");
    expect(typeof copy.props?.key).toBe("string");
    expect(copy.props?.key).not.toBe("A"); // 원본 key 재사용 금지
  });

  it("re-keys every descendant of the copy (zero duplicates in the whole tree)", () => {
    const tr = base();
    const res = duplicateAt(tr, [1]);
    const copy = getAt(res, [2])!;
    expect(copy.type).toBe("hstack");
    expect((copy.children ?? []).map((c) => c.type)).toEqual(["logo", "spacer"]); // 구조는 동일
    const keys = collectKeys(res);
    expect(keys).toHaveLength(8); // 원본 5(A·B·B1·B2·C) + 사본 3(hstack·logo·spacer)
    expect(new Set(keys).size).toBe(keys.length); // key 중복 0
  });

  it("does not mutate the input and shares untouched subtrees", () => {
    const tr = base();
    const snapshot = structuredClone(tr);
    const res = duplicateAt(tr, [1, 0]);
    expect(tr).toEqual(snapshot);
    expect(res.children?.[0]).toBe(tr.children?.[0]); // 변경 경로 밖은 참조 공유
    expect(res.children?.[2]).toBe(tr.children?.[2]);
    expect(keysOf(getAt(res, [1]))).toContain("B2");
  });

  it("returns the original tree for the root or an invalid path", () => {
    const tr = base();
    expect(duplicateAt(tr, [])).toBe(tr); // 루트는 형제 자리가 없다
    expect(duplicateAt(tr, [9])).toBe(tr);
    expect(duplicateAt(tr, [0, 0])).toBe(tr);
  });
});

describe("wrapAt", () => {
  it("replaces the node with a wrapper holding it (wrapper keyed, node key kept)", () => {
    const tr = base();
    const res = wrapAt(tr, [0], "hstack");
    const wrapper = getAt(res, [0])!;
    expect(wrapper.type).toBe("hstack");
    expect(typeof wrapper.props?.key).toBe("string");
    expect(wrapper.children).toHaveLength(1);
    expect(getAt(res, [0, 0])?.props?.key).toBe("A"); // 감싸인 노드는 기존 key 보존
    expect(getAt(res, [0, 0])).toBe(tr.children?.[0]); // 노드 자체는 참조 그대로
  });

  it("wraps a nested container without touching siblings", () => {
    const tr = base();
    const res = wrapAt(tr, [1], "vstack");
    expect(getAt(res, [1])?.type).toBe("vstack");
    expect(getAt(res, [1, 0])?.props?.key).toBe("B");
    expect(keysOf(getAt(res, [1, 0]))).toEqual(["B1", "B2"]);
    expect(res.children?.[0]).toBe(tr.children?.[0]);
    expect(keysOf(tr)).toEqual(["A", "B", "C"]); // 원본 불변
  });

  it("refuses to wrap the root or an invalid path", () => {
    const tr = base();
    expect(wrapAt(tr, [], "vstack")).toBe(tr);
    expect(wrapAt(tr, [9], "vstack")).toBe(tr);
  });

  it("allows wrapping up to depth 20 and refuses beyond (depth boundary)", () => {
    // 19단 사슬의 잎(경로 길이 18)을 감싸면 결과 깊이 20 — 허용 경계.
    const ok = chain(19);
    const leafPath: BlockPath = Array(18).fill(0);
    const wrapped = wrapAt(ok, leafPath, "vstack");
    expect(wrapped).not.toBe(ok);
    expect(maxDepth(wrapped)).toBe(20);
    // 20단 사슬의 잎을 감싸면 21 — 한도 초과로 원본 반환.
    const full = chain(20);
    expect(wrapAt(full, Array(19).fill(0) as BlockPath, "vstack")).toBe(full);
  });
});

describe("unwrapAt", () => {
  it("promotes children in place, preserving order and keys", () => {
    const tr = base();
    const res = unwrapAt(tr, [1]);
    expect(keysOf(res)).toEqual(["A", "B1", "B2", "C"]); // 순서 보존
    expect(res.children?.[1]).toBe(tr.children?.[1]?.children?.[0]); // 승격 자식은 참조 그대로
    expect(res.children?.[2]).toBe(tr.children?.[1]?.children?.[1]);
  });

  it("does not mutate the input tree", () => {
    const tr = base();
    const snapshot = structuredClone(tr);
    unwrapAt(tr, [1]);
    expect(tr).toEqual(snapshot);
  });

  it("returns the original tree for the root, a leaf, or empty children", () => {
    const tr = base();
    expect(unwrapAt(tr, [])).toBe(tr); // 루트
    expect(unwrapAt(tr, [0])).toBe(tr); // 비컨테이너(leaf)
    const withEmpty: Block = { type: "vstack", children: [{ type: "vstack", props: { key: "E" }, children: [] }] };
    expect(unwrapAt(withEmpty, [0])).toBe(withEmpty); // 빈 children
  });

  it("returns the original tree for an invalid path", () => {
    const tr = base();
    expect(unwrapAt(tr, [9])).toBe(tr);
    expect(unwrapAt(tr, [1, 5])).toBe(tr);
  });
});

describe("countNodes / maxDepth", () => {
  it("counts a single node as 1 with depth 1", () => {
    expect(countNodes({ type: "text" })).toBe(1);
    expect(maxDepth({ type: "text" })).toBe(1);
  });

  it("counts nested trees (root depth = 1)", () => {
    const tr = base();
    expect(countNodes(tr)).toBe(6);
    expect(maxDepth(tr)).toBe(3);
  });
});

describe("random operation fuzzing", () => {
  it("never throws and keeps the tree a valid Block over 100 random ops", () => {
    // 시드 고정 의사난수(mulberry32) — BlockRenderer.test.tsx와 동일한 재현 가능 난수.
    let s = 20260717;
    const rnd = () => {
      s |= 0; s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    // 유효/무효가 섞인 무작위 경로 — 실제 트리를 따라가되 가끔 범위 밖 인덱스를 낸다.
    const randPath = (root: Block): BlockPath => {
      const path: BlockPath = [];
      let node: Block | undefined = root;
      const depth = Math.floor(rnd() * 4);
      for (let d = 0; d < depth; d++) {
        const len: number = node?.children?.length ?? 0;
        const i: number = Math.floor(rnd() * (len + 2)) - 1; // -1 ~ len
        path.push(i);
        node = node?.children?.[i];
      }
      return path;
    };

    let tr = base();
    for (let k = 0; k < 100; k++) {
      const op = Math.floor(rnd() * 5);
      const before = countNodes(tr);
      if (op === 0) {
        tr = insertAt(tr, randPath(tr), Math.floor(rnd() * 8) - 2, {
          type: "text",
          props: { ko: `r${k}` },
          ...(rnd() < 0.3 ? { children: [{ type: "spacer" }] } : {}),
        });
      } else if (op === 1) {
        tr = removeAt(tr, randPath(tr));
      } else if (op === 2) {
        const next = moveNode(tr, randPath(tr), randPath(tr), Math.floor(rnd() * 8) - 2);
        expect(countNodes(next)).toBe(before); // 이동은 노드를 만들거나 잃지 않는다
        tr = next;
      } else if (op === 3) {
        tr = updateProps(tr, randPath(tr), { n: k });
      } else {
        getAt(tr, randPath(tr));
      }
      expect(BlockSchema.safeParse(tr).success).toBe(true);
    }
  });

  it("keeps invariants over 100 random duplicate/wrap/unwrap ops", () => {
    let s = 20260718;
    const rnd = () => {
      s |= 0; s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const randPath = (root: Block): BlockPath => {
      const path: BlockPath = [];
      let node: Block | undefined = root;
      const depth = Math.floor(rnd() * 4);
      for (let d = 0; d < depth; d++) {
        const len: number = node?.children?.length ?? 0;
        const i: number = Math.floor(rnd() * (len + 2)) - 1; // -1 ~ len(무효 섞임)
        path.push(i);
        node = node?.children?.[i];
      }
      return path;
    };

    let tr = base();
    for (let k = 0; k < 100; k++) {
      const op = Math.floor(rnd() * 3);
      if (op === 0) {
        // 복제는 노드 수를 늘리므로 스키마 상한(500)에 닿지 않게 가드한다 —
        // 실제 앱에서는 발행 사전검사가 막는 영역이라 퍼저에서만 제한한다.
        tr = countNodes(tr) <= 250 ? duplicateAt(tr, randPath(tr)) : removeAt(tr, randPath(tr));
      } else if (op === 1) {
        tr = wrapAt(tr, randPath(tr), rnd() < 0.5 ? "vstack" : "hstack");
      } else {
        tr = unwrapAt(tr, randPath(tr));
      }
      expect(BlockSchema.safeParse(tr).success).toBe(true);
      expect(maxDepth(tr)).toBeLessThanOrEqual(20); // wrapAt 깊이 가드 불변식
      const keys = collectKeys(tr);
      expect(new Set(keys).size).toBe(keys.length); // 재발급 key 유일성 — 중복 0
    }
  });
});
