import { describe, it, expect } from "vitest";
import type { Block, Layout } from "./schema";
import { insertAt, removeAt } from "./editOps";
import { REGISTRY } from "./registry";
import {
  TAB_ROOT_TYPE,
  spathId,
  parseSpathId,
  getScopeRoot,
  writeScopeRoot,
  displayName,
  type EditScope,
  type ScopedPath,
} from "./studioScope";

// 고정 레이아웃 — screen과 tabs(content 있음/없음/비활성)를 모두 가진 형태.
const screen = (): Block => ({
  type: "vstack",
  children: [{ type: "logo" }, { type: "tab-content" }],
});
const layout = (): Layout => ({
  version: 1,
  theme: { accent: "#15a34a" },
  tabs: [
    { id: "chat", label: { ko: "채팅", en: "Chat" }, content: [{ type: "chat-feed", props: { key: "cf" } }] },
    { id: "info", label: { ko: "정보", en: "Info" } }, // content 없음
  ],
  screen: screen(),
});
const fallback = (): Block => ({ type: "vstack", children: [] });

describe("spathId", () => {
  it("screen 스코프를 's|<path>' 형태로 직렬화한다", () => {
    expect(spathId({ scope: { kind: "screen" }, path: [0, 1] })).toBe("s|0.1");
  });

  it("tab 스코프를 't:<tabId>|<path>' 형태로 직렬화한다", () => {
    expect(spathId({ scope: { kind: "tab", tabId: "chat" }, path: [2] })).toBe("t:chat|2");
  });

  it("빈 path는 경로부가 빈 문자열이다(루트 표현)", () => {
    expect(spathId({ scope: { kind: "screen" }, path: [] })).toBe("s|");
    expect(spathId({ scope: { kind: "tab", tabId: "chat" }, path: [] })).toBe("t:chat|");
  });
});

describe("parseSpathId", () => {
  it("spathId 왕복이 보장된다(빈 path·깊은 path 포함)", () => {
    const cases: ScopedPath[] = [
      { scope: { kind: "screen" }, path: [] },
      { scope: { kind: "screen" }, path: [0] },
      { scope: { kind: "screen" }, path: [3, 0, 12, 7] },
      { scope: { kind: "tab", tabId: "chat" }, path: [] },
      { scope: { kind: "tab", tabId: "perf" }, path: [1, 2] },
    ];
    for (const sp of cases) expect(parseSpathId(spathId(sp))).toEqual(sp);
  });

  it("특수문자 포함 32자 tabId도 왕복된다(스키마 id 상한 경계)", () => {
    // TabSchema는 id 내용 문자를 제한하지 않는다 — 구분자 후보('|' ':' '.')를 모두 포함.
    const tabId = "a|b:c.d 한글!@#$%^&*()[]{}<>?/\\=+-".slice(0, 32);
    expect(tabId.length).toBe(32);
    const sp: ScopedPath = { scope: { kind: "tab", tabId }, path: [0, 5] };
    expect(parseSpathId(spathId(sp))).toEqual(sp);
  });

  it("무효 입력은 null이다", () => {
    for (const bad of ["", "garbage", "x|0", "t:|0", "s", "t:chat", "s|a.b", "s|-1", "s|1..2", "s|1.", "|0"]) {
      expect(parseSpathId(bad), `input=${JSON.stringify(bad)}`).toBeNull();
    }
  });
});

describe("getScopeRoot", () => {
  it("screen 스코프: l.screen을 반환하고, 부재 시 fallback을 반환한다", () => {
    const l = layout();
    expect(getScopeRoot(l, { kind: "screen" }, fallback())).toBe(l.screen);
    const noScreen: Layout = { version: 1 };
    const fb = fallback();
    expect(getScopeRoot(noScreen, { kind: "screen" }, fb)).toBe(fb);
  });

  it("tab 스코프: content를 가상 tab-root로 감싼다", () => {
    const l = layout();
    const root = getScopeRoot(l, { kind: "tab", tabId: "chat" }, fallback());
    expect(root).toEqual({ type: TAB_ROOT_TYPE, children: l.tabs![0].content });
  });

  it("tab 스코프: content 부재 탭은 빈 children으로 감싼다", () => {
    const root = getScopeRoot(layout(), { kind: "tab", tabId: "info" }, fallback());
    expect(root).toEqual({ type: TAB_ROOT_TYPE, children: [] });
  });

  it("tab 스코프: 탭 부재(미지 id·tabs 없음)면 null이다", () => {
    expect(getScopeRoot(layout(), { kind: "tab", tabId: "nope" }, fallback())).toBeNull();
    expect(getScopeRoot({ version: 1 }, { kind: "tab", tabId: "chat" }, fallback())).toBeNull();
  });

  it("입력 레이아웃을 변형하지 않는다", () => {
    const l = layout();
    const snapshot = JSON.parse(JSON.stringify(l));
    getScopeRoot(l, { kind: "tab", tabId: "chat" }, fallback());
    getScopeRoot(l, { kind: "screen" }, fallback());
    expect(l).toEqual(snapshot);
  });
});

describe("writeScopeRoot", () => {
  it("screen 스코프: screen만 교체한 새 레이아웃을 반환한다(원본 불변)", () => {
    const l = layout();
    const snapshot = JSON.parse(JSON.stringify(l));
    const nextRoot: Block = { type: "vstack", children: [{ type: "logo" }] };
    const out = writeScopeRoot(l, { kind: "screen" }, nextRoot);
    expect(out.screen).toBe(nextRoot);
    expect(out.tabs).toBe(l.tabs); // 비변경부 참조 공유
    expect(out.theme).toBe(l.theme);
    expect(l).toEqual(snapshot);
  });

  it("tab 스코프: 해당 탭 content만 children으로 교체한다(다른 탭·필드 참조 공유)", () => {
    const l = layout();
    const kids: Block[] = [{ type: "text", props: { ko: "hi" } }];
    const out = writeScopeRoot(l, { kind: "tab", tabId: "chat" }, { type: TAB_ROOT_TYPE, children: kids });
    expect(out.tabs![0].content).toBe(kids);
    expect(out.tabs![0].id).toBe("chat");
    expect(out.tabs![0].label).toEqual({ ko: "채팅", en: "Chat" });
    expect(out.tabs![1]).toBe(l.tabs![1]); // 다른 탭은 참조 공유
    expect(out.screen).toBe(l.screen);
  });

  it("가상 tab-root는 결과 레이아웃 어디에도 유입되지 않는다", () => {
    const l = layout();
    const root = getScopeRoot(l, { kind: "tab", tabId: "chat" }, fallback())!;
    const out = writeScopeRoot(l, { kind: "tab", tabId: "chat" }, root);
    expect(JSON.stringify(out)).not.toContain(TAB_ROOT_TYPE);
  });

  it("nextRoot.children 부재 시 content는 빈 배열이 된다", () => {
    const out = writeScopeRoot(layout(), { kind: "tab", tabId: "chat" }, { type: TAB_ROOT_TYPE });
    expect(out.tabs![0].content).toEqual([]);
  });

  it("탭 부재(미지 id·tabs 없음)면 원본 레이아웃을 그대로 반환한다(no-throw)", () => {
    const l = layout();
    expect(writeScopeRoot(l, { kind: "tab", tabId: "nope" }, { type: TAB_ROOT_TYPE, children: [] })).toBe(l);
    const noTabs: Layout = { version: 1 };
    expect(writeScopeRoot(noTabs, { kind: "tab", tabId: "chat" }, { type: TAB_ROOT_TYPE, children: [] })).toBe(noTabs);
  });

  it("editOps 왕복: getScopeRoot → insertAt/removeAt → writeScopeRoot로 탭 content가 편집된다", () => {
    const l = layout();
    const scope: EditScope = { kind: "tab", tabId: "chat" };
    const root = getScopeRoot(l, scope, fallback())!;
    // 삽입: tab-root의 children[1]에 text 추가 → content 2개
    const added = writeScopeRoot(l, scope, insertAt(root, [], 1, { type: "text" }));
    expect(added.tabs![0].content!.map((b) => b.type)).toEqual(["chat-feed", "text"]);
    // 제거: 다시 읽어 children[0](chat-feed) 제거 → text만 남음
    const root2 = getScopeRoot(added, scope, fallback())!;
    const removed = writeScopeRoot(added, scope, removeAt(root2, [0]));
    expect(removed.tabs![0].content!.map((b) => b.type)).toEqual(["text"]);
    // 원본 불변 + 가상 루트 미유입
    expect(l.tabs![0].content!.map((b) => b.type)).toEqual(["chat-feed"]);
    expect(JSON.stringify(removed)).not.toContain(TAB_ROOT_TYPE);
  });
});

describe("displayName", () => {
  const def = REGISTRY["text"];

  it("props.name(문자열)이 최우선이다", () => {
    expect(displayName({ type: "text", props: { name: "환영 문구" } }, def, "ko")).toBe("환영 문구");
  });

  it("name은 trim되고, 공백뿐이면 무시된다", () => {
    expect(displayName({ type: "text", props: { name: "  제목  " } }, def, "ko")).toBe("제목");
    expect(displayName({ type: "text", props: { name: "   " } }, def, "ko")).toBe("텍스트");
  });

  it("name은 40자로 클램프된다", () => {
    const long = "a".repeat(50);
    expect(displayName({ type: "text", props: { name: long } }, def, "en")).toBe("a".repeat(40));
  });

  it("비문자열 name은 무시된다", () => {
    expect(displayName({ type: "text", props: { name: 42 } }, def, "en")).toBe("Text");
  });

  it("name 부재 시 def.label[lang], def 부재 시 node.type이다", () => {
    expect(displayName({ type: "text" }, def, "ko")).toBe("텍스트");
    expect(displayName({ type: "text" }, def, "en")).toBe("Text");
    expect(displayName({ type: "mystery" }, undefined, "ko")).toBe("mystery");
  });

  it("고정: props.name은 text/logo propsSchema(z.object 기본 strip)를 통과시킨다", () => {
    // props.name은 편집기 표시명 메타 — 렌더 검증에서 미지 키로 strip될 뿐 블록을
    // 폴백시키지 않아야 한다(계획 T2.1의 회귀 고정).
    for (const type of ["text", "logo"] as const) {
      const r = REGISTRY[type].propsSchema!.safeParse({ name: "라벨", key: "k1" });
      expect(r.success, `${type} propsSchema`).toBe(true);
    }
  });
});
