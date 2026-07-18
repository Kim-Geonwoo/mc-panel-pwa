"use client";

// 스타일 토큰 폼(T4.3) — props.style을 편집한다. 토큰 목록·검증은 styleProps.ts가
// 단일 소스(폼은 그 튜플을 옵션으로만 소비, 자유 CSS 입력 경로 없음). 커밋 정책:
// 셀렉트·세그먼트·토글은 즉시, hex는 blur/Enter(무효 hex는 커밋 차단 — 히스토리
// 오염 방지, 기존 ThemeEditor accent 패턴). 빈 style은 undefined로 커밋해 호출부
// (인스펙터)가 키를 제거하게 한다. T5.1의 일반 폼이 이 컴포넌트를 공통 섹션으로
// 흡수하므로 독립 컴포넌트 인터페이스를 유지한다(계획 T4.3).
import { useEffect, useState } from "react";
import { useI18n } from "../../lib/i18n";
import {
  ALIGN_TOKENS,
  BORDER_TOKENS,
  COLOR_TOKENS,
  HEIGHT_TOKENS,
  HEX_COLOR_RE,
  JUSTIFY_TOKENS,
  LAYOUT_ONLY_STYLE_KEYS,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
  SPACE_TOKENS,
  StyleSchema,
  WIDTH_TOKENS,
  type BlockStyle,
} from "../../lib/builder/styleProps";

const inputCls =
  "w-full rounded-lg border border-line bg-card px-2 py-1.5 text-xs text-fg outline-none focus:border-accent";

// 방향별(접이식) 여백 키 — StyleSchema의 방향 키와 1:1. 하나라도 값이 있으면 접이식을
// 초기 펼침으로 시작해 기존 값이 숨겨지지 않게 한다.
const DIR_KEYS = ["mx", "my", "mt", "mb", "ml", "mr", "px", "py", "pt", "pb", "pl", "pr"] as const;
type DirKey = (typeof DIR_KEYS)[number];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 mt-3 text-[10px] font-semibold uppercase tracking-wide text-muted">
      {children}
    </div>
  );
}

// 토큰 셀렉트 — 빈 옵션("기본") = 키 해제. 옵션은 styleProps의 튜플만 받으므로
// 임의 값이 커밋될 경로가 없다(제네릭 T가 그 튜플 원소로 고정된다).
function TokenSelect<T extends string>({
  label,
  mono,
  value,
  tokens,
  onChange,
}: {
  label: string;
  mono?: boolean; // 방향별 키(mx 등)는 mono 표기
  value: T | undefined;
  tokens: readonly T[];
  onChange: (v: T | undefined) => void;
}) {
  const { t } = useI18n();
  return (
    <label className="mb-2 block">
      <span className={["mb-1 block text-[10px] font-medium text-muted", mono ? "font-mono" : ""].join(" ")}>
        {label}
      </span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : (e.target.value as T))}
        className={inputCls}
      >
        <option value="">{t("studio.style.unset")}</option>
        {tokens.map((tok) => (
          <option key={tok} value={tok}>
            {tok}
          </option>
        ))}
      </select>
    </label>
  );
}

// 색 필드 — 토큰 세그먼트(재클릭=해제) + hex 입력(blur/Enter 커밋, 무효는 차단·에러 표기).
// 토큰 선택 시 hex 입력은 비워진다(둘은 같은 키의 배타 표현).
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined; // 토큰 또는 hex
  onChange: (v: string | undefined) => void;
}) {
  const { t } = useI18n();
  const isHex = value !== undefined && HEX_COLOR_RE.test(value);
  const [hex, setHex] = useState(isHex ? value : "");
  // undo·외부 변경과 동기화(ThemeEditor accent 패턴).
  useEffect(() => {
    setHex(value !== undefined && HEX_COLOR_RE.test(value) ? value : "");
  }, [value]);
  const hexOk = hex === "" || HEX_COLOR_RE.test(hex);

  const commitHex = () => {
    if (hex === "") {
      // 빈 입력은 "hex 해제"만 의미한다 — 토큰이 선택된 상태를 지우지 않는다.
      if (isHex) onChange(undefined);
      return;
    }
    if (!HEX_COLOR_RE.test(hex)) return; // 무효 hex는 커밋 차단(에러 표기만)
    if (hex !== value) onChange(hex);
  };

  return (
    <div className="mb-2">
      <div className="mb-1 text-[10px] font-medium text-muted">{label}</div>
      <div className="mb-1 flex gap-1 rounded-xl bg-card2 p-1" role="group" aria-label={label}>
        {COLOR_TOKENS.map((tok) => (
          <button
            key={tok}
            type="button"
            aria-pressed={value === tok}
            onClick={() => onChange(value === tok ? undefined : tok)}
            className={[
              "min-w-0 flex-1 truncate rounded-lg px-1 py-1 text-[10px] font-medium",
              value === tok ? "bg-card text-fg shadow-card" : "text-muted hover:text-fg",
            ].join(" ")}
          >
            {tok}
          </button>
        ))}
      </div>
      <input
        type="text"
        value={hex}
        placeholder="#22c55e"
        aria-label={`${label} hex`}
        className={[inputCls, hexOk ? "" : "border-danger"].join(" ")}
        onChange={(e) => setHex(e.target.value)}
        onBlur={commitHex}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      {!hexOk && <p className="mt-1 text-[10px] text-danger">{t("studio.style.hexErr")}</p>}
    </div>
  );
}

export default function StyleFields({
  value,
  layout,
  onCommit,
}: {
  value: unknown; // props.style 원본 — 무효·부재는 빈 폼으로 취급(resolveStyle과 동일 관용)
  layout: boolean; // kind==="layout" — gap·align·justify(LAYOUT_ONLY_STYLE_KEYS) 노출
  onCommit: (next: BlockStyle | undefined) => void;
}) {
  const { t } = useI18n();
  const parsed = StyleSchema.safeParse(value);
  const cur: BlockStyle = parsed.success ? parsed.data : {};
  // 방향별 접이식 — 초기값은 "값이 있으면 펼침"(마운트 시 1회 판정, 이후 사용자 토글).
  const [dirOpen, setDirOpen] = useState(() => DIR_KEYS.some((k) => cur[k] !== undefined));

  // 한 키만 바꾼 style을 커밋한다. undefined = 키 해제, 결과가 빈 객체면 style 자체 제거.
  function set<K extends keyof BlockStyle>(k: K, v: BlockStyle[K] | undefined) {
    const next: BlockStyle = { ...cur };
    if (v === undefined) delete next[k];
    else next[k] = v;
    onCommit(Object.keys(next).length ? next : undefined);
  }

  return (
    <div>
      <SectionTitle>{t("studio.style.spacing")}</SectionTitle>
      <TokenSelect label={t("studio.style.margin")} value={cur.m} tokens={SPACE_TOKENS} onChange={(v) => set("m", v)} />
      <TokenSelect label={t("studio.style.padding")} value={cur.p} tokens={SPACE_TOKENS} onChange={(v) => set("p", v)} />
      <button
        type="button"
        aria-expanded={dirOpen}
        onClick={() => setDirOpen((o) => !o)}
        className="mb-2 flex items-center gap-1 rounded-lg px-1 py-0.5 text-[10px] font-medium text-muted hover:text-fg"
      >
        <span aria-hidden>{dirOpen ? "▾" : "▸"}</span>
        {t("studio.style.directional")}
      </button>
      {dirOpen && (
        <div className="grid grid-cols-2 gap-x-2">
          {DIR_KEYS.map((k: DirKey) => (
            <TokenSelect key={k} mono label={k} value={cur[k]} tokens={SPACE_TOKENS} onChange={(v) => set(k, v)} />
          ))}
        </div>
      )}

      <SectionTitle>{t("studio.style.size")}</SectionTitle>
      <TokenSelect label={t("studio.style.width")} value={cur.w} tokens={WIDTH_TOKENS} onChange={(v) => set("w", v)} />
      <TokenSelect label={t("studio.style.height")} value={cur.h} tokens={HEIGHT_TOKENS} onChange={(v) => set("h", v)} />
      <label className="mb-2 flex items-center gap-2 text-xs text-fg">
        <input
          type="checkbox"
          checked={cur.grow === true}
          // false는 부재와 동일(resolveStyle "켤 때만 클래스" 정책) — 끄면 키를 제거한다.
          onChange={(e) => set("grow", e.target.checked ? true : undefined)}
          className="accent-accent"
        />
        {t("studio.style.grow")}
      </label>

      <SectionTitle>{t("studio.style.colors")}</SectionTitle>
      <ColorField label={t("studio.style.bg")} value={cur.bg} onChange={(v) => set("bg", v)} />
      <ColorField label={t("studio.style.fg")} value={cur.fg} onChange={(v) => set("fg", v)} />

      <SectionTitle>{t("studio.style.decor")}</SectionTitle>
      <TokenSelect label={t("studio.style.radius")} value={cur.radius} tokens={RADIUS_TOKENS} onChange={(v) => set("radius", v)} />
      <TokenSelect label={t("studio.style.border")} value={cur.border} tokens={BORDER_TOKENS} onChange={(v) => set("border", v)} />
      <TokenSelect label={t("studio.style.shadow")} value={cur.shadow} tokens={SHADOW_TOKENS} onChange={(v) => set("shadow", v)} />

      {/* gap·align·justify는 layout 블록에서만 의미(LAYOUT_ONLY_STYLE_KEYS — styleProps
          단일 소스). 키 목록은 튜플을 순회하므로 튜플이 늘면 아래 메타 맵이 tsc로 강제된다. */}
      {layout && (
        <>
          <SectionTitle>{t("studio.style.layoutGroup")}</SectionTitle>
          {LAYOUT_ONLY_STYLE_KEYS.map((k) => {
            const meta = LAYOUT_FIELD_META[k];
            return (
              <TokenSelect
                key={k}
                label={t(meta.labelKey)}
                value={cur[k]}
                tokens={meta.tokens}
                // 옵션이 해당 키의 스키마 튜플 그대로라 값 집합이 일치한다(캐스트 안전).
                onChange={(v) => set(k, v as BlockStyle[typeof k])}
              />
            );
          })}
        </>
      )}
    </div>
  );
}

// layout 한정 키의 폼 메타 — LAYOUT_ONLY_STYLE_KEYS 원소가 늘면 여기 누락을 tsc가 잡는다.
const LAYOUT_FIELD_META: Record<
  (typeof LAYOUT_ONLY_STYLE_KEYS)[number],
  { labelKey: string; tokens: readonly string[] }
> = {
  gap: { labelKey: "studio.style.gap", tokens: SPACE_TOKENS },
  align: { labelKey: "studio.style.align", tokens: ALIGN_TOKENS },
  justify: { labelKey: "studio.style.justify", tokens: JUSTIFY_TOKENS },
};
