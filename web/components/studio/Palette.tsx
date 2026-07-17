"use client";

// 팔레트 — REGISTRY의 블록을 kind(레이아웃/요소)별로 묶어 보여주고, 클릭으로
// 선택 컨테이너(또는 루트)에 추가한다. 항목 목록은 레지스트리가 단일 소스다.
import { useI18n } from "../../lib/i18n";
import { REGISTRY } from "../../lib/builder/registry";

function PlusIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M5 1v8M1 5h8" />
    </svg>
  );
}

export default function Palette({
  onAdd,
  placed,
}: {
  onAdd: (type: string) => void;
  // 이미 배치된 unique 블록 타입 집합 — 버튼 비활성 + "배치됨" 배지(B8)
  placed: ReadonlySet<string>;
}) {
  const { t, lang } = useI18n();
  const entries = Object.entries(REGISTRY);
  const groups: Array<{ titleKey: string; kind: "layout" | "element" }> = [
    { titleKey: "studio.palette.groupLayout", kind: "layout" },
    { titleKey: "studio.palette.groupElement", kind: "element" },
  ];
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {t("studio.palette.title")}
      </div>
      {groups.map((g) => (
        <div key={g.kind} className="mb-2">
          <div className="mb-1 text-[10px] font-medium text-muted">{t(g.titleKey)}</div>
          <div className="flex flex-col gap-0.5">
            {entries
              .filter(([, d]) => d.kind === g.kind)
              .map(([type, d]) => {
                const isPlaced = placed.has(type);
                return (
                  <button
                    key={type}
                    type="button"
                    aria-label={t("studio.palette.addAria", { name: d.label[lang] })}
                    disabled={isPlaced}
                    onClick={() => onAdd(type)}
                    className="group flex min-h-[28px] items-center gap-1.5 rounded-lg px-1.5 text-left text-xs text-fg enabled:hover:bg-card2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="text-muted group-enabled:group-hover:text-accent">
                      <PlusIcon />
                    </span>
                    <span className="flex-1 truncate">{d.label[lang]}</span>
                    {isPlaced ? (
                      <span className="rounded bg-card2 px-1 py-0.5 text-[10px] font-medium text-muted">
                        {t("studio.palette.placed")}
                      </span>
                    ) : (
                      <span className="font-mono text-[10px] text-muted">{type}</span>
                    )}
                  </button>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}
