"use client";

// 구조 트리 — 화면 트리와 각 탭 콘텐츠를 섹션으로 나눠 DnD 재배치·선택·표시명
// 변경을 담당한다(캔버스는 클릭 선택·라이브 프리뷰 전담, 하이브리드 구성).
// 섹션마다 독립 DndContext를 두므로 스코프(화면↔탭·탭↔탭) 간 이동은 구조적으로
// 불가하다 — v2의 의도된 제약(후속 검토 대상). dnd-kit SortableTree 방식: 세로
// 위치는 정렬 목록이, 중첩 깊이는 드래그의 가로 이동량이 정한다. 투영 계산은
// studioTree(순수)에 있다.
import { useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useI18n } from "../../lib/i18n";
import { REGISTRY } from "../../lib/builder/registry";
import type { Block, TabSpec } from "../../lib/builder/schema";
import type { BlockPath } from "../../lib/builder/editOps";
import {
  TAB_ROOT_TYPE,
  displayName,
  spathId,
  type EditScope,
  type ScopedPath,
} from "../../lib/builder/studioScope";
import {
  dragRows,
  flattenScoped,
  flattenScreen,
  ghostTabContent,
  isSamePosition,
  projectDrop,
  type FlatRow,
} from "../../lib/builder/studioTree";

const INDENT = 20; // px — 가로 드래그 1단계당 깊이 1

// 가상 탭 루트도 드롭 부모로 허용한다 — 없으면 탭 섹션 최상위(depth 0) 재배치가
// 전부 무효 판정(no-op)이 된다.
const isContainer = (ty: string) =>
  ty === TAB_ROOT_TYPE || (Object.hasOwn(REGISTRY, ty) && REGISTRY[ty].kind === "layout");

function GripIcon() {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden>
      <circle cx="2.5" cy="2.5" r="1.5" />
      <circle cx="7.5" cy="2.5" r="1.5" />
      <circle cx="2.5" cy="7" r="1.5" />
      <circle cx="7.5" cy="7" r="1.5" />
      <circle cx="2.5" cy="11.5" r="1.5" />
      <circle cx="7.5" cy="11.5" r="1.5" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M1 1l8 8M9 1l-8 8" />
    </svg>
  );
}

function TreeRow({
  row,
  depth,
  selected,
  onSelect,
  onRemove,
  onRename,
}: {
  row: FlatRow;
  depth: number;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onRename: (name: string) => void;
}) {
  const { t, lang } = useI18n();
  // 더블클릭 이름변경 — 라벨 자리에 인라인 입력을 띄운다. 드래그 핸들(grip 버튼)과
  // 영역이 분리돼 있어 충돌하지 않는다.
  const [renaming, setRenaming] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
  });
  const def = Object.hasOwn(REGISTRY, row.node.type) ? REGISTRY[row.node.type] : undefined;
  const label = displayName(row.node, def, lang);
  const curName = typeof row.node.props?.name === "string" ? row.node.props.name : "";
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        marginLeft: depth * INDENT,
      }}
      onClick={onSelect}
      className={[
        "group flex min-h-[30px] cursor-pointer items-center gap-1.5 rounded-lg border px-1.5 text-xs",
        selected ? "border-accent bg-card2 text-fg" : "border-transparent text-fg hover:bg-card2",
        isDragging ? "opacity-50" : "",
      ].join(" ")}
    >
      <button
        type="button"
        aria-label={t("studio.tree.dragAria")}
        className="cursor-grab touch-none text-muted hover:text-fg"
        {...attributes}
        {...listeners}
      >
        <GripIcon />
      </button>
      {renaming ? (
        <input
          autoFocus
          type="text"
          defaultValue={curName}
          placeholder={label}
          maxLength={40}
          aria-label={t("studio.tree.renameAria")}
          className="min-w-0 flex-1 rounded border border-accent bg-card px-1 py-0.5 text-xs text-fg outline-none"
          onFocus={(e) => e.currentTarget.select()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onRename(e.currentTarget.value);
              setRenaming(false);
            } else if (e.key === "Escape") {
              // 커밋 없이 종료 — DOM 제거는 blur 이벤트를 발화하지 않으므로 안전하다.
              setRenaming(false);
            }
          }}
          onBlur={(e) => {
            onRename(e.target.value);
            setRenaming(false);
          }}
        />
      ) : (
        <>
          <span
            onDoubleClick={(e) => {
              e.stopPropagation();
              setRenaming(true);
            }}
            className={
              isContainer(row.node.type) ? "flex-1 truncate font-medium" : "flex-1 truncate"
            }
          >
            {label}
          </span>
          <span className="font-mono text-[10px] text-muted">{row.node.type}</span>
          <button
            type="button"
            aria-label={t("studio.tree.deleteAria")}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="rounded p-1 text-muted opacity-0 hover:text-danger group-hover:opacity-100"
          >
            <XIcon />
          </button>
        </>
      )}
    </div>
  );
}

// 편집 가능한 섹션(화면 또는 명시 content가 있는 탭) — 섹션별 독립 DnD 컨텍스트.
function TreeSection({
  scope,
  root,
  headerLabel,
  headerMono,
  dimmed,
  emptyText,
  selId,
  onSelect,
  onMove,
  onRemove,
  onRename,
}: {
  scope: EditScope;
  root: Block;
  headerLabel: string;
  headerMono: string;
  dimmed?: boolean;
  emptyText?: string; // 빈 섹션 안내(탭 전용 — 화면은 기존처럼 빈 목록 허용)
  selId: string | null;
  onSelect: (sp: ScopedPath) => void;
  onMove: (scope: EditScope, from: BlockPath, toParent: BlockPath, toIndex: number) => void;
  onRemove: (sp: ScopedPath) => void;
  onRename: (sp: ScopedPath, name: string) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [projectedDepth, setProjectedDepth] = useState<number | null>(null);
  // 드롭 계산에 쓰는 가로 이동량 — 리렌더가 필요 없으므로 ref로만 추적한다.
  const dxRef = useRef(0);

  const rows = flattenScoped(root, scope);
  const activeRow = activeId ? rows.find((r) => r.id === activeId) : undefined;
  const visible = activeRow ? dragRows(rows, activeRow.path) : rows;
  const rootId = spathId({ scope, path: [] });

  const onDragStart = (e: DragStartEvent) => {
    dxRef.current = 0;
    setActiveId(String(e.active.id));
    setProjectedDepth(null);
  };

  const onDragMove = (e: DragMoveEvent) => {
    dxRef.current = e.delta.x;
    if (!activeId || !e.over) return setProjectedDepth(null);
    const tgt = projectDrop(root, rows, activeId, String(e.over.id), e.delta.x, INDENT, isContainer);
    setProjectedDepth(tgt ? tgt.depth : null);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const id = activeId;
    setActiveId(null);
    setProjectedDepth(null);
    if (!id || !e.over) return;
    const tgt = projectDrop(root, rows, id, String(e.over.id), dxRef.current, INDENT, isContainer);
    const from = rows.find((r) => r.id === id);
    if (!tgt || !from || isSamePosition(from.path, tgt)) return;
    onMove(scope, from.path, tgt.parentPath, tgt.index);
  };

  return (
    <div className={dimmed ? "opacity-60" : undefined}>
      {/* 섹션 루트 행 — 이동·삭제 불가, 선택만 가능(팔레트 추가의 목적지) */}
      <button
        type="button"
        onClick={() => onSelect({ scope, path: [] })}
        className={[
          "mb-0.5 flex w-full items-center rounded-lg border px-2 py-1 text-left text-xs font-medium",
          selId === rootId
            ? "border-accent bg-card2 text-fg"
            : "border-transparent text-fg hover:bg-card2",
        ].join(" ")}
      >
        <span className="truncate">{headerLabel}</span>
        <span className="ml-auto shrink-0 pl-1.5 font-mono text-[10px] text-muted">{headerMono}</span>
      </button>
      {rows.length === 0 && emptyText ? (
        <p className="px-2 py-1 text-[11px] text-muted">{emptyText}</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onDragCancel={() => {
            setActiveId(null);
            setProjectedDepth(null);
          }}
        >
          <SortableContext items={visible.map((r) => r.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-0.5">
              {visible.map((r) => (
                <TreeRow
                  key={r.id}
                  row={r}
                  depth={r.id === activeId && projectedDepth != null ? projectedDepth : r.depth}
                  selected={selId === r.id}
                  onSelect={() => onSelect({ scope, path: r.path })}
                  onRemove={() => onRemove({ scope, path: r.path })}
                  onRename={(name) => onRename({ scope, path: r.path }, name)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

// 유령 섹션 — 명시 content 없는 known 탭. 렌더러가 폴백으로 쓰는 기본 매핑을
// 비편집 점선 행으로만 보여주고, "편집 시작"을 눌러야 기본 매핑이 실제 content로
// 복사(물질화)된다. 발행본 변화는 항상 명시 조작의 결과여야 하므로(암묵 물질화
// 금지) 헤더·행 모두 선택 대상이 아니다 — 먼저 물질화하지 않으면 팔레트 추가가
// 기본 콘텐츠를 조용히 대체(content=[블록] → 폴백 중단)하는 함정이 생긴다.
// 물질화된 탭의 content를 도로 비우면 렌더러 폴백 조건과 동일한 ghostTabContent
// 판정에 의해 이 유령 상태로 되돌아온다(트리 표기 = 실제 렌더).
function GhostSection({
  tab,
  blocks,
  dimmed,
  onMaterialize,
}: {
  tab: TabSpec;
  blocks: Block[];
  dimmed?: boolean;
  onMaterialize: (tabId: string) => void;
}) {
  const { t, lang } = useI18n();
  const rows = flattenScreen({ type: TAB_ROOT_TYPE, children: blocks });
  return (
    <div className={dimmed ? "opacity-60" : undefined}>
      <div className="mb-0.5 flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-fg">
        <span className="truncate">{tab.label[lang]}</span>
        <span className="shrink-0 rounded bg-card2 px-1 py-0.5 text-[10px] font-medium text-muted">
          {t("studio.tree.defaultBadge")}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted">{tab.id}</span>
      </div>
      <div className="flex flex-col gap-0.5">
        {rows.map((r) => {
          const def = Object.hasOwn(REGISTRY, r.node.type) ? REGISTRY[r.node.type] : undefined;
          return (
            <div
              key={r.id}
              style={{ marginLeft: r.depth * INDENT }}
              className="flex min-h-[30px] items-center gap-1.5 rounded-lg border border-dashed border-line px-1.5 text-xs text-muted"
            >
              <span className="flex-1 truncate">{displayName(r.node, def, lang)}</span>
              <span className="font-mono text-[10px]">{r.node.type}</span>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => onMaterialize(tab.id)}
        className="mt-0.5 w-full rounded-lg border border-dashed border-line px-2 py-1 text-[11px] text-muted hover:bg-card2 hover:text-fg"
      >
        {t("studio.tree.materialize")}
      </button>
    </div>
  );
}

export default function StructureTree({
  screen,
  tabs,
  selected,
  onSelect,
  onMove,
  onRemove,
  onRename,
  onMaterialize,
}: {
  screen: Block;
  tabs: TabSpec[];
  selected: ScopedPath | null;
  onSelect: (sp: ScopedPath) => void;
  onMove: (scope: EditScope, from: BlockPath, toParent: BlockPath, toIndex: number) => void;
  onRemove: (sp: ScopedPath) => void;
  onRename: (sp: ScopedPath, name: string) => void;
  onMaterialize: (tabId: string) => void;
}) {
  const { t, lang } = useI18n();
  const selId = selected ? spathId(selected) : null;
  const common = { selId, onSelect, onMove, onRemove, onRename };
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {t("studio.tree.title")}
      </div>
      <TreeSection
        scope={{ kind: "screen" }}
        root={screen}
        headerLabel={t("studio.tree.root")}
        headerMono={screen.type}
        {...common}
      />
      {/* 탭 섹션 — draft.tabs ?? 기본 탭 순서 그대로(상위가 결정), disabled 탭은 흐림 */}
      {tabs.map((tb) => {
        const ghost = ghostTabContent(tb);
        const dimmed = tb.enabled === false;
        return (
          <div key={tb.id} className="mt-3">
            {ghost ? (
              <GhostSection tab={tb} blocks={ghost} dimmed={dimmed} onMaterialize={onMaterialize} />
            ) : (
              <TreeSection
                scope={{ kind: "tab", tabId: tb.id }}
                root={{ type: TAB_ROOT_TYPE, children: tb.content ?? [] }}
                headerLabel={tb.label[lang]}
                headerMono={tb.id}
                dimmed={dimmed}
                emptyText={t("studio.tree.emptyTab")}
                {...common}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
