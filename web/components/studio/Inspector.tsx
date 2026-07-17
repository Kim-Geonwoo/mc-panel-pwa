"use client";

// 인스펙터 — 선택 블록의 props 편집. 스키마가 있는 블록(text/logo)만 폼을 제공하고
// 나머지는 "속성 없음"을 표기한다. 텍스트 입력은 blur/Enter에 커밋해(무입력 히스토리
// 오염 방지) 모든 변경은 상위의 updateProps(editOps) 경유로 반영된다.
import { useI18n } from "../../lib/i18n";
import { REGISTRY } from "../../lib/builder/registry";
import type { Block } from "../../lib/builder/schema";
import { getAt, type BlockPath } from "../../lib/builder/editOps";
import { rowId } from "../../lib/builder/studioTree";

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
  const selKey = rowId(selected);

  // 한 필드만 바꾼 props를 커밋한다. 빈 값은 키 제거(스키마의 optional과 일치).
  const setProp = (field: string, value: unknown) => {
    const cur: Record<string, unknown> = { ...p };
    if (value === undefined || value === "") delete cur[field];
    else cur[field] = value;
    onUpdateProps(selected, cur);
  };

  const usesDict = typeof p.i18n === "string" && p.i18n !== "";

  return (
    <div key={selKey}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-fg">
            {isRoot ? t("studio.tree.root") : def ? def.label[lang] : node.type}
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

      {node.type === "text" ? (
        <>
          <Field label={t("studio.text.i18nKey")}>
            <select
              value={usesDict ? String(p.i18n) : ""}
              onChange={(e) => setProp("i18n", e.target.value)}
              className={inputCls}
            >
              <option value="">{t("studio.text.i18nNone")}</option>
              <option value="panel.title">panel.title</option>
            </select>
          </Field>
          {!usesDict && (
            <>
              <Field label={t("studio.text.ko")}>
                <CommitInput
                  value={typeof p.ko === "string" ? p.ko : ""}
                  maxLength={200}
                  onCommit={(v) => setProp("ko", v)}
                />
              </Field>
              <Field label={t("studio.text.en")}>
                <CommitInput
                  value={typeof p.en === "string" ? p.en : ""}
                  maxLength={200}
                  onCommit={(v) => setProp("en", v)}
                />
              </Field>
            </>
          )}
          <Field label={t("studio.text.variant")}>
            <select
              value={typeof p.variant === "string" ? p.variant : "body"}
              onChange={(e) => setProp("variant", e.target.value)}
              className={inputCls}
            >
              <option value="title">{t("studio.text.variantTitle")}</option>
              <option value="body">{t("studio.text.variantBody")}</option>
              <option value="caption">{t("studio.text.variantCaption")}</option>
            </select>
          </Field>
        </>
      ) : node.type === "logo" ? (
        <Field label={t("studio.logo.size")}>
          <input
            key={String(p.size ?? "")}
            type="number"
            min={16}
            max={128}
            defaultValue={typeof p.size === "number" ? p.size : 44}
            className={inputCls}
            onBlur={(e) => {
              const n = Math.round(Number(e.target.value));
              if (Number.isFinite(n)) setProp("size", Math.min(128, Math.max(16, n)));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
        </Field>
      ) : (
        <p className="text-xs text-muted">{t("studio.inspector.noProps")}</p>
      )}
    </div>
  );
}
