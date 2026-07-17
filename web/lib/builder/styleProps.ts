// 스타일 토큰 시스템(스튜디오 v2 Task 4.1) — props.style(additive 선택 필드)을 검증하고
// Tailwind 클래스·인라인 색으로 해석하는 순수 모듈. 렌더러(T4.2)·인스펙터 폼(T4.3)·
// 우클릭 스타일 폼(T6.3)이 공유하는 단일 소스다.
//
// 보안 불변식(Phase 1 스펙 §7 확장 — 계획 Global Constraints):
//  1) 자유 CSS 문자열 금지 — 값은 아래 열거 토큰과 ^#[0-9a-fA-F]{6}$ hex만 통과한다.
//  2) 클래스는 이 파일의 "정적 룩업 테이블" 리터럴만 산출한다. 문자열 보간으로 클래스를
//     만들지 않으므로 임의 클래스 주입이 코드 구조상 불가능하고, Tailwind JIT도 소스의
//     리터럴을 그대로 인식한다(purge 안전).
//  3) hex는 검증 후 인라인 color/backgroundColor 2속성에만 배정한다 — url()/expression
//     류 페이로드가 성립할 CSS 문맥 자체가 없다.
//  4) 무효 style은 style만 무시(null 반환). 블록은 폴백 없이 생존하고 절대 throw하지 않는다.
import type { CSSProperties } from "react";
import { z } from "zod";

// ---- 토큰 단일 소스(폼 T4.3·T6.3이 옵션 목록으로 재사용) --------------------------------

// Tailwind 4px 스케일 부분집합(0~32px). 기존 UI가 쓰는 간격 범위와 일치.
export const SPACE_TOKENS = ["0", "1", "2", "3", "4", "5", "6", "8"] as const;
// 시맨틱 색 토큰 — tailwind.config colors(card/card2/accent)와 CSS 변수로 연결.
export const COLOR_TOKENS = ["card", "card2", "accent", "transparent"] as const;
export const WIDTH_TOKENS = ["auto", "full", "fit", "1/2", "1/3", "2/3"] as const;
export const HEIGHT_TOKENS = ["auto", "full"] as const;
export const ALIGN_TOKENS = ["start", "center", "end", "stretch"] as const;
export const JUSTIFY_TOKENS = ["start", "center", "end", "between"] as const;
// lg/xl/2xl은 tailwind.config borderRadius의 --r-* 변수를 소비(테마 radius 연동).
export const RADIUS_TOKENS = ["none", "sm", "md", "lg", "xl", "2xl", "full"] as const;
export const BORDER_TOKENS = ["none", "line"] as const;
export const SHADOW_TOKENS = ["none", "card"] as const;

// schema.ts hexColor와 동일 패턴 — 폼(hex 입력 검증)에서도 재사용한다.
export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

type SpaceTok = (typeof SPACE_TOKENS)[number];
type ColorTokT = (typeof COLOR_TOKENS)[number];
type WidthTok = (typeof WIDTH_TOKENS)[number];
type HeightTok = (typeof HEIGHT_TOKENS)[number];
type AlignTok = (typeof ALIGN_TOKENS)[number];
type JustifyTok = (typeof JUSTIFY_TOKENS)[number];
type RadiusTok = (typeof RADIUS_TOKENS)[number];
type BorderTok = (typeof BORDER_TOKENS)[number];
type ShadowTok = (typeof SHADOW_TOKENS)[number];

// ---- 스키마(검증 권위) ---------------------------------------------------------------

const Space = z.enum(SPACE_TOKENS);
const ColorTok = z.enum(COLOR_TOKENS);
const Hex = z.string().regex(HEX_COLOR_RE);

// z.object 기본 동작(미지 키 strip)이 additive 전방호환을 제공한다(schema.ts와 동일 원칙).
// 아는 키의 값이 무효면 전체 parse 실패 → resolveStyle이 style 전체를 무시한다.
export const StyleSchema = z
  .object({
    m: Space, mx: Space, my: Space, mt: Space, mb: Space, ml: Space, mr: Space,
    p: Space, px: Space, py: Space, pt: Space, pb: Space, pl: Space, pr: Space,
    w: z.enum(WIDTH_TOKENS),
    h: z.enum(HEIGHT_TOKENS),
    grow: z.boolean(), // true=flex-1(false는 부재와 동일 취급 — 아래 결정 주석)
    gap: Space,
    align: z.enum(ALIGN_TOKENS),
    justify: z.enum(JUSTIFY_TOKENS), // gap/align/justify는 layout 블록에서만 의미(폼에서 제한)
    bg: z.union([ColorTok, Hex]),
    fg: z.union([ColorTok, Hex]),
    radius: z.enum(RADIUS_TOKENS),
    border: z.enum(BORDER_TOKENS),
    shadow: z.enum(SHADOW_TOKENS),
  })
  .partial();

export type BlockStyle = z.infer<typeof StyleSchema>;

// 폼에서 layout 블록(vstack/hstack/header)에만 노출할 키.
export const LAYOUT_ONLY_STYLE_KEYS = ["gap", "align", "justify"] as const satisfies readonly (keyof BlockStyle)[];

// ---- 정적 클래스 룩업 테이블(보안 불변식 2의 물리적 실체) -------------------------------
// 아래 값들은 전부 소스 리터럴이다. 보간(`m-${v}`)으로 대체하면 주입 차단 증명과
// Tailwind JIT 인식이 동시에 깨지므로 절대 금지.

const M_CLASS = { "0": "m-0", "1": "m-1", "2": "m-2", "3": "m-3", "4": "m-4", "5": "m-5", "6": "m-6", "8": "m-8" } as const satisfies Record<SpaceTok, string>;
const MX_CLASS = { "0": "mx-0", "1": "mx-1", "2": "mx-2", "3": "mx-3", "4": "mx-4", "5": "mx-5", "6": "mx-6", "8": "mx-8" } as const satisfies Record<SpaceTok, string>;
const MY_CLASS = { "0": "my-0", "1": "my-1", "2": "my-2", "3": "my-3", "4": "my-4", "5": "my-5", "6": "my-6", "8": "my-8" } as const satisfies Record<SpaceTok, string>;
const MT_CLASS = { "0": "mt-0", "1": "mt-1", "2": "mt-2", "3": "mt-3", "4": "mt-4", "5": "mt-5", "6": "mt-6", "8": "mt-8" } as const satisfies Record<SpaceTok, string>;
const MB_CLASS = { "0": "mb-0", "1": "mb-1", "2": "mb-2", "3": "mb-3", "4": "mb-4", "5": "mb-5", "6": "mb-6", "8": "mb-8" } as const satisfies Record<SpaceTok, string>;
const ML_CLASS = { "0": "ml-0", "1": "ml-1", "2": "ml-2", "3": "ml-3", "4": "ml-4", "5": "ml-5", "6": "ml-6", "8": "ml-8" } as const satisfies Record<SpaceTok, string>;
const MR_CLASS = { "0": "mr-0", "1": "mr-1", "2": "mr-2", "3": "mr-3", "4": "mr-4", "5": "mr-5", "6": "mr-6", "8": "mr-8" } as const satisfies Record<SpaceTok, string>;
const P_CLASS = { "0": "p-0", "1": "p-1", "2": "p-2", "3": "p-3", "4": "p-4", "5": "p-5", "6": "p-6", "8": "p-8" } as const satisfies Record<SpaceTok, string>;
const PX_CLASS = { "0": "px-0", "1": "px-1", "2": "px-2", "3": "px-3", "4": "px-4", "5": "px-5", "6": "px-6", "8": "px-8" } as const satisfies Record<SpaceTok, string>;
const PY_CLASS = { "0": "py-0", "1": "py-1", "2": "py-2", "3": "py-3", "4": "py-4", "5": "py-5", "6": "py-6", "8": "py-8" } as const satisfies Record<SpaceTok, string>;
const PT_CLASS = { "0": "pt-0", "1": "pt-1", "2": "pt-2", "3": "pt-3", "4": "pt-4", "5": "pt-5", "6": "pt-6", "8": "pt-8" } as const satisfies Record<SpaceTok, string>;
const PB_CLASS = { "0": "pb-0", "1": "pb-1", "2": "pb-2", "3": "pb-3", "4": "pb-4", "5": "pb-5", "6": "pb-6", "8": "pb-8" } as const satisfies Record<SpaceTok, string>;
const PL_CLASS = { "0": "pl-0", "1": "pl-1", "2": "pl-2", "3": "pl-3", "4": "pl-4", "5": "pl-5", "6": "pl-6", "8": "pl-8" } as const satisfies Record<SpaceTok, string>;
const PR_CLASS = { "0": "pr-0", "1": "pr-1", "2": "pr-2", "3": "pr-3", "4": "pr-4", "5": "pr-5", "6": "pr-6", "8": "pr-8" } as const satisfies Record<SpaceTok, string>;
const GAP_CLASS = { "0": "gap-0", "1": "gap-1", "2": "gap-2", "3": "gap-3", "4": "gap-4", "5": "gap-5", "6": "gap-6", "8": "gap-8" } as const satisfies Record<SpaceTok, string>;

const WIDTH_CLASS = { auto: "w-auto", full: "w-full", fit: "w-fit", "1/2": "w-1/2", "1/3": "w-1/3", "2/3": "w-2/3" } as const satisfies Record<WidthTok, string>;
const HEIGHT_CLASS = { auto: "h-auto", full: "h-full" } as const satisfies Record<HeightTok, string>;
const GROW_CLASS = "flex-1";
const ALIGN_CLASS = { start: "items-start", center: "items-center", end: "items-end", stretch: "items-stretch" } as const satisfies Record<AlignTok, string>;
const JUSTIFY_CLASS = { start: "justify-start", center: "justify-center", end: "justify-end", between: "justify-between" } as const satisfies Record<JustifyTok, string>;
const BG_CLASS = { card: "bg-card", card2: "bg-card2", accent: "bg-accent", transparent: "bg-transparent" } as const satisfies Record<ColorTokT, string>;
const FG_CLASS = { card: "text-card", card2: "text-card2", accent: "text-accent", transparent: "text-transparent" } as const satisfies Record<ColorTokT, string>;
const RADIUS_CLASS = { none: "rounded-none", sm: "rounded-sm", md: "rounded-md", lg: "rounded-lg", xl: "rounded-xl", "2xl": "rounded-2xl", full: "rounded-full" } as const satisfies Record<RadiusTok, string>;
// "line"은 두 클래스(폭 기본 1px + 시맨틱 선 색). 룩업 값이 복수 클래스여도 리터럴이다.
const BORDER_CLASS = { none: "border-0", line: "border border-line" } as const satisfies Record<BorderTok, string>;
const SHADOW_CLASS = { none: "shadow-none", card: "shadow-card" } as const satisfies Record<ShadowTok, string>;

// 이 모듈이 산출할 수 있는 개별 클래스의 전체 집합(테이블에서 기계적으로 파생 — 수기 목록
// 아님). 테스트가 "산출 ⊆ 이 집합"을 속성 테스트로 검증해 주입 불가를 증명한다.
const ALL_TABLES: readonly Record<string, string>[] = [
  M_CLASS, MX_CLASS, MY_CLASS, MT_CLASS, MB_CLASS, ML_CLASS, MR_CLASS,
  P_CLASS, PX_CLASS, PY_CLASS, PT_CLASS, PB_CLASS, PL_CLASS, PR_CLASS, GAP_CLASS,
  WIDTH_CLASS, HEIGHT_CLASS, ALIGN_CLASS, JUSTIFY_CLASS, BG_CLASS, FG_CLASS,
  RADIUS_CLASS, BORDER_CLASS, SHADOW_CLASS,
];
export const STYLE_CLASS_VALUES: ReadonlySet<string> = new Set(
  ALL_TABLES.flatMap((t) => Object.values(t).flatMap((v) => v.split(" "))).concat(GROW_CLASS)
);

const COLOR_TOKEN_SET: ReadonlySet<string> = new Set(COLOR_TOKENS);
function isColorToken(v: string): v is ColorTokT {
  return COLOR_TOKEN_SET.has(v);
}

// ---- 해석기 --------------------------------------------------------------------------

// props.style을 해석한다. null = "적용할 스타일 없음"(부재·빈 결과·무효를 통일) —
// 렌더러는 null이면 아무것도 병합하지 않고 블록을 그대로 그린다(불변식 4). 절대 throw 금지.
// 출력 클래스 순서는 입력 키 순서와 무관하게 아래 선언 순서로 고정된다(결정적 렌더).
export function resolveStyle(
  props: Record<string, unknown> | undefined
): { className: string; style?: CSSProperties } | null {
  const parsed = StyleSchema.safeParse(props?.style);
  if (!parsed.success) return null; // 비객체·무효 토큰·무효 hex → style만 무시
  const s = parsed.data;

  const cls: string[] = [];
  if (s.m !== undefined) cls.push(M_CLASS[s.m]);
  if (s.mx !== undefined) cls.push(MX_CLASS[s.mx]);
  if (s.my !== undefined) cls.push(MY_CLASS[s.my]);
  if (s.mt !== undefined) cls.push(MT_CLASS[s.mt]);
  if (s.mb !== undefined) cls.push(MB_CLASS[s.mb]);
  if (s.ml !== undefined) cls.push(ML_CLASS[s.ml]);
  if (s.mr !== undefined) cls.push(MR_CLASS[s.mr]);
  if (s.p !== undefined) cls.push(P_CLASS[s.p]);
  if (s.px !== undefined) cls.push(PX_CLASS[s.px]);
  if (s.py !== undefined) cls.push(PY_CLASS[s.py]);
  if (s.pt !== undefined) cls.push(PT_CLASS[s.pt]);
  if (s.pb !== undefined) cls.push(PB_CLASS[s.pb]);
  if (s.pl !== undefined) cls.push(PL_CLASS[s.pl]);
  if (s.pr !== undefined) cls.push(PR_CLASS[s.pr]);
  if (s.w !== undefined) cls.push(WIDTH_CLASS[s.w]);
  if (s.h !== undefined) cls.push(HEIGHT_CLASS[s.h]);
  // grow:false는 무배출(부재와 동일) — flex-none을 뿜으면 Spacer의 기본 flex-1을
  // 의도치 않게 죽일 수 있어 "켤 때만 클래스" 정책을 택했다(T4.2 병합 순서 참고).
  if (s.grow) cls.push(GROW_CLASS);
  if (s.gap !== undefined) cls.push(GAP_CLASS[s.gap]);
  if (s.align !== undefined) cls.push(ALIGN_CLASS[s.align]);
  if (s.justify !== undefined) cls.push(JUSTIFY_CLASS[s.justify]);

  // hex는 스키마 통과 후에도 정규식을 한 번 더 확인(심층 방어)하고, 인라인
  // color/backgroundColor 2속성 외에는 어떤 CSS 속성에도 닿지 않는다(불변식 3).
  const inline: CSSProperties = {};
  if (s.bg !== undefined) {
    if (isColorToken(s.bg)) cls.push(BG_CLASS[s.bg]);
    else if (HEX_COLOR_RE.test(s.bg)) inline.backgroundColor = s.bg;
  }
  if (s.fg !== undefined) {
    if (isColorToken(s.fg)) cls.push(FG_CLASS[s.fg]);
    else if (HEX_COLOR_RE.test(s.fg)) inline.color = s.fg;
  }
  if (s.radius !== undefined) cls.push(RADIUS_CLASS[s.radius]);
  if (s.border !== undefined) cls.push(BORDER_CLASS[s.border]);
  if (s.shadow !== undefined) cls.push(SHADOW_CLASS[s.shadow]);

  const className = cls.join(" ");
  const hasInline = inline.color !== undefined || inline.backgroundColor !== undefined;
  if (className === "" && !hasInline) return null; // 빈 결과도 null로 통일(호출부 단순화)
  return hasInline ? { className, style: inline } : { className };
}
