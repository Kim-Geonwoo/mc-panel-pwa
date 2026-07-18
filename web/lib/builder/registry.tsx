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
import {
  SETTINGS_SECTION_IDS,
  type SettingsSectionId,
} from "../../components/SettingsSheet";

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

// 편집기 표기용 한·영 문구 쌍 — 라벨·설명·폼 필드 라벨이 공유하는 형태.
export type I18nPair = { ko: string; en: string };

export type FieldOption = { v: string; label: I18nPair };

// 인스펙터 일반 폼 메타(T5.1). propsSchema가 "검증 권위", fields는 "폼 메타"로 권위를
// 분리하되 레지스트리 한곳에 병기한다(블록당 단일 소스). zod 인트로스펙션 자동 생성은
// 기각 — zod v4 내부 API가 불안정하고, i18n 라벨·위젯 선택은 어차피 별도 메타가 필요하다.
// showIfEmpty: 해당 prop이 비어 있을 때만 노출(예: text의 ko/en은 i18n 키 미사용 시만) —
// 기존 수기 폼과 동작 동일을 위한 최소 조건부. fallback: 값 부재 시 표시 전용 기본값
// (커밋 전에는 props에 쓰지 않는다).
type FieldBase = { prop: string; label: I18nPair; showIfEmpty?: string };
export type FieldSpec =
  | (FieldBase & { kind: "text"; maxLength?: number })
  | (FieldBase & { kind: "select"; options: FieldOption[]; allowEmpty?: I18nPair; fallback?: string })
  | (FieldBase & { kind: "number"; min: number; max: number; fallback?: number })
  | (FieldBase & { kind: "toggle" })
  | (FieldBase & { kind: "multiEnum"; options: FieldOption[] });

export type BlockDef = {
  kind: "layout" | "element"; // layout=children 재귀, element=leaf
  component: FC<BlockComponentProps>;
  propsSchema?: ZodType; // 검증 실패 → 폴백(렌더 안 함)
  keepMounted?: boolean; // TabContent 전용: 비활성 탭에서도 숨김 마운트 유지
  label: I18nPair; // Phase 2 편집기 팔레트 표기
  // 팔레트 도움말(T3.3) — 블록이 무엇을 하는지 1문장. 필수라서 tsc가 15블록 전부 강제한다.
  // unique 블록은 "하나만 둘 수 있다" 제약 문구를 포함한다.
  description: I18nPair;
  // 인스펙터 일반 폼이 그릴 필드 목록(T5.1). 부재 = 공통부(이름·스타일)만 노출.
  fields?: FieldSpec[];
  // 레이아웃 전체(화면+탭 content+기본 매핑)에 1개만 허용 — 팔레트 중복 배치 가드(B8).
  // 중복 시 실동작이 깨지는 블록(chat-feed 이중 폴링 등)에만 지정한다. 렌더러는
  // 이 플래그를 강제하지 않는다(발행본 관대 수용 유지) — 편집기 전용 메타.
  unique?: boolean;
  // T4.2에서 스타일 적용 지점이 없는 블록(루트 요소를 외부 컴포넌트가 소유하거나
  // Fragment) — 인스펙터가 스타일 폼 대신 "미지원" 안내를 표기한다. 편집기 전용 메타.
  noStyle?: boolean;
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

// text 블록 폼 메타 — 기존 수기 폼(사전 키 셀렉트 → 미사용 시 ko/en → 모양)과 동작 동일.
// i18n 옵션 목록은 textProps의 화이트리스트와 나란히 유지한다(키 추가 시 양쪽 갱신).
const textFields: FieldSpec[] = [
  {
    kind: "select",
    prop: "i18n",
    label: { ko: "사전 키", en: "Dictionary key" },
    options: [{ v: "panel.title", label: { ko: "panel.title", en: "panel.title" } }],
    allowEmpty: { ko: "직접 입력", en: "Custom text" },
  },
  { kind: "text", prop: "ko", label: { ko: "문구(한국어)", en: "Text (Korean)" }, maxLength: 200, showIfEmpty: "i18n" },
  { kind: "text", prop: "en", label: { ko: "문구(영어)", en: "Text (English)" }, maxLength: 200, showIfEmpty: "i18n" },
  {
    kind: "select",
    prop: "variant",
    label: { ko: "모양", en: "Style" },
    options: [
      { v: "title", label: { ko: "제목", en: "Title" } },
      { v: "body", label: { ko: "본문", en: "Body" } },
      { v: "caption", label: { ko: "캡션", en: "Caption" } },
    ],
    fallback: "body", // 미지정 시 렌더 기본과 같은 "본문"을 표시(기존 폼과 동일)
  },
];

const logoFields: FieldSpec[] = [
  { kind: "number", prop: "size", label: { ko: "크기(px)", en: "Size (px)" }, min: 16, max: 128, fallback: 44 },
];

// settings-button: 시트 섹션 부분집합(계획 T5.2, additive — 부재=전체 표시).
// 규칙 예외: 무효 sections는 .catch(undefined)로 "무시"(=부재 취급)한다. 다른 블록처럼
// propsSchema 실패=블록 폴백을 적용하면 무효값 하나로 설정 진입점(알림·닉네임·로그아웃)
// 자체가 화면에서 사라지는 사고가 나기 때문 — 이 블록만 값 오류를 부재로 강등해 버튼을
// 살린다. 원소 단위 관대 해석(유효 id만 채택)은 SettingsButton 컴포넌트가 맡는다.
const settingsButtonProps = z.object({
  sections: z.array(z.enum(SETTINGS_SECTION_IDS)).optional().catch(undefined),
  ...styleProp,
});

// 섹션 라벨 — 시트의 섹션 제목(settings.*Title·common.logout)과 같은 문구.
// Record가 id 전수 커버를 강제하므로 SettingsSheet 튜플에 id가 늘면 tsc가 여기를 잡는다.
const SETTINGS_SECTION_LABEL: Record<SettingsSectionId, I18nPair> = {
  push: { ko: "알림", en: "Notifications" },
  tabs: { ko: "탭 표시", en: "Tab visibility" },
  lang: { ko: "언어", en: "Language" },
  nick: { ko: "닉네임 변경", en: "Change nickname" },
  logout: { ko: "로그아웃", en: "Log out" },
};

// settings-button 폼 메타 — 섹션 "포함 여부"만 편집한다(순서 편집은 후속 로드맵 B).
// 전부 해제 = 키 제거 = 부재 = 전체 표시(multiEnum 규약 유지 — T5.1에서 넘긴 결정):
// 빈 선택 상태는 두지 않는다. 섹션이 0개인 시트는 무의미하고, "전부 끄기"는 시트를
// 화면에서 빼는 것 = settings-button 블록 삭제로 이미 표현 가능하기 때문.
// 라벨의 Shift+클릭 안내는 T3.1 프리뷰(캔버스에서 실제 시트 열림)로의 편집 확인 힌트.
const settingsButtonFields: FieldSpec[] = [
  {
    kind: "multiEnum",
    prop: "sections",
    label: {
      ko: "표시할 섹션 — 캔버스에서 Shift+클릭으로 확인",
      en: "Sections to show — Shift+click on canvas to preview",
    },
    options: SETTINGS_SECTION_IDS.map((v) => ({ v, label: SETTINGS_SECTION_LABEL[v] })),
  },
];

export const REGISTRY: Record<string, BlockDef> = {
  vstack: {
    kind: "layout",
    component: VStack,
    label: { ko: "세로 스택", en: "VStack" },
    description: {
      ko: "자식 블록을 세로로 쌓는 컨테이너입니다. 화면 구성의 기본 뼈대로 사용합니다.",
      en: "A container that stacks child blocks vertically. Use it as the basic skeleton of a screen.",
    },
  },
  hstack: {
    kind: "layout",
    component: HStack,
    label: { ko: "가로 스택", en: "HStack" },
    description: {
      ko: "자식 블록을 가로로 나란히 배치하는 컨테이너입니다. 버튼 묶음 등에 적합합니다.",
      en: "A container that lays out child blocks side by side. Good for button groups.",
    },
  },
  header: {
    kind: "layout",
    component: Header,
    label: { ko: "헤더", en: "Header" },
    description: {
      ko: "화면 상단 영역 컨테이너입니다. 자식을 양 끝(제목·버튼)으로 정렬합니다.",
      en: "A top-of-screen container that aligns children to both ends (title and buttons).",
    },
  },
  spacer: {
    kind: "element",
    component: Spacer,
    label: { ko: "공간", en: "Spacer" },
    description: {
      ko: "남는 공간을 채워 이웃 블록을 양쪽으로 밀어내는 빈 블록입니다.",
      en: "An empty block that fills leftover space, pushing neighboring blocks apart.",
    },
  },
  text: {
    kind: "element",
    component: TextBlock,
    propsSchema: textProps,
    label: { ko: "텍스트", en: "Text" },
    description: {
      ko: "문구를 표시합니다. 한·영 직접 입력 또는 사전 키 연결, 제목·본문·캡션 모양을 지원합니다.",
      en: "Displays text. Supports direct Korean/English input or a dictionary key, in title, body, or caption style.",
    },
    fields: textFields,
  },
  logo: {
    kind: "element",
    component: LogoBlock,
    propsSchema: logoProps,
    label: { ko: "로고", en: "Logo" },
    description: {
      ko: "패널 로고를 표시합니다. 크기(px)를 조절할 수 있습니다.",
      en: "Shows the panel logo. The size (px) is adjustable.",
    },
    fields: logoFields,
    noStyle: true,
  },
  "conn-banner": {
    kind: "element",
    component: ConnBanner,
    unique: true,
    label: { ko: "연결 배너", en: "Connection banner" },
    description: {
      ko: "연결이 끊겼을 때만 나타나는 경고 배너입니다. 레이아웃에 하나만 둘 수 있습니다.",
      en: "A warning banner shown only while the connection is lost. Only one is allowed per layout.",
    },
  },
  "theme-toggle": {
    kind: "element",
    component: ThemeToggleBlock,
    label: { ko: "테마 토글", en: "Theme toggle" },
    description: {
      ko: "라이트·다크 테마를 전환하는 버튼입니다.",
      en: "A button that switches between light and dark themes.",
    },
    noStyle: true,
  },
  "settings-button": {
    kind: "element",
    component: SettingsButton,
    propsSchema: settingsButtonProps,
    label: { ko: "설정 버튼", en: "Settings button" },
    description: {
      ko: "설정 시트를 여는 버튼입니다. 알림·탭·언어·닉네임·로그아웃 설정을 담습니다.",
      en: "A button that opens the settings sheet: notifications, tabs, language, nickname, and logout.",
    },
    fields: settingsButtonFields,
  },
  "server-status": {
    kind: "element",
    component: ServerStatus,
    label: { ko: "서버 상태 카드", en: "Server status" },
    description: {
      ko: "서버 온라인 여부·TPS·접속자 목록을 보여주는 상태 카드입니다.",
      en: "A status card showing whether the server is online, TPS, and the player list.",
    },
  },
  tabbar: {
    kind: "element",
    component: Tabbar,
    unique: true,
    label: { ko: "탭바", en: "Tab bar" },
    description: {
      ko: "탭을 전환하는 바입니다. 탭 구성은 우측 \"탭\" 섹션에서 편집하며, 레이아웃에 하나만 둘 수 있습니다.",
      en: "A bar for switching tabs. Configure tabs in the Tabs section; only one is allowed per layout.",
    },
  },
  "tab-content": {
    kind: "element",
    component: TabContent,
    unique: true,
    label: { ko: "탭 콘텐츠", en: "Tab content" },
    description: {
      ko: "활성 탭의 콘텐츠가 렌더되는 자리입니다. 레이아웃에 하나만 둘 수 있습니다.",
      en: "The slot where the active tab's content is rendered. Only one is allowed per layout.",
    },
    noStyle: true,
  },
  "chat-feed": {
    kind: "element",
    component: ChatFeed,
    keepMounted: true,
    unique: true,
    label: { ko: "채팅", en: "Chat feed" },
    description: {
      ko: "게임·디스코드와 연동되는 실시간 채팅 피드입니다. 이중 폴링을 막기 위해 레이아웃에 하나만 둘 수 있습니다.",
      en: "A real-time chat feed bridged with the game and Discord. Only one is allowed per layout to avoid duplicate polling.",
    },
  },
  "perf-view": {
    kind: "element",
    component: PerfViewBlock,
    label: { ko: "성능", en: "Performance view" },
    description: {
      ko: "TPS·MSPT 등 서버 성능 그래프를 보여주는 화면입니다.",
      en: "A view with server performance graphs such as TPS and MSPT.",
    },
    noStyle: true,
  },
  "timeline-view": {
    kind: "element",
    component: TimelineViewBlock,
    label: { ko: "타임라인", en: "Timeline view" },
    description: {
      ko: "플레이어 접속·퇴장 기록을 세션 단위로 보여주는 접속 타임라인 화면입니다.",
      en: "A view showing the player join/leave history as per-session timelines.",
    },
    noStyle: true,
  },
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
