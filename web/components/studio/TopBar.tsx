"use client";

// 스튜디오 상단바 — 저장/발행 상태 표기, 편집·미리보기 토글, undo/redo, 기본 복원,
// 발행 버튼. 상태 문구는 StudioApp이 i18n으로 확정해 내려준다(여기서는 표기만).
import { useI18n } from "../../lib/i18n";

function UndoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M5 2.5L2 5.5l3 3" />
      <path d="M2 5.5h6a4 4 0 0 1 0 8H6" strokeLinecap="round" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M9 2.5l3 3-3 3" />
      <path d="M12 5.5H6a4 4 0 0 0 0 8h2" strokeLinecap="round" />
    </svg>
  );
}

export default function TopBar({
  editing,
  onToggleEditing,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onRestore,
  publishDisabled,
  publishBusy,
  onPublish,
  statusText,
  statusKind,
}: {
  editing: boolean;
  onToggleEditing: (editing: boolean) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onRestore: () => void;
  publishDisabled: boolean;
  publishBusy: boolean;
  onPublish: () => void;
  statusText: string;
  statusKind: "muted" | "ok" | "danger";
}) {
  const { t } = useI18n();
  const statusCls =
    statusKind === "danger" ? "text-danger" : statusKind === "ok" ? "text-accent" : "text-muted";
  const iconBtn =
    "rounded-lg border border-line p-1.5 text-fg enabled:hover:bg-card2 disabled:opacity-30";

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-line bg-card px-4 py-2">
      <h1 className="text-sm font-bold tracking-tight text-fg">{t("studio.title")}</h1>
      <span className={`min-w-0 flex-1 truncate text-xs ${statusCls}`} role="status">
        {statusText}
      </span>

      <div className="flex gap-1 rounded-xl bg-card2 p-1" role="tablist">
        {(
          [
            { v: true, label: t("studio.bar.editMode") },
            { v: false, label: t("studio.bar.previewMode") },
          ] as const
        ).map((o) => (
          <button
            key={String(o.v)}
            type="button"
            role="tab"
            aria-selected={editing === o.v}
            onClick={() => onToggleEditing(o.v)}
            className={[
              "rounded-lg px-2.5 py-1 text-xs font-medium",
              editing === o.v ? "bg-card text-fg shadow-card" : "text-muted hover:text-fg",
            ].join(" ")}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1">
        <button type="button" aria-label={t("studio.bar.undo")} title={t("studio.bar.undo")} disabled={!canUndo} onClick={onUndo} className={iconBtn}>
          <UndoIcon />
        </button>
        <button type="button" aria-label={t("studio.bar.redo")} title={t("studio.bar.redo")} disabled={!canRedo} onClick={onRedo} className={iconBtn}>
          <RedoIcon />
        </button>
      </div>

      <button
        type="button"
        onClick={onRestore}
        className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-fg hover:bg-card2"
      >
        {t("studio.bar.restore")}
      </button>
      <button
        type="button"
        disabled={publishDisabled || publishBusy}
        onClick={onPublish}
        className="rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-accent-fg enabled:hover:opacity-90 disabled:opacity-40"
      >
        {publishBusy ? t("studio.bar.publishing") : t("studio.bar.publish")}
      </button>
    </header>
  );
}
