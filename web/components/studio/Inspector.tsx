"use client";

// 인스펙터(T5.1 전면 재작성) — 선택 블록의 props를 편집하는 schema-driven 일반 폼.
// 구성: 공통부(표시 이름 props.name + 스타일 폼 StyleFields) + 레지스트리 def.fields
// 순회 렌더(kind별 위젯). 블록별 수기 분기(text/logo)는 registry의 fields 메타로
// 이관됐다 — propsSchema가 검증 권위, fields가 폼 메타(레지스트리 한곳에 병기).
// 텍스트·숫자 입력은 blur/Enter에 커밋해(무입력 히스토리 오염 방지) 모든 변경은
// 상위의 updateProps(editOps) 경유로 반영된다. 셀렉트·토글은 즉시 커밋.
import { useI18n } from "../../lib/i18n";
import { REGISTRY, type FieldSpec } from "../../lib/builder/registry";
import type { Block } from "../../lib/builder/schema";
import { getAt, type BlockPath } from "../../lib/builder/editOps";
import { displayName } from "../../lib/builder/studioScope";
import { renameProps } from "../../lib/builder/studioTree";
import StyleFields from "./StyleFields";

const inputCls =
  "w-full rounded-lg border border-line bg-card px-2 py-1.5 text-xs text-fg outline-none focus:border-accent";
const labelCls = "mb-1 block text-[10px] font-medium text-muted";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-2 block">
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  );
}

// blur/Enter 커밋형 텍스트 입력. key(외부 값 포함)로 리셋되므로 undo 시에도 동기화된다.
function CommitInput({
  value,
  onCommit,
  maxLength,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  maxLength?: number;
  placeholder?: string;
}) {
  return (
    <input
      key={value}
      type="text"
      defaultValue={value}
      maxLength={maxLength}
      placeholder={placeholder}
      className={inputCls}
      onBlur={(e) => {
        if (e.target.value !== value) onCommit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

// blur/Enter 커밋형 숫자 입력 — [min,max] 클램프, 비수치는 미커밋(기존 logo 폼과 동일).
function NumberInput({
  value,
  min,
  max,
  fallback,
  onCommit,
}: {
  value: unknown;
  min: number;
  max: number;
  fallback?: number; // 값 부재 시 표시 전용 기본(커밋 전에는 props에 쓰지 않는다)
  onCommit: (n: number) => void;
}) {
  return (
    <input
      key={String(typeof value === "number" ? value : "")}
      type="number"
      min={min}
      max={max}
      defaultValue={typeof value === "number" ? value : fallback ?? ""}
      className={inputCls}
      onBlur={(e) => {
        const n = Math.round(Number(e.target.value));
        if (Number.isFinite(n)) onCommit(Math.min(max, Math.max(min, n)));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

// def.fields 한 항목의 위젯 — kind별 분기. 커밋 값 규약: ""·undefined·빈 배열 = 키 제거
// (setProp에서 일괄 처리, 스키마의 optional과 일치). export는 테스트(kind별 커밋 검증)용.
export function FieldWidget({
  f,
  value,
  onCommit,
}: {
  f: FieldSpec;
  value: unknown;
  onCommit: (v: unknown) => void;
}) {
  const { lang } = useI18n();
  const label = f.label[lang];
  switch (f.kind) {
    case "text":
      return (
        <Field label={label}>
          <CommitInput
            value={typeof value === "string" ? value : ""}
            maxLength={f.maxLength}
            onCommit={onCommit}
          />
        </Field>
      );
    case "select": {
      // 표시값: 값 부재 시 allowEmpty가 있으면 빈 옵션, 없으면 fallback(렌더 기본과 일치).
      const shown =
        typeof value === "string" && value !== "" ? value : f.allowEmpty ? "" : f.fallback ?? "";
      return (
        <Field label={label}>
          <select value={shown} onChange={(e) => onCommit(e.target.value)} className={inputCls}>
            {f.allowEmpty && <option value="">{f.allowEmpty[lang]}</option>}
            {f.options.map((o) => (
              <option key={o.v} value={o.v}>
                {o.label[lang]}
              </option>
            ))}
          </select>
        </Field>
      );
    }
    case "number":
      return (
        <Field label={label}>
          <NumberInput value={value} min={f.min} max={f.max} fallback={f.fallback} onCommit={onCommit} />
        </Field>
      );
    case "toggle":
      return (
        <label className="mb-2 flex items-center gap-2 text-xs text-fg">
          <input
            type="checkbox"
            checked={value === true}
            // false는 키 제거(부재=기본과 동일) — 스키마 optional·additive 원칙과 일치.
            onChange={(e) => onCommit(e.target.checked ? true : undefined)}
            className="accent-accent"
          />
          {label}
        </label>
      );
    case "multiEnum": {
      const cur = Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
      const toggle = (v: string, on: boolean) => {
        // 순서는 options 순으로 정규화한다(포함 여부만 편집 — 순서 편집은 후속, 계획 T5.2).
        const set = new Set(cur);
        if (on) set.add(v);
        else set.delete(v);
        const next = f.options.map((o) => o.v).filter((x) => set.has(x));
        onCommit(next.length ? next : undefined); // 빈 선택 = 키 제거(부재=기본 전체)
      };
      return (
        <div className="mb-2">
          <div className={labelCls}>{label}</div>
          {f.options.map((o) => (
            <label key={o.v} className="mb-1 flex items-center gap-2 text-xs text-fg">
              <input
                type="checkbox"
                checked={cur.includes(o.v)}
                onChange={(e) => toggle(o.v, e.target.checked)}
                className="accent-accent"
              />
              {o.label[lang]}
            </label>
          ))}
        </div>
      );
    }
  }
}

export default function Inspector({
  screen,
  selected,
  onUpdateProps,
  onRemove,
}: {
  screen: Block;
  selected: BlockPath | null;
  onUpdateProps: (p: BlockPath, props: Record<string, unknown>) => void;
  onRemove: (p: BlockPath) => void;
}) {
  const { t, lang } = useI18n();
  const node = selected ? getAt(screen, selected) : null;
  if (!selected || !node) {
    return <p className="text-xs text-muted">{t("studio.inspector.empty")}</p>;
  }

  const def = Object.hasOwn(REGISTRY, node.type) ? REGISTRY[node.type] : undefined;
  const p = (node.props ?? {}) as Record<string, unknown>;
  const isRoot = selected.length === 0;

  // 한 필드만 바꾼 props를 커밋한다. 빈 값은 키 제거(스키마의 optional과 일치).
  const setProp = (field: string, value: unknown) => {
    const cur: Record<string, unknown> = { ...p };
    if (value === undefined || value === "") delete cur[field];
    else cur[field] = value;
    onUpdateProps(selected, cur);
  };

  // 필드 노출 조건(showIfEmpty) — 게이트 prop이 비어 있을 때만 보인다
  // (예: text의 ko/en은 사전 키 미사용 시만 — 기존 수기 폼과 동일).
  const visible = (f: FieldSpec) => {
    if (!f.showIfEmpty) return true;
    const gate = p[f.showIfEmpty];
    return !(typeof gate === "string" && gate !== "");
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          {/* 헤더는 표시 이름(displayName: props.name → 라벨 → type — T2.2와 동일 규칙) */}
          <div className="truncate text-sm font-semibold text-fg">
            {isRoot ? t("studio.tree.root") : displayName(node, def, lang)}
          </div>
          <div className="font-mono text-[10px] text-muted">{node.type}</div>
        </div>
        {!isRoot && (
          <button
            type="button"
            onClick={() => onRemove(selected)}
            className="shrink-0 rounded-lg border border-line px-2 py-1 text-[11px] text-danger hover:bg-card2"
          >
            {t("studio.inspector.delete")}
          </button>
        )}
      </div>

      {/* 공통: 표시 이름(props.name — 트리·헤더가 소비하는 편집기 메타). 루트는 트리에
          행이 없어 이름이 보일 곳이 없으므로 숨긴다. 커밋 규칙(트림·40자·빈 값=제거·
          no-op 걸러내기)은 renameProps와 공유한다(더블클릭 이름변경과 단일 소스). */}
      {!isRoot && (
        <Field label={t("studio.inspector.name")}>
          <CommitInput
            value={typeof p.name === "string" ? p.name : ""}
            maxLength={40}
            onCommit={(v) => {
              const np = renameProps(p, v);
              if (np) onUpdateProps(selected, np);
            }}
          />
        </Field>
      )}

      {/* 블록별 필드(registry.fields 메타 순회) */}
      {def?.fields?.map((f) =>
        visible(f) ? (
          <FieldWidget key={f.prop} f={f} value={p[f.prop]} onCommit={(v) => setProp(f.prop, v)} />
        ) : null,
      )}

      {/* 공통: 스타일 폼(T4.3). 적용 지점이 없는 블록(noStyle — logo·theme-toggle·
          tab-content·perf-view·timeline-view)과 미지 타입은 안내만 표기한다. */}
      <div className="mt-3 border-t border-line pt-2">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
          {t("studio.style.title")}
        </div>
        {def && !def.noStyle ? (
          <StyleFields
            value={p.style}
            layout={def.kind === "layout"}
            onCommit={(style) => setProp("style", style)}
          />
        ) : (
          <p className="text-xs text-muted">{t("studio.style.unsupported")}</p>
        )}
      </div>
    </div>
  );
}
