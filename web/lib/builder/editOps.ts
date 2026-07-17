// SDUI 편집기의 트리 편집 순수 함수 — 렌더러/레지스트리 없이 단위 테스트할 수 있다.
// 불변식 두 가지: (1) 입력 트리를 절대 변형하지 않는다(변경 경로만 새 객체, 나머지는
// 참조 공유). (2) 절대 throw하지 않는다 — 잘못된 경로·불가 연산은 원본 트리를 그대로
// 반환한다(편집기 UI가 조용히 no-op 처리, BlockRenderer의 무중단 원칙과 동일).
import type { Block } from "./schema";

// 경로 모델: 루트 = [], 루트의 children[i] = [i], 그 자식 = [i, j] …
export type BlockPath = number[];

// key 자동 부여용 — crypto.randomUUID가 없는 런타임에서도 throw하지 않도록 폴백.
function newKey(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `k-${Math.random().toString(36).slice(2, 10)}`;
}

// 삽입용 사본 — 자손 포함, props.key(문자열)가 없는 노드에 새 key를 부여한다.
// blockKey(BlockRenderer)가 문자열 key만 인정하므로 비문자열 key도 새로 부여한다.
function withKeys(b: Block): Block {
  const key = typeof b.props?.key === "string" ? b.props.key : newKey();
  const out: Block = { ...b, props: { ...b.props, key } };
  if (b.children) out.children = b.children.map(withKeys);
  return out;
}

// 경로를 따라 내려가며 해당 노드만 replace 결과로 바꾼 새 트리를 만든다(경로 밖은
// 참조 공유). 경로가 무효하거나 replace가 null이면 null — 호출부가 원본 반환으로 처리.
function replaceAt(tree: Block, path: BlockPath, replace: (node: Block) => Block | null): Block | null {
  if (path.length === 0) return replace(tree);
  const [i, ...rest] = path;
  const child = tree.children?.[i];
  if (!child) return null;
  const next = replaceAt(child, rest, replace);
  if (next === null) return null;
  const children = [...tree.children!];
  children[i] = next;
  return { ...tree, children };
}

// path가 tail의 접두사인가(같음 포함) — 자기 자신/자손 이동 판정에 쓴다.
function isPrefix(path: BlockPath, tail: BlockPath): boolean {
  return path.length <= tail.length && path.every((v, i) => v === tail[i]);
}

export function getAt(tree: Block, path: BlockPath): Block | null {
  let node: Block | undefined = tree;
  for (const i of path) node = node?.children?.[i];
  return node ?? null;
}

// parentPath가 가리키는 블록의 children[index]에 삽입(index는 0..len 클램프).
// 삽입되는 block(자손 포함)에 props.key가 없으면 crypto.randomUUID()로 부여한 사본을
// 삽입한다 — 원본 block 객체는 변형하지 않는다.
export function insertAt(tree: Block, parentPath: BlockPath, index: number, block: Block): Block {
  return rawInsert(tree, parentPath, index, withKeys(block)) ?? tree;
}

// key 부여 없는 내부 삽입 — moveNode가 기존 key를 그대로 옮길 때 재사용한다.
function rawInsert(tree: Block, parentPath: BlockPath, index: number, block: Block): Block | null {
  return replaceAt(tree, parentPath, (parent) => {
    const kids = parent.children ?? [];
    const i = Math.max(0, Math.min(index, kids.length));
    return { ...parent, children: [...kids.slice(0, i), block, ...kids.slice(i)] };
  });
}

// 루트([]) 제거는 불가 — 원본 반환. 무효 경로도 원본 반환.
export function removeAt(tree: Block, path: BlockPath): Block {
  if (path.length === 0) return tree;
  const idx = path[path.length - 1];
  const next = replaceAt(tree, path.slice(0, -1), (parent) => {
    if (!parent.children?.[idx]) return null;
    return { ...parent, children: parent.children.filter((_, i) => i !== idx) };
  });
  return next ?? tree;
}

// 노드를 fromPath에서 떼어 toParentPath의 children[toIndex]로 옮긴다. 자기 자신
// 또는 자기 자손으로의 이동은 순환이므로 거부(원본 반환). toIndex/toParentPath는
// 제거 전 좌표로 받아, 제거로 앞당겨진 인덱스를 내부에서 보정한다(from<to면 -1).
export function moveNode(tree: Block, fromPath: BlockPath, toParentPath: BlockPath, toIndex: number): Block {
  if (fromPath.length === 0) return tree; // 루트는 이동 불가
  if (isPrefix(fromPath, toParentPath)) return tree; // 자기 자신/자손이 목적지
  const node = getAt(tree, fromPath);
  if (!node) return tree;
  const removed = removeAt(tree, fromPath);
  if (removed === tree) return tree;
  // 제거로 인한 좌표 보정 — 목적지가 같은 부모의 뒤쪽 형제(또는 그 하위)를 지나면
  // 해당 성분이 1 앞당겨진다. 같은 부모 자체가 목적지면 삽입 인덱스를 보정한다.
  const fromParent = fromPath.slice(0, -1);
  const fromIdx = fromPath[fromPath.length - 1];
  const parent = [...toParentPath];
  let index = toIndex;
  if (isPrefix(fromParent, parent)) {
    if (parent.length === fromParent.length) {
      if (fromIdx < index) index -= 1;
    } else if (parent[fromParent.length] > fromIdx) {
      parent[fromParent.length] -= 1;
    }
  }
  // 이동은 key를 건드리지 않는 순수 재배치. 삽입 실패(무효 목적지) 시 노드를 잃지
  // 않도록 전체 연산을 무효화하고 원본을 반환한다.
  return rawInsert(removed, parent, index, node) ?? tree;
}

// 해당 블록의 props를 통째로 교체한다. 단, 기존 props.key는 보존 — 새 props에 key가
// 없으면 유지한다(React key 안정성). 호출자가 준 props 객체는 변형하지 않는다.
export function updateProps(tree: Block, path: BlockPath, props: Record<string, unknown>): Block {
  const next = replaceAt(tree, path, (node) => {
    const merged: Record<string, unknown> = { ...props };
    if (!("key" in props) && node.props && "key" in node.props) merged.key = node.props.key;
    return { ...node, props: merged };
  });
  return next ?? tree;
}

export function countNodes(tree: Block): number {
  return 1 + (tree.children ?? []).reduce((n, c) => n + countNodes(c), 0);
}

// 루트 = 1. schema의 MAX_DEPTH 검사와 짝을 이루는 편집기 측 측정용.
export function maxDepth(tree: Block): number {
  return 1 + Math.max(0, ...(tree.children ?? []).map(maxDepth));
}
