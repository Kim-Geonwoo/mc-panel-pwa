"use client";

// 구조 트리 — 화면 트리의 DnD 재배치를 담당한다(캔버스는 클릭 선택·라이브 프리뷰
// 전담, 하이브리드 구성). dnd-kit SortableTree 방식: 세로 위치는 정렬 목록이,
// 중첩 깊이는 드래그의 가로 이동량이 정한다. 투영 계산은 studioTree(순수)에 있다.
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
import type { Block } from "../../lib/builder/schema";
import type { BlockPath } from "../../lib/builder/editOps";
import {
  dragRows,
  flattenScreen,
  isSamePosition,
  projectDrop,
  rowId,
  type FlatRow,
} from "../../lib/builder/studioTree";

const INDENT = 20; // px — 가로 드래그 1단계당 깊이 1

const isContainer = (ty: string) =>
  Object.hasOwn(REGISTRY, ty) && REGISTRY[ty].kind === "layout";

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
  label,
  selected,
  onSelect,
  onRemove,
}: {
  row: FlatRow;
  depth: number;
  label: string;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
  });
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
      <span className={isContainer(row.node.type) ? "flex-1 truncate font-medium" : "flex-1 truncate"}>
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
    </div>
  );
}

export default function StructureTree({
  screen,
  selected,
  onSelect,
  onMove,
  onRemove,
}: {
  screen: Block;
  selected: BlockPath | null;
  onSelect: (p: BlockPath) => void;
  onMove: (from: BlockPath, toParent: BlockPath, toIndex: number) => void;
  onRemove: (p: BlockPath) => void;
}) {
  const { t, lang } = useI18n();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [projectedDepth, setProjectedDepth] = useState<number | null>(null);
  // 드롭 계산에 쓰는 가로 이동량 — 리렌더가 필요 없으므로 ref로만 추적한다.
  const dxRef = useRef(0);

  const rows = flattenScreen(screen);
  const activeRow = activeId ? rows.find((r) => r.id === activeId) : undefined;
  const visible = activeRow ? dragRows(rows, activeRow.path) : rows;
  const selId = selected ? rowId(selected) : null;

  const labelFor = (b: Block) =>
    Object.hasOwn(REGISTRY, b.type) ? REGISTRY[b.type].label[lang] : b.type;

  const onDragStart = (e: DragStartEvent) => {
    dxRef.current = 0;
    setActiveId(String(e.active.id));
    setProjectedDepth(null);
  };

  const onDragMove = (e: DragMoveEvent) => {
    dxRef.current = e.delta.x;
    if (!activeId || !e.over) return setProjectedDepth(null);
    const tgt = projectDrop(screen, rows, activeId, String(e.over.id), e.delta.x, INDENT, isContainer);
    setProjectedDepth(tgt ? tgt.depth : null);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const id = activeId;
    setActiveId(null);
    setProjectedDepth(null);
    if (!id || !e.over) return;
    const tgt = projectDrop(screen, rows, id, String(e.over.id), dxRef.current, INDENT, isContainer);
    const from = rows.find((r) => r.id === id);
    if (!tgt || !from || isSamePosition(from.path, tgt)) return;
    onMove(from.path, tgt.parentPath, tgt.index);
  };

  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {t("studio.tree.title")}
      </div>
      {/* 루트 행 — 이동·삭제 불가, 선택만 가능(팔레트 추가의 기본 목적지) */}
      <button
        type="button"
        onClick={() => onSelect([])}
        className={[
          "mb-0.5 flex w-full items-center rounded-lg border px-2 py-1 text-left text-xs font-medium",
          selId === "" ? "border-accent bg-card2 text-fg" : "border-transparent text-fg hover:bg-card2",
        ].join(" ")}
      >
        {t("studio.tree.root")}
        <span className="ml-auto font-mono text-[10px] text-muted">{screen.type}</span>
      </button>
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
                label={labelFor(r.node)}
                selected={selId === r.id}
                onSelect={() => onSelect(r.path)}
                onRemove={() => onRemove(r.path)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
