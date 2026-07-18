// 블록 레지스트리 — 렌더 가능한 타입의 화이트리스트(단일 소스). 여기 없는 타입은
// BlockRenderer가 폴백 처리한다(스펙 §3). 항목 추가는 additive-only.
import type { CSSProperties, FC, ReactNode } from "react";
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

// styleClassName/styleInline(T4.2): BlockRenderer가 resolveStyle(node.props)를 중앙에서
// 한 번 해석해 내려주는 스타일 토큰 산출물. 각 블록은 자기 "루트 요소"에
// className={cx(BASE, styleClassName)} style={styleInline}로 병합한다 — 래퍼 div는
// flex 체인 파괴·캔버스 display:contents 문제로, cloneElement는 취약성으로 기각(계획 T4.2).
export type BlockComponentProps = {
  node: Block;
  children?: ReactNode;
  styleClassName?: string;
  styleInline?: CSSProperties;
};

// 블록 기본 클래스 뒤에 사용자 스타일 클래스를 병합한다(뒤 = 사용자 우선, 계획 T4.2).
// extra 부재·빈 문자열이면 base를 문자 그대로 반환한다 — style 미지정 시 기존 DOM
// 클래스와 완전 동일해야 하는 회귀 0 요구(메인 패널)를 지키기 위한 불변식이다.
export function cx(base: string, extra?: string): string {
  return extra ? `${base} ${extra}` : base;
}

export type BlockDef = {
  kind: "layout" | "element"; // layout=children 재귀, element=leaf
  component: FC<BlockComponentProps>;
  propsSchema?: ZodType; // 검증 실패 → 폴백(렌더 안 함)
  keepMounted?: boolean; // TabContent 전용: 비활성 탭에서도 숨김 마운트 유지
  label: { ko: string; en: string }; // Phase 2 편집기 팔레트 표기
  // 레이아웃 전체(화면+탭 content+기본 매핑)에 1개만 허용 — 팔레트 중복 배치 가드(B8).
  // 중복 시 실동작이 깨지는 블록(chat-feed 이중 폴링 등)에만 지정한다. 렌더러는
  // 이 플래그를 강제하지 않는다(발행본 관대 수용 유지) — 편집기 전용 메타.
  unique?: boolean;
};

// props.style은 스타일 토큰 모듈(styleProps.ts)이 전담 검증한다 — 여기서 StyleSchema로
// 검증하면 무효 style이 propsSchema 실패=블록 폴백(렌더 생략)으로 번진다. 규칙은
// "무효 style은 스타일만 무시, 블록은 생존"이므로 propsSchema에서는 값을 묻지 않고
// 통과만 시킨다(z.unknown). z.object 기본 strip이 미지 키를 이미 관용하지만, 훗날
// .strict() 전환에도 style이 검증 실패 사유가 되지 않도록 명시해 둔다(계획 T4.2).
const styleProp = { style: z.unknown().optional() };

// text.i18n은 화이트리스트 키만 — 임의 키로 사전을 뒤지는 것을 차단한다.
const textProps = z.object({
  i18n: z.enum(["panel.title"]).optional(),
  ko: z.string().max(200).optional(),
  en: z.string().max(200).optional(),
  variant: z.enum(["title", "body", "caption"]).optional(),
  ...styleProp,
});

const logoProps = z.object({ size: z.number().int().min(16).max(128).optional(), ...styleProp });

export const REGISTRY: Record<string, BlockDef> = {
  vstack: { kind: "layout", component: VStack, label: { ko: "세로 스택", en: "VStack" } },
  hstack: { kind: "layout", component: HStack, label: { ko: "가로 스택", en: "HStack" } },
  header: { kind: "layout", component: Header, label: { ko: "헤더", en: "Header" } },
  spacer: { kind: "element", component: Spacer, label: { ko: "공간", en: "Spacer" } },
  text: { kind: "element", component: TextBlock, propsSchema: textProps, label: { ko: "텍스트", en: "Text" } },
  logo: { kind: "element", component: LogoBlock, propsSchema: logoProps, label: { ko: "로고", en: "Logo" } },
  "conn-banner": { kind: "element", component: ConnBanner, unique: true, label: { ko: "연결 배너", en: "Connection banner" } },
  "theme-toggle": { kind: "element", component: ThemeToggleBlock, label: { ko: "테마 토글", en: "Theme toggle" } },
  "settings-button": { kind: "element", component: SettingsButton, label: { ko: "설정 버튼", en: "Settings button" } },
  "server-status": { kind: "element", component: ServerStatus, label: { ko: "서버 상태 카드", en: "Server status" } },
  tabbar: { kind: "element", component: Tabbar, unique: true, label: { ko: "탭바", en: "Tab bar" } },
  "tab-content": { kind: "element", component: TabContent, unique: true, label: { ko: "탭 콘텐츠", en: "Tab content" } },
  "chat-feed": { kind: "element", component: ChatFeed, keepMounted: true, unique: true, label: { ko: "채팅", en: "Chat feed" } },
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
