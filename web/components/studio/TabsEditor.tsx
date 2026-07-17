"use client";

// 탭 편집기 — 탭의 추가/삭제/순서(↑↓)/라벨(ko·en)/표시 여부를 편집한다. content는
// 서버 저장본을 그대로 보존한다(여기서는 다루지 않음). id는 생성 시에만 정한다 —
// 기존 id 변경은 기본 콘텐츠 매핑(chat/perf/timeline)을 끊을 수 있어 허용하지 않는다.
import { useState } from "react";
import { useI18n } from "../../lib/i18n";
import type { TabSpec } from "../../lib/builder/schema";

const MAX_TABS = 12; // schema의 tabs 상한과 동일

const inputCls =
  "w-full rounded-lg border border-line bg-card px-2 py-1.5 text-xs text-fg outline-none focus:border-accent";

function CommitInput({
  value,
  onCommit,
  maxLength,
  ariaLabel,
}: {
  value: string;
  onCommit: (v: string) => void;
  maxLength?: number;
  ariaLabel: string;
}) {
  return (
    <input
      key={value}
      type="text"
      defaultValue={value}
      maxLength={maxLength}
      aria-label={ariaLabel}
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

export default function TabsEditor({
  tabs,
  onChange,
}: {
  tabs: TabSpec[];
  onChange: (next: TabSpec[]) => void;
}) {
  const { t } = useI18n();
  const [newId, setNewId] = useState("");

  const trimmed = newId.trim();
  const idValid =
    trimmed.length >= 1 && trimmed.length <= 32 && !tabs.some((tb) => tb.id === trimmed);
  const full = tabs.length >= MAX_TABS;

  const patch = (i: number, next: Partial<TabSpec>) =>
    onChange(tabs.map((tb, j) => (j === i ? { ...tb, ...next } : tb)));

  const swap = (i: number, j: number) => {
    if (j < 0 || j >= tabs.length) return;
    const next = [...tabs];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const add = () => {
    if (!idValid || full) return;
    onChange([...tabs, { id: trimmed, label: { ko: trimmed, en: trimmed }, enabled: true }]);
    setNewId("");
  };

  return (
    <div>
      <div className="flex flex-col gap-2">
        {tabs.map((tb, i) => (
          <div key={tb.id} className="rounded-xl border border-line bg-card p-2">
            <div className="mb-1.5 flex items-center gap-1">
              <span className="flex-1 truncate font-mono text-[11px] text-fg">{tb.id}</span>
              <label className="flex items-center gap-1 text-[10px] text-muted">
                <input
                  type="checkbox"
                  checked={tb.enabled !== false}
                  onChange={(e) => patch(i, { enabled: e.target.checked })}
                  className="accent-[var(--accent)]"
                />
                {t("studio.tabs.enabled")}
              </label>
              <button
                type="button"
                aria-label={t("studio.tabs.upAria")}
                disabled={i === 0}
                onClick={() => swap(i, i - 1)}
                className="rounded p-1 text-muted enabled:hover:text-fg disabled:opacity-30"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                  <path d="M1 6.5L5 2.5l4 4" />
                </svg>
              </button>
              <button
                type="button"
                aria-label={t("studio.tabs.downAria")}
                disabled={i === tabs.length - 1}
                onClick={() => swap(i, i + 1)}
                className="rounded p-1 text-muted enabled:hover:text-fg disabled:opacity-30"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                  <path d="M1 3.5l4 4 4-4" />
                </svg>
              </button>
              <button
                type="button"
                aria-label={t("studio.tabs.deleteAria")}
                onClick={() => onChange(tabs.filter((_, j) => j !== i))}
                className="rounded p-1 text-muted hover:text-danger"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                  <path d="M1 1l8 8M9 1l-8 8" />
                </svg>
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <CommitInput
                value={tb.label.ko}
                maxLength={60}
                ariaLabel={t("studio.tabs.labelKo")}
                onCommit={(v) => patch(i, { label: { ...tb.label, ko: v } })}
              />
              <CommitInput
                value={tb.label.en}
                maxLength={60}
                ariaLabel={t("studio.tabs.labelEn")}
                onCommit={(v) => patch(i, { label: { ...tb.label, en: v } })}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex gap-1.5">
        <input
          type="text"
          value={newId}
          maxLength={32}
          placeholder={t("studio.tabs.idPlaceholder")}
          aria-label={t("studio.tabs.idPlaceholder")}
          className={inputCls}
          onChange={(e) => setNewId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <button
          type="button"
          disabled={!idValid || full}
          onClick={add}
          className="shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-fg enabled:hover:bg-card2 disabled:opacity-40"
        >
          {t("studio.tabs.add")}
        </button>
      </div>
      {trimmed !== "" && !idValid && (
        <p className="mt-1 text-[10px] text-danger">{t("studio.tabs.idErr")}</p>
      )}
      {full && <p className="mt-1 text-[10px] text-muted">{t("studio.tabs.max")}</p>}
    </div>
  );
}
