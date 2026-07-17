// 스튜디오 편집 스코프 순수 모듈 — 편집 대상을 screen 트리 하나에서
// { kind:"screen" } | { kind:"tab", tabId } 스코프 집합으로 일반화한다(스튜디오 v2 증분 2).
// 탭 콘텐츠(Block[])는 가상 루트 tab-root로 감싸 editOps(순수·불변)를 그대로 재사용하고,
// 쓰기 시 children→content로 되돌린다. 가상 타입 tab-root는 레지스트리 비등록이며,
// writeScopeRoot가 노드 자체를 버리고 children만 저장하므로 발행본에 구조적으로
// 유입될 수 없다. editOps와 같은 불변식: 입력 불변형·절대 throw 금지·실패=원본/null.
import type { Block, Layout } from "./schema";
import type { BlockPath } from "./editOps";
import type { BlockDef } from "./registry";

export type EditScope = { kind: "screen" } | { kind: "tab"; tabId: string };
export type ScopedPath = { scope: EditScope; path: BlockPath };

// 가상 루트 타입 — REGISTRY에 등록하지 않는다(렌더 화이트리스트 밖). 캔버스·트리의
// 특수 처리 판별용으로만 쓰도록 상수로 노출한다(문자열 리터럴 산재 방지).
export const TAB_ROOT_TYPE = "tab-root";

// data-spath 속성·트리 행 id용 직렬화: "s|0.1"(screen [0,1]) / "t:chat|2"(chat 탭 [2]).
// 루트는 경로부가 빈 문자열("s|"). CSS 속성 선택자는 값을 따옴표로 감싸므로 '|'·':'가
// 들어가도 안전하다(T2.3에서 selKey로 사용).
export function spathId(sp: ScopedPath): string {
  const scope = sp.scope.kind === "screen" ? "s" : `t:${sp.scope.tabId}`;
  return `${scope}|${sp.path.join(".")}`;
}

// spathId의 역파싱 — 왕복 보장. TabSchema는 id의 내용 문자를 제한하지 않으므로(길이만
// 1..32) tabId에 '|'가 포함될 수 있다. 경로부는 숫자와 '.'만 갖기에 마지막 '|'를
// 구분자로 삼으면 모호성이 없다. 형식 위반은 null(호출부 무시 — no-throw).
export function parseSpathId(s: string): ScopedPath | null {
  const sep = s.lastIndexOf("|");
  if (sep < 0) return null;
  const scopePart = s.slice(0, sep);
  const pathPart = s.slice(sep + 1);
  let scope: EditScope;
  if (scopePart === "s") {
    scope = { kind: "screen" };
  } else if (scopePart.startsWith("t:") && scopePart.length > 2) {
    scope = { kind: "tab", tabId: scopePart.slice(2) };
  } else {
    return null;
  }
  if (pathPart === "") return { scope, path: [] };
  const path: BlockPath = [];
  for (const seg of pathPart.split(".")) {
    if (!/^\d+$/.test(seg)) return null; // 음수·공백·비숫자 성분 거부
    path.push(Number(seg));
  }
  return { scope, path };
}

// 스코프의 편집 루트를 얻는다.
// - screen: l.screen ?? fallbackScreen(발행 screen 부재 시 기본 화면 — 호출부가 주입).
// - tab: 해당 탭 content를 가상 tab-root로 감싼 Block. 탭 부재 시 null(호출부 no-op).
// children은 content 배열을 참조 공유한다 — editOps가 불변 연산이므로 안전하다.
export function getScopeRoot(l: Layout, scope: EditScope, fallbackScreen: Block): Block | null {
  if (scope.kind === "screen") return l.screen ?? fallbackScreen;
  const tab = l.tabs?.find((t) => t.id === scope.tabId);
  if (!tab) return null;
  return { type: TAB_ROOT_TYPE, children: tab.content ?? [] };
}

// 편집된 루트를 레이아웃에 되쓴다(새 레이아웃 반환, 비변경부 참조 공유).
// - screen: screen 필드 교체.
// - tab: 해당 탭의 content = nextRoot.children. 가상 tab-root 노드 자체는 여기서
//   버려지므로 발행본에 절대 저장되지 않는다(구조적 보장). 탭 부재 시 원본 그대로.
export function writeScopeRoot(l: Layout, scope: EditScope, nextRoot: Block): Layout {
  if (scope.kind === "screen") return { ...l, screen: nextRoot };
  const tabs = l.tabs;
  if (!tabs) return l;
  const i = tabs.findIndex((t) => t.id === scope.tabId);
  if (i < 0) return l;
  const nextTabs = [...tabs];
  nextTabs[i] = { ...tabs[i], content: nextRoot.children ?? [] };
  return { ...l, tabs: nextTabs };
}

// 편집기 표시명: props.name(문자열·trim 후 비면 무시·40자 클램프) → def.label[lang]
// → node.type. props.name은 표시 메타일 뿐 렌더 동작에 관여하지 않는다(React 이스케이프
// 렌더 전제 — innerHTML 경로 없음).
export function displayName(node: Block, def: BlockDef | undefined, lang: "ko" | "en"): string {
  const raw = node.props?.name;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed) return trimmed.slice(0, 40);
  }
  return def?.label[lang] ?? node.type;
}
