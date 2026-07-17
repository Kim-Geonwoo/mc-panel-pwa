"use client";

// 테마·메타 편집기 — mode(3택)·accent(컬러 피커+hex, #RRGGBB 검증)·radius(3택)·
// meta.title을 편집한다. accent는 유효한 hex만 커밋하고, 비우면 키를 제거한다.
import { useEffect, useState } from "react";
import { useI18n } from "../../lib/i18n";
import type { ThemeSpec } from "../../lib/builder/schema";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const FALLBACK_ACCENT = "#15a34a"; // globals.css 라이트 기본값 — 피커 초기색으로만 사용

const inputCls =
  "w-full rounded-lg border border-line bg-card px-2 py-1.5 text-xs text-fg outline-none focus:border-accent";

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ v: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-xl bg-card2 p-1">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          aria-pressed={value === o.v}
          onClick={() => onChange(o.v)}
          className={[
            "flex-1 rounded-lg px-2 py-1 text-[11px] font-medium",
            value === o.v ? "bg-card text-fg shadow-card" : "text-muted hover:text-fg",
          ].join(" ")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function ThemeEditor({
  theme,
  metaTitle,
  onTheme,
  onMetaTitle,
}: {
  theme: ThemeSpec;
  metaTitle: string;
  onTheme: (next: ThemeSpec) => void;
  onMetaTitle: (title: string) => void;
}) {
  const { t } = useI18n();
  const accent = theme.accent ?? "";
  const [hex, setHex] = useState(accent);
  useEffect(() => setHex(accent), [accent]); // undo/외부 변경과 동기화

  const hexOk = hex === "" || HEX_RE.test(hex);

  // 커밋: 빈 값 → accent 제거, 유효 hex → 반영, 무효 → 미커밋(에러 표기만).
  const commitAccent = (v: string) => {
    if (v === "") {
      const { accent: _drop, ...rest } = theme;
      onTheme(rest);
    } else if (HEX_RE.test(v)) {
      onTheme({ ...theme, accent: v });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="mb-1 text-[10px] font-medium text-muted">{t("studio.theme.mode")}</div>
        <Segmented
          value={theme.mode ?? "auto"}
          options={[
            { v: "light" as const, label: t("studio.theme.modeLight") },
            { v: "dark" as const, label: t("studio.theme.modeDark") },
            { v: "auto" as const, label: t("studio.theme.modeAuto") },
          ]}
          onChange={(v) => onTheme({ ...theme, mode: v })}
        />
      </div>

      <div>
        <div className="mb-1 text-[10px] font-medium text-muted">{t("studio.theme.accent")}</div>
        <div className="flex items-center gap-1.5">
          <input
            key={accent}
            type="color"
            aria-label={t("studio.theme.accent")}
            defaultValue={HEX_RE.test(accent) ? accent : FALLBACK_ACCENT}
            className="h-8 w-9 shrink-0 cursor-pointer rounded-lg border border-line bg-card p-0.5"
            onBlur={(e) => commitAccent(e.target.value)}
          />
          <input
            type="text"
            value={hex}
            placeholder="#22c55e"
            aria-label={t("studio.theme.accent")}
            className={[inputCls, hexOk ? "" : "border-danger"].join(" ")}
            onChange={(e) => setHex(e.target.value)}
            onBlur={() => commitAccent(hex)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
          <button
            type="button"
            disabled={accent === ""}
            onClick={() => commitAccent("")}
            className="shrink-0 rounded-lg border border-line px-2 py-1.5 text-[11px] text-muted enabled:hover:text-fg disabled:opacity-40"
          >
            {t("studio.theme.accentClear")}
          </button>
        </div>
        {!hexOk && <p className="mt-1 text-[10px] text-danger">{t("studio.theme.accentErr")}</p>}
      </div>

      <div>
        <div className="mb-1 text-[10px] font-medium text-muted">{t("studio.theme.radius")}</div>
        <Segmented
          value={theme.radius ?? "md"}
          options={[
            { v: "sm" as const, label: t("studio.theme.radiusSm") },
            { v: "md" as const, label: t("studio.theme.radiusMd") },
            { v: "lg" as const, label: t("studio.theme.radiusLg") },
          ]}
          onChange={(v) => onTheme({ ...theme, radius: v })}
        />
      </div>

      <label className="block">
        <span className="mb-1 block text-[10px] font-medium text-muted">
          {t("studio.theme.metaTitle")}
        </span>
        <input
          key={metaTitle}
          type="text"
          defaultValue={metaTitle}
          maxLength={80}
          className={inputCls}
          onBlur={(e) => {
            if (e.target.value !== metaTitle) onMetaTitle(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      </label>
    </div>
  );
}
