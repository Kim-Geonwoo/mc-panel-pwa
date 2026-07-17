// 블록 레지스트리 — 렌더 가능한 타입의 화이트리스트(단일 소스). 여기 없는 타입은
// BlockRenderer가 폴백 처리한다(스펙 §3). 항목 추가는 additive-only.
import type { FC, ReactNode } from "react";
import { z, type ZodType } from "zod";
import type { Block } from "./schema";
import {
  ConnBanner,
  Header,
  HStack,
  LogoBlock,
  PerfViewBlock,
  Spacer,
  TextBlock,
  ThemeToggleBlock,
  TimelineViewBlock,
  VStack,
} from "./blocks/simple";
import ChatFeed from "./blocks/ChatFeed";
import ServerStatus from "./blocks/ServerStatus";
import SettingsButton from "./blocks/SettingsButton";
import Tabbar from "./blocks/Tabbar";
import TabContent from "./blocks/TabContent";

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
  header: { kind: "layout", component: Header, label: { ko: "헤더", en: "Header" } },
  spacer: { kind: "element", component: Spacer, label: { ko: "공간", en: "Spacer" } },
  text: { kind: "element", component: TextBlock, propsSchema: textProps, label: { ko: "텍스트", en: "Text" } },
  logo: { kind: "element", component: LogoBlock, propsSchema: logoProps, label: { ko: "로고", en: "Logo" } },
  "conn-banner": { kind: "element", component: ConnBanner, label: { ko: "연결 배너", en: "Connection banner" } },
  "theme-toggle": { kind: "element", component: ThemeToggleBlock, label: { ko: "테마 토글", en: "Theme toggle" } },
  "settings-button": { kind: "element", component: SettingsButton, label: { ko: "설정 버튼", en: "Settings button" } },
  "server-status": { kind: "element", component: ServerStatus, label: { ko: "서버 상태 카드", en: "Server status" } },
  tabbar: { kind: "element", component: Tabbar, label: { ko: "탭바", en: "Tab bar" } },
  "tab-content": { kind: "element", component: TabContent, label: { ko: "탭 콘텐츠", en: "Tab content" } },
  "chat-feed": { kind: "element", component: ChatFeed, keepMounted: true, label: { ko: "채팅", en: "Chat feed" } },
  "perf-view": { kind: "element", component: PerfViewBlock, label: { ko: "성능", en: "Performance view" } },
  "timeline-view": { kind: "element", component: TimelineViewBlock, label: { ko: "타임라인", en: "Timeline view" } },
};

// 번들 기본 화면 트리 — 현행 UI의 JSON 표현. layout.screen 부재 시 사용된다
// (Go 기본 레이아웃은 screen을 내려주지 않음 = "클라 기본 사용", additive-only).
export const DEFAULT_SCREEN: Block = {
  type: "vstack",
  children: [
    {
      type: "header",
      children: [
        { type: "text", props: { i18n: "panel.title", variant: "title" } },
        { type: "hstack", children: [{ type: "theme-toggle" }, { type: "settings-button" }] },
      ],
    },
    { type: "conn-banner" },
    { type: "server-status" },
    { type: "tabbar" },
    { type: "tab-content" },
  ],
};
