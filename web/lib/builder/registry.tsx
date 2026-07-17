// 블록 레지스트리 — 렌더 가능한 타입의 화이트리스트(단일 소스). 여기 없는 타입은
// BlockRenderer가 폴백 처리한다(스펙 §3). 항목 추가는 additive-only.
import type { FC, ReactNode } from "react";
import { z, type ZodType } from "zod";
import type { Block } from "./schema";
import { HStack, LogoBlock, Spacer, TextBlock, VStack } from "./blocks/simple";

export type BlockComponentProps = { node: Block; children?: ReactNode };

export type BlockDef = {
  kind: "layout" | "element"; // layout=children 재귀, element=leaf
  component: FC<BlockComponentProps>;
  propsSchema?: ZodType; // 검증 실패 → 폴백(렌더 안 함)
  keepMounted?: boolean; // TabContent 전용: 비활성 탭에서도 숨김 마운트 유지
  label: { ko: string; en: string }; // Phase 2 편집기 팔레트 표기
};

// text.i18n은 화이트리스트 키만 — 임의 키로 사전을 뒤지는 것을 차단한다.
const textProps = z.object({
  i18n: z.enum(["panel.title"]).optional(),
  ko: z.string().max(200).optional(),
  en: z.string().max(200).optional(),
  variant: z.enum(["title", "body", "caption"]).optional(),
});

const logoProps = z.object({ size: z.number().int().min(16).max(128).optional() });

export const REGISTRY: Record<string, BlockDef> = {
  vstack: { kind: "layout", component: VStack, label: { ko: "세로 스택", en: "VStack" } },
  hstack: { kind: "layout", component: HStack, label: { ko: "가로 스택", en: "HStack" } },
  spacer: { kind: "element", component: Spacer, label: { ko: "공간", en: "Spacer" } },
  text: { kind: "element", component: TextBlock, propsSchema: textProps, label: { ko: "텍스트", en: "Text" } },
  logo: { kind: "element", component: LogoBlock, propsSchema: logoProps, label: { ko: "로고", en: "Logo" } },
};
