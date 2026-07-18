import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { LangProvider } from "../lib/i18n";
import SettingsSheet, { SETTINGS_SECTION_IDS, type SettingsSectionId } from "./SettingsSheet";

// 네트워크 목 — 시트는 섹션 구성과 무관하게 마운트 시 fetchPushConfig를 부른다(훅은
// 무조건 실행되는 설계). 결정적 응답으로 고정해 렌더를 안정화한다. 변이 API는 이
// 테스트에서 호출되지 않지만 실수로 새어 나가지 않게 no-op으로 함께 봉인한다.
vi.mock("../lib/api", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../lib/api")>();
  return {
    ...orig,
    fetchPushConfig: async () => ({ key: "", events: [] }),
    logout: async () => {},
    setNickname: async () => {},
    subscribePush: async () => {},
    unsubscribePush: async () => {},
  };
});

// jsdom 브라우저 언어는 en-US — 저장된 선택을 ko로 고정해 문구 단언을 한국어 기준으로.
beforeEach(() => localStorage.setItem("panel-lang", "ko"));

// 마운트 이펙트의 비동기 setState(fetchPushConfig 응답)를 act 안에서 흘려보낸다.
const flush = () => act(async () => {});

// sections 인자만 바꿔 렌더하는 헬퍼. 타입은 일부러 느슨하게 받아(무효값 케이스)
// 신뢰불가 JSON 방어 경로도 그대로 검증한다.
async function draw(sections?: readonly SettingsSectionId[]) {
  const rtl = render(
    <LangProvider>
      <SettingsSheet
        nick="tester"
        onNickChanged={() => {}}
        tabPrefs={{ perf: true, timeline: true }}
        onTabPrefs={() => {}}
        onLogout={() => {}}
        onClose={() => {}}
        sections={sections}
      />
    </LangProvider>,
  );
  await flush();
  return rtl;
}

// 표시 중인 섹션 제목(h3)들을 순서대로 수집한다. 로그아웃 섹션은 제목이 없어
// "로그아웃" 버튼 존재로 따로 확인한다.
function headings(): string[] {
  return screen.queryAllByRole("heading", { level: 3 }).map((h) => h.textContent ?? "");
}

describe("SettingsSheet — sections props(T5.2)", () => {
  it("부재 시 전체: 현행 5개 섹션이 현행 순서로 렌더된다", async () => {
    const { container } = await draw();
    expect(headings()).toEqual(["알림", "탭 표시", "언어", "닉네임 변경"]);
    const sections = container.querySelectorAll("section");
    expect(sections).toHaveLength(5);
    // ⑤ 로그아웃은 제목 없는 마지막 섹션 — 버튼으로 확인
    expect(sections[4].querySelector("button")).toHaveTextContent("로그아웃");
  });

  it("부재와 전체 명시가 문자 그대로 같은 마크업을 낸다(회귀 0 근거)", async () => {
    // 오버레이·다이얼로그 래퍼는 framer-motion의 진행 중 인라인 스타일(opacity 등)이
    // 렌더 시점마다 달라 비교 대상에서 제외하고, 애니메이션 없는 내용부만 비교한다.
    const dialogHTML = (c: HTMLElement) => c.querySelector('[role="dialog"]')!.innerHTML;
    const a = await draw();
    const absent = dialogHTML(a.container);
    a.unmount();
    const b = await draw([...SETTINGS_SECTION_IDS]);
    expect(dialogHTML(b.container)).toBe(absent);
  });

  it("부분집합이면 지정한 섹션만 렌더된다", async () => {
    const { container } = await draw(["push", "logout"]);
    expect(headings()).toEqual(["알림"]);
    expect(container.querySelectorAll("section")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
    expect(screen.queryByText("탭 표시")).toBeNull();
    expect(screen.queryByText("언어")).toBeNull();
    expect(screen.queryByText("닉네임 변경")).toBeNull();
  });

  it("전달한 순서를 그대로 따른다(순서 편집 후속 대비 — 렌더는 이미 순서 보존)", async () => {
    await draw(["nick", "push"]);
    expect(headings()).toEqual(["닉네임 변경", "알림"]);
  });

  it("중복 id는 1회만 렌더된다", async () => {
    const { container } = await draw(["logout", "logout", "logout"]);
    expect(container.querySelectorAll("section")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "로그아웃" })).toHaveLength(1);
  });

  it("빈 배열·전부 무효는 전체로 폴백한다(빈 선택 상태는 규약상 없음)", async () => {
    const empty = await draw([]);
    expect(empty.container.querySelectorAll("section")).toHaveLength(5);
    empty.unmount();
    // 타입 밖 무효 id(신뢰불가 JSON) — 걸러진 뒤 비면 전체
    const junk = await draw(["ghost", "hack"] as unknown as SettingsSectionId[]);
    expect(junk.container.querySelectorAll("section")).toHaveLength(5);
  });

  it("무효 id가 섞이면 유효한 것만 남긴다", async () => {
    const { container } = await draw(["ghost", "tabs"] as unknown as SettingsSectionId[]);
    expect(headings()).toEqual(["탭 표시"]);
    expect(container.querySelectorAll("section")).toHaveLength(1);
  });
});
