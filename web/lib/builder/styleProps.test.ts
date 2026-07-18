// styleProps(Task 4.1) 테스트 — 보안 불변식을 행위로 고정한다:
// ①자유 CSS 문자열 금지(열거 토큰 + #RRGGBB hex만) ②산출 클래스는 정적 룩업 테이블
// 값 집합의 부분집합(속성 테스트로 주입 불가 증명) ③hex는 인라인 color/backgroundColor
// 2속성만 ④무효 style은 null(스타일만 무시 — 블록은 생존, 절대 throw 금지).
import { describe, it, expect } from "vitest";
import {
  resolveStyle,
  StyleSchema,
  STYLE_CLASS_VALUES,
  SPACE_TOKENS,
  COLOR_TOKENS,
  WIDTH_TOKENS,
  HEIGHT_TOKENS,
  ALIGN_TOKENS,
  JUSTIFY_TOKENS,
  RADIUS_TOKENS,
  BORDER_TOKENS,
  SHADOW_TOKENS,
  LAYOUT_ONLY_STYLE_KEYS,
  HEX_COLOR_RE,
} from "./styleProps";

// props.style만 다르게 하는 축약 헬퍼
const css = (style: unknown) => resolveStyle({ style });

const SPACING_PREFIXES = [
  "m", "mx", "my", "mt", "mb", "ml", "mr",
  "p", "px", "py", "pt", "pb", "pl", "pr",
  "gap",
] as const;

describe("resolveStyle — 토큰→클래스 전수 매핑", () => {
  it("여백·간격: 15개 프리픽스 × 8토큰 전수(테스트 측 보간은 기대값 생성일 뿐)", () => {
    for (const prefix of SPACING_PREFIXES) {
      for (const tok of SPACE_TOKENS) {
        expect(css({ [prefix]: tok })).toEqual({ className: `${prefix}-${tok}` });
      }
    }
  });

  it("너비 w 전수", () => {
    const expected: Record<(typeof WIDTH_TOKENS)[number], string> = {
      auto: "w-auto", full: "w-full", fit: "w-fit",
      "1/2": "w-1/2", "1/3": "w-1/3", "2/3": "w-2/3",
    };
    for (const tok of WIDTH_TOKENS) expect(css({ w: tok })).toEqual({ className: expected[tok] });
  });

  it("높이 h 전수", () => {
    const expected: Record<(typeof HEIGHT_TOKENS)[number], string> = { auto: "h-auto", full: "h-full" };
    for (const tok of HEIGHT_TOKENS) expect(css({ h: tok })).toEqual({ className: expected[tok] });
  });

  it("grow: true→flex-1, false→무배출(부재와 동일 취급 — Spacer 기본 flex-1과 충돌 방지)", () => {
    expect(css({ grow: true })).toEqual({ className: "flex-1" });
    expect(css({ grow: false })).toBeNull();
  });

  it("align 전수(items-*)", () => {
    const expected: Record<(typeof ALIGN_TOKENS)[number], string> = {
      start: "items-start", center: "items-center", end: "items-end", stretch: "items-stretch",
    };
    for (const tok of ALIGN_TOKENS) expect(css({ align: tok })).toEqual({ className: expected[tok] });
  });

  it("justify 전수(justify-*)", () => {
    const expected: Record<(typeof JUSTIFY_TOKENS)[number], string> = {
      start: "justify-start", center: "justify-center", end: "justify-end", between: "justify-between",
    };
    for (const tok of JUSTIFY_TOKENS) expect(css({ justify: tok })).toEqual({ className: expected[tok] });
  });

  it("bg 색 토큰 전수(bg-*)", () => {
    const expected: Record<(typeof COLOR_TOKENS)[number], string> = {
      card: "bg-card", card2: "bg-card2", accent: "bg-accent", transparent: "bg-transparent",
    };
    for (const tok of COLOR_TOKENS) expect(css({ bg: tok })).toEqual({ className: expected[tok] });
  });

  it("fg 색 토큰 전수(text-*)", () => {
    const expected: Record<(typeof COLOR_TOKENS)[number], string> = {
      card: "text-card", card2: "text-card2", accent: "text-accent", transparent: "text-transparent",
    };
    for (const tok of COLOR_TOKENS) expect(css({ fg: tok })).toEqual({ className: expected[tok] });
  });

  it("radius 전수(rounded-*) — lg/xl/2xl은 tailwind.config의 --r-* 변수를 소비", () => {
    const expected: Record<(typeof RADIUS_TOKENS)[number], string> = {
      none: "rounded-none", sm: "rounded-sm", md: "rounded-md", lg: "rounded-lg",
      xl: "rounded-xl", "2xl": "rounded-2xl", full: "rounded-full",
    };
    for (const tok of RADIUS_TOKENS) expect(css({ radius: tok })).toEqual({ className: expected[tok] });
  });

  it("border 전수 — line은 복수 클래스(border border-line)", () => {
    expect(css({ border: "none" })).toEqual({ className: "border-0" });
    expect(css({ border: "line" })).toEqual({ className: "border border-line" });
  });

  it("shadow 전수", () => {
    expect(css({ shadow: "none" })).toEqual({ className: "shadow-none" });
    expect(css({ shadow: "card" })).toEqual({ className: "shadow-card" });
  });
});

describe("resolveStyle — hex는 인라인 2속성만", () => {
  it("bg hex → backgroundColor만, 클래스 무배출", () => {
    expect(css({ bg: "#1a2b3c" })).toEqual({ className: "", style: { backgroundColor: "#1a2b3c" } });
  });

  it("fg hex → color만(대문자 hex 허용)", () => {
    expect(css({ fg: "#AABBCC" })).toEqual({ className: "", style: { color: "#AABBCC" } });
  });

  it("hex와 토큰 혼용 — 인라인 키는 정확히 color/backgroundColor의 부분집합", () => {
    const r = css({ bg: "card", fg: "#ffffff", p: "4" });
    expect(r).toEqual({ className: "p-4 bg-card", style: { color: "#ffffff" } });
    const both = css({ bg: "#000000", fg: "#ffffff" });
    expect(both?.style && Object.keys(both.style).sort()).toEqual(["backgroundColor", "color"]);
  });

  it("토큰만 쓰면 style 키 자체가 없다(인라인 최소화)", () => {
    expect(css({ bg: "accent" })).toEqual({ className: "bg-accent" });
    expect(css({ bg: "accent" })?.style).toBeUndefined();
  });
});

describe("resolveStyle — 조합·결정적 순서", () => {
  it("복합 지정은 선언 순서(여백→크기→플렉스→색→모서리→테두리→그림자)로 안정 출력", () => {
    expect(css({ p: "3", w: "full", radius: "xl", border: "line", shadow: "card", bg: "card" })).toEqual({
      className: "p-3 w-full bg-card rounded-xl border border-line shadow-card",
    });
  });

  it("입력 키 순서와 무관하게 동일 출력", () => {
    const a = css({ px: "4", m: "2" });
    const b = css({ m: "2", px: "4" });
    expect(a).toEqual({ className: "m-2 px-4" });
    expect(b).toEqual(a);
  });
});

describe("resolveStyle — 무효 입력 격리(null, 절대 throw 금지)", () => {
  it("무효 hex·CSS 주입 페이로드 → null", () => {
    const bad = [
      "#12345", "#1234567", "#12345g", "red", "javascript:alert(1)",
      "url(#x)", "#123456; background-image:url(x)", "#123456 !important",
    ];
    for (const v of bad) expect(css({ bg: v })).toBeNull();
    for (const v of bad) expect(css({ fg: v })).toBeNull();
  });

  it("무효 토큰(허용 열거 밖) → null — 전체 style 단위로 무시", () => {
    expect(css({ m: "7" })).toBeNull(); // 스케일 밖
    expect(css({ m: 4 })).toBeNull(); // 숫자형 금지(문자열 토큰만)
    expect(css({ w: "screen" })).toBeNull();
    expect(css({ grow: "true" })).toBeNull();
    expect(css({ m: "2 evil" })).toBeNull();
    expect(css({ m: "2", w: "screen" })).toBeNull(); // 일부만 무효여도 전체 무시
  });

  it("비객체 style → null", () => {
    for (const v of ["m-2 evil", 5, true, [], null, () => {}]) expect(css(v)).toBeNull();
  });

  it("style 부재·빈 결과 → null", () => {
    expect(resolveStyle(undefined)).toBeNull();
    expect(resolveStyle({})).toBeNull();
    expect(css({})).toBeNull();
    expect(css({ futureKey: "x" })).toBeNull(); // 미지 키만 → strip 후 빈 결과
  });
});

describe("StyleSchema — 전방호환(미지 키 strip)", () => {
  it("미지 키는 버리고 아는 키만 유지(additive-only)", () => {
    expect(css({ m: "2", futureKey: "x" })).toEqual({ className: "m-2" });
    const r = StyleSchema.safeParse({ m: "2", futureKey: "x" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ m: "2" });
  });
});

describe("주입 불가 속성 테스트 — 산출 클래스 ⊆ 정적 룩업 테이블 값 집합", () => {
  // 산출된 className을 개별 클래스로 쪼개 전부 STYLE_CLASS_VALUES에 속함을 확인
  function assertSubset(r: ReturnType<typeof resolveStyle>) {
    if (!r) return;
    for (const c of r.className.split(" ").filter(Boolean)) {
      expect(STYLE_CLASS_VALUES.has(c), `룩업 테이블 밖 클래스: ${c}`).toBe(true);
    }
    if (r.style) {
      for (const k of Object.keys(r.style)) expect(["color", "backgroundColor"]).toContain(k);
      for (const v of Object.values(r.style)) expect(String(v)).toMatch(HEX_COLOR_RE);
    }
  }

  it("전 유효 토큰 단건 전수", () => {
    const singles: Record<string, readonly unknown[]> = {
      w: WIDTH_TOKENS, h: HEIGHT_TOKENS, grow: [true],
      align: ALIGN_TOKENS, justify: JUSTIFY_TOKENS,
      bg: [...COLOR_TOKENS, "#0f9d58"], fg: [...COLOR_TOKENS, "#0f9d58"],
      radius: RADIUS_TOKENS, border: BORDER_TOKENS, shadow: SHADOW_TOKENS,
    };
    for (const prefix of SPACING_PREFIXES) singles[prefix] = SPACE_TOKENS;
    for (const [key, values] of Object.entries(singles)) {
      for (const v of values) assertSubset(css({ [key]: v }));
    }
  });

  it("퍼즈 500회: 유효·적대 값 혼합 — throw 없음·부분집합 유지", () => {
    // 결정적 LCG(시드 고정 — 재현 가능)
    let seed = 20260717;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];

    const keys = [
      ...SPACING_PREFIXES, "w", "h", "grow", "align", "justify",
      "bg", "fg", "radius", "border", "shadow", "future", "__proto__", "constructor",
    ] as const;
    const values: readonly unknown[] = [
      ...SPACE_TOKENS, ...WIDTH_TOKENS, ...ALIGN_TOKENS, ...COLOR_TOKENS,
      ...RADIUS_TOKENS, ...BORDER_TOKENS, ...SHADOW_TOKENS, true, false,
      "#12ab34", "#ZZZZZZ", "'>\"><img src=x>", "m-2; position:fixed", "url(javascript:1)",
      42, null, undefined, {}, [], "between", "line", "card",
    ];

    for (let i = 0; i < 500; i++) {
      const style: Record<string, unknown> = {};
      const n = Math.floor(rand() * 6);
      for (let j = 0; j < n; j++) style[pick(keys)] = pick(values);
      let r: ReturnType<typeof resolveStyle> = null;
      expect(() => { r = css(style); }).not.toThrow();
      assertSubset(r);
    }
  });
});

describe("보조 export", () => {
  it("LAYOUT_ONLY_STYLE_KEYS = gap·align·justify(폼에서 layout 블록 한정)", () => {
    expect(LAYOUT_ONLY_STYLE_KEYS).toEqual(["gap", "align", "justify"]);
  });

  it("HEX_COLOR_RE는 #RRGGBB 정확 일치만", () => {
    expect(HEX_COLOR_RE.test("#aA09fF")).toBe(true);
    expect(HEX_COLOR_RE.test("#999")).toBe(false);
    expect(HEX_COLOR_RE.test(" #aabbcc")).toBe(false);
    expect(HEX_COLOR_RE.test("#aabbcc ")).toBe(false);
  });
});
