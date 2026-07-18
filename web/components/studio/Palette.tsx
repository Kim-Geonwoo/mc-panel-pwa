"use client";

// 팔레트 — REGISTRY의 블록을 kind(레이아웃/요소)별로 묶어 보여주고, 클릭으로
// 선택 컨테이너(또는 루트)에 추가한다. 항목 목록은 레지스트리가 단일 소스다.
// 도움말(T3.3): 행 우측 ? 버튼을 클릭/Enter로 토글하면 행 아래에 설명이 펼쳐진다
// — hover 툴팁 대신 채택(키보드·터치 동일 경로, 의존성 0, 포지셔닝 이슈 없음).
import { useState } from "react";
import { useI18n } from "../../lib/i18n";
import { REGISTRY } from "../../lib/builder/registry";

function PlusIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M5 1v8M1 5h8" />
    </svg>
  );
}

// 물음표 도움말 아이콘 — 인라인 SVG(외부 에셋·의존성 없음).
function HelpIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden>
      <circle cx="6" cy="6" r="5" />
      <path d="M4.6 4.7a1.4 1.4 0 1 1 1.9 1.4c-.4.2-.5.4-.5.9" strokeLinecap="round" />
      <circle cx="6" cy="8.9" r="0.6" fill="currentColor" stroke="none" />
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
  // 설명이 펼쳐진 블록 타입 — 한 번에 하나만(다른 행을 열면 이전 행은 닫힌다).
  const [openType, setOpenType] = useState<string | null>(null);
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
                const open = openType === type;
                const descId = `palette-desc-${type}`;
                return (
                  <div key={type}>
                    {/* 추가 버튼과 도움말 버튼은 형제 — button 중첩은 무효 HTML이고,
                        배치됨(disabled) 상태에서도 도움말은 계속 열려야 한다. */}
                    <div className="flex items-center">
                      <button
                        type="button"
                        aria-label={t("studio.palette.addAria", { name: d.label[lang] })}
                        disabled={isPlaced}
                        onClick={() => onAdd(type)}
                        className="group flex min-h-[28px] min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1.5 text-left text-xs text-fg enabled:hover:bg-card2 disabled:cursor-not-allowed disabled:opacity-50"
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
                      <button
                        type="button"
                        aria-label={t("studio.palette.helpAria", { name: d.label[lang] })}
                        aria-expanded={open}
                        aria-describedby={open ? descId : undefined}
                        onClick={() => setOpenType(open ? null : type)}
                        className={[
                          "shrink-0 rounded-lg p-1.5 hover:bg-card2 hover:text-fg",
                          open ? "text-accent" : "text-muted",
                        ].join(" ")}
                      >
                        <HelpIcon />
                      </button>
                    </div>
                    {open && (
                      <p
                        id={descId}
                        role="note"
                        className="mx-1.5 mb-1 mt-0.5 rounded-lg bg-card2 px-2 py-1.5 text-[11px] leading-relaxed text-muted"
                      >
                        {d.description[lang]}
                      </p>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}
