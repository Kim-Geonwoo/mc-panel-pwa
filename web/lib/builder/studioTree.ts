// 구조 트리(스튜디오)의 순수 로직 — DFS 평탄화와 드롭 투영. dnd-kit 없이 단위
// 테스트한다. 드롭 투영은 dnd-kit SortableTree 예제의 방식을 따른다: 세로 위치는
// 정렬 목록의 over 인덱스가, 중첩 깊이는 드래그의 가로 이동량(dx)이 정한다.
// 결과는 editOps.moveNode가 기대하는 "제거 전 좌표"(parentPath, index)로 낸다.
import type { Block, TabSpec } from "./schema";
import { insertAt, type BlockPath } from "./editOps";
import { spathId, type EditScope } from "./studioScope";
import { planTabContent } from "./tabContentPlan";

export type FlatRow = { id: string; node: Block; path: BlockPath; depth: number };

// 행 id = 경로의 점 표기("0", "1.2" …). 트리가 바뀌면 재계산되므로 드래그 한 번
// 동안만 안정적이면 된다(드래그 중에는 트리를 바꾸지 않는다).
export function rowId(path: BlockPath): string {
  return path.join(".");
}

// 스코프 행 id("s|0.1" / "t:chat|2")로 평탄화한다 — 트리가 화면+탭별 섹션(각각
// 독립 DndContext)으로 나뉘어도 행 id는 패널 전역에서 유일해야 하므로 스코프를
// 접두한다. projectDrop 등은 id를 불투명 문자열로만 비교하므로 그대로 재사용된다.
export function flattenScoped(root: Block, scope: EditScope): FlatRow[] {
  return flattenScreen(root).map((r) => ({ ...r, id: spathId({ scope, path: r.path }) }));
}

// 루트 자신을 제외한 자손 전체를 DFS 순서로 평탄화한다(depth 0 = 루트의 자식).
export function flattenScreen(root: Block): FlatRow[] {
  const out: FlatRow[] = [];
  const walk = (b: Block, path: BlockPath) => {
    (b.children ?? []).forEach((c, i) => {
      const p = [...path, i];
      out.push({ id: rowId(p), node: c, path: p, depth: p.length - 1 });
      walk(c, p);
    });
  };
  walk(root, []);
  return out;
}

// anc가 p의 진짜 조상인가(자기 자신 제외).
export function isDescendant(anc: BlockPath, p: BlockPath): boolean {
  return anc.length < p.length && anc.every((v, i) => v === p[i]);
}

// 드래그 중 정렬 목록: 활성 노드의 자손은 제외한다(자기 안으로 떨어지는 것 방지 +
// dnd-kit 예제와 동일한 시각 동작). 활성 노드 자신은 남는다.
export function dragRows(rows: FlatRow[], activePath: BlockPath): FlatRow[] {
  return rows.filter((r) => !isDescendant(activePath, r.path));
}

export type DropTarget = { parentPath: BlockPath; index: number; depth: number };

function arrayMoveLocal<T>(a: T[], from: number, to: number): T[] {
  const c = [...a];
  const [x] = c.splice(from, 1);
  c.splice(to, 0, x);
  return c;
}

// 드롭 목적지를 계산한다. 반환 좌표는 "제거 전" 기준 — moveNode가 내부에서 보정한다.
// 규칙: ①over 위치로 세로 순서를 정하고 ②깊이 = 활성 깊이 + round(dx/indent)를
// 앞뒤 행의 깊이로 클램프하고 ③그 깊이의 부모가 컨테이너가 아니면 컨테이너가
// 나올 때까지 얕게 조정한다. 유효한 목적지가 없으면 null(no-op).
export function projectDrop(
  root: Block,
  rows: FlatRow[],
  activeId: string,
  overId: string,
  dx: number,
  indent: number,
  isContainer: (type: string) => boolean,
): DropTarget | null {
  const active = rows.find((r) => r.id === activeId);
  if (!active) return null;
  const items = dragRows(rows, active.path);
  const from = items.findIndex((r) => r.id === activeId);
  const to = items.findIndex((r) => r.id === overId);
  if (from < 0 || to < 0) return null;
  const arr = arrayMoveLocal(items, from, to);
  const prev = to > 0 ? arr[to - 1] : null;
  const next = to < arr.length - 1 ? arr[to + 1] : null;
  const projected = active.depth + Math.round(dx / indent);
  const maxD = prev ? prev.depth + 1 : 0;
  const minD = next ? next.depth : 0;
  const start = Math.min(Math.max(projected, minD), maxD);

  for (let d = start; d >= 0; d--) {
    // 목표 깊이 d의 부모 행: to 앞쪽에서 가장 가까운 depth d-1 행. 그보다 얕은 행을
    // 먼저 만나면 그 깊이의 부모가 없는 위치다(DFS 경계) → 더 얕은 깊이를 시도.
    let parentRow: FlatRow | null = null;
    if (d > 0) {
      for (let j = to - 1; j >= 0; j--) {
        if (arr[j].depth === d - 1) {
          parentRow = arr[j];
          break;
        }
        if (arr[j].depth < d - 1) break;
      }
      if (!parentRow) continue;
    }
    const parentNode = parentRow ? parentRow.node : root;
    if (!isContainer(parentNode.type)) continue;
    // 삽입 인덱스: to 앞쪽에서 같은 부모의 마지막 직계 형제(depth d)를 찾아 그
    // 원래(제거 전) 인덱스 + 1. 부모 행에 먼저 닿으면 첫 자식(0)이다.
    let index = 0;
    for (let j = to - 1; j >= 0; j--) {
      const r = arr[j];
      if (parentRow && r.id === parentRow.id) break;
      if (r.depth < d) break;
      if (r.depth === d) {
        index = r.path[r.path.length - 1] + 1;
        break;
      }
    }
    return { parentPath: parentRow ? parentRow.path : [], index, depth: d };
  }
  return null;
}

// 제거 전 좌표의 목적지가 현재 위치와 동일한가 — no-op 드롭 판정(히스토리 오염 방지).
// moveNode는 toIndex가 fromIdx 또는 fromIdx+1이면 같은 자리로 되돌아온다.
export function isSamePosition(fromPath: BlockPath, target: DropTarget): boolean {
  const fromParent = fromPath.slice(0, -1);
  const fromIdx = fromPath[fromPath.length - 1];
  return (
    fromParent.length === target.parentPath.length &&
    fromParent.every((v, i) => v === target.parentPath[i]) &&
    (target.index === fromIdx || target.index === fromIdx + 1)
  );
}

// 블록 배열(자손 포함)의 key 없는 노드에 key를 부여한 사본을 만든다. editOps의
// withKeys를 그대로 쓰기 위해 더미 루트에 insertAt하는 방식 — key 로직을 중복
// 구현하지 않는다. 탭 content 정규화(스코프 편집 대비)와 유령 탭 물질화에 쓴다.
export function keyedBlocks(blocks: Block[]): Block[] {
  let root: Block = { type: "vstack", children: [] };
  blocks.forEach((b, i) => {
    root = insertAt(root, [], i, b);
  });
  return root.children ?? [];
}

// 트리(자손 포함)의 key 없는 노드에 key를 부여한 사본을 만든다.
export function keyedScreen(s: Block): Block {
  return keyedBlocks([s])[0] ?? s;
}

// 탭의 유령(미물질화) 판정 — 명시 content가 비어 있으면 렌더러(planTabContent)가
// 기본 매핑(chat→chat-feed 등)으로 폴백한다. 그때의 기본 블록 목록을 반환하고,
// 명시 content가 있거나 기본 매핑도 없는 탭이면 null. 빈 배열([])도 "없음"으로
// 치는 폴백 조건을 planTabContent와 공유해야 트리 표기와 실제 렌더가 항상 일치한다
// — 편집으로 content가 []가 되면 유령 상태로 되돌아가는 것이 의도된 동작이다.
export function ghostTabContent(tab: TabSpec): Block[] | null {
  if (tab.content?.length) return null;
  const blocks = planTabContent([tab.id], tab.id, undefined, () => true)[0]?.blocks ?? [];
  return blocks.length ? blocks : null;
}

// 표시명(props.name) 커밋 — name만 바꾼 새 props를 만든다(트림·40자 클램프,
// 빈 값=키 제거, key 등 나머지 키는 보존). 결과가 현재와 같으면 null을 반환해
// 호출부가 no-op 처리한다(히스토리 오염 방지). key 보존은 updateProps도 이중으로
// 보장한다.
export function renameProps(
  props: Record<string, unknown> | undefined,
  name: string,
): Record<string, unknown> | null {
  const cur = typeof props?.name === "string" ? props.name : "";
  const next = name.trim().slice(0, 40);
  if (next === cur) return null;
  const out: Record<string, unknown> = { ...props };
  if (next) out.name = next;
  else delete out.name;
  return out;
}
