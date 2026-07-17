// SDUI 레이아웃 스키마(zod v4). 서버가 내려주는 페이지 구성 JSON을 신뢰불가 입력으로
// 취급해 검증한다. z.object 기본 동작(미지 키 strip)이 additive-only 전방호환을 제공한다.
import { z } from "zod";

export const SCHEMA_VERSION = 1;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const i18nLabel = z.object({ ko: z.string().max(60), en: z.string().max(60) });

// 디자인 토큰(데이터로서의 테마). 값은 열거/정규식으로 제약해 CSS 주입을 차단한다.
export const ThemeSchema = z.object({
  mode: z.enum(["light", "dark", "auto"]).optional(),
  accent: hexColor.optional(),
  radius: z.enum(["sm", "md", "lg"]).optional(),
});

// Block: 재귀 트리(컨테이너=children 보유, leaf=미보유). 깊이/노드 상한은 parseLayout에서 검사.
export type Block = { type: string; props?: Record<string, unknown>; children?: Block[] };
export const BlockSchema: z.ZodType<Block> = z.lazy(() =>
  z.object({
    type: z.string().min(1).max(64),
    props: z.record(z.string(), z.unknown()).optional(),
    children: z.array(BlockSchema).optional(),
  })
);

export const TabSchema = z.object({
  id: z.string().min(1).max(32),
  label: i18nLabel,
  icon: z.string().max(32).optional(),
  enabled: z.boolean().optional(),
  content: z.array(BlockSchema).optional(),
});

export const LayoutSchema = z.object({
  version: z.literal(SCHEMA_VERSION),
  meta: z.object({ title: z.string().max(80).optional(), updatedAt: z.number().optional() }).optional(),
  theme: ThemeSchema.optional(),
  tabs: z.array(TabSchema).max(12).optional(),
  screen: BlockSchema.optional(),
});

export type Layout = z.infer<typeof LayoutSchema>;
export type ThemeSpec = z.infer<typeof ThemeSchema>;
export type TabSpec = z.infer<typeof TabSchema>;

const MAX_DEPTH = 20;
const MAX_NODES = 500;

function withinLimits(b: Block | undefined, depth: number, count: { n: number }): boolean {
  if (!b) return true;
  if (depth > MAX_DEPTH || ++count.n > MAX_NODES) return false;
  return (b.children ?? []).every((c) => withinLimits(c, depth + 1, count));
}

// parseLayout은 미지의 입력을 검증한다. 실패 시 throw하지 않고 null을 반환한다(부트 무중단).
export function parseLayout(u: unknown): Layout | null {
  const r = LayoutSchema.safeParse(u);
  if (!r.success) return null;
  const l = r.data;
  if (l.screen && !withinLimits(l.screen, 0, { n: 0 })) return null;
  for (const t of l.tabs ?? []) {
    for (const c of t.content ?? []) {
      if (!withinLimits(c, 0, { n: 0 })) return null;
    }
  }
  return l;
}
