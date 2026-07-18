import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, fireEvent, screen as rtl, within } from "@testing-library/react";
import { LangProvider } from "../../lib/i18n";
import type { Layout } from "../../lib/builder/schema";
import StudioApp from "./StudioApp";

// StudioApp은 실제 캔버스(PanelProvider+블록 폴링)를 통째로 마운트한다 — Canvas.test와
// 같은 방식으로 네트워크 계층만 영원히 대기하는 목으로 바꿔 폴링을 무해화한다.
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  const pending = () => new Promise<never>(() => {});
  return {
    ...actual,
    fetchStatus: vi.fn(pending),
    getMe: vi.fn(pending),
    fetchChat: vi.fn(pending),
    fetchChatBefore: vi.fn(pending),
    fetchPerf: vi.fn(pending),
    fetchTimeline: vi.fn(pending),
    sendChat: vi.fn(pending),
    putLayout: vi.fn(pending),
  };
});

beforeAll(() => {
  // jsdom에는 Element.scrollTo가 없다 — ChatFeed의 스크롤 고정이 던지지 않게 심을 둔다.
  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = () => {};
  }
  // jsdom에는 Range.getBoundingClientRect도 없다 — 선택 표시선(SelectionOutline)과
  // Shift+F10 앵커 측정이 쓰는 API라 0-rect 심을 둔다(위치 값 자체는 검증 대상 아님).
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = () =>
      ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0, toJSON: () => ({}) }) as DOMRect;
  }
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("panel-lang", "ko");
});

// 화면 트리: text([0]) / vstack([1], 자식 text) / logo([2] — noStyle 대상).
const initial: Layout = {
  version: 1,
  screen: {
    type: "vstack",
    props: { key: "root" },
    children: [
      { type: "text", props: { key: "t1", ko: "인사말" } },
      { type: "vstack", props: { key: "v1" }, children: [{ type: "text", props: { key: "t2", ko: "안쪽" } }] },
      { type: "logo", props: { key: "l1" } },
    ],
  },
  tabs: [{ id: "chat", label: { ko: "채팅", en: "Chat" } }],
};

function drawApp() {
  return render(
    <LangProvider>
      <StudioApp initial={initial} onNeedLogin={() => {}} />
    </LangProvider>,
  );
}

const item = (name: string) => rtl.getByRole("menuitem", { name });

describe("StudioApp (T6.3 — 우클릭 컨텍스트 메뉴 배선)", () => {
  it("캔버스 우클릭: 브라우저 메뉴를 막고 선택을 대상으로 교체한 뒤 메뉴를 연다", () => {
    const { container } = drawApp();
    const notCanceled = fireEvent.contextMenu(rtl.getByText("인사말"), { clientX: 33, clientY: 44 });
    expect(notCanceled).toBe(false);
    expect(rtl.getByRole("menu")).toBeInTheDocument();
    // 선택 교체 — 트리의 해당 행이 선택 표시(border-accent)로 바뀐다.
    expect(container.querySelector('[data-treerow="s|0"]')!.className).toContain("border-accent");
  });

  it("복제: 대상의 사본이 바로 뒤 형제로 삽입된다", () => {
    drawApp();
    fireEvent.contextMenu(rtl.getByText("인사말"));
    fireEvent.click(item("복제"));
    expect(rtl.getAllByText("인사말")).toHaveLength(2);
    expect(rtl.queryByRole("menu")).toBeNull(); // 실행 후 닫힘
  });

  it("삭제: danger 항목으로 대상이 제거된다", () => {
    drawApp();
    fireEvent.contextMenu(rtl.getByText("인사말"));
    fireEvent.click(item("삭제"));
    expect(rtl.queryByText("인사말")).toBeNull();
  });

  it("루트: 복제·삭제·감싸기·이름 변경은 disabled, 스타일은 활성", () => {
    const { container } = drawApp();
    fireEvent.contextMenu(container.querySelector('[data-spath="s|"]')!);
    expect(item("복제")).toHaveAttribute("aria-disabled", "true");
    expect(item("삭제")).toHaveAttribute("aria-disabled", "true");
    expect(item("세로로 감싸기")).toHaveAttribute("aria-disabled", "true");
    expect(item("이름 변경…")).toHaveAttribute("aria-disabled", "true");
    expect(item("스타일…")).not.toHaveAttribute("aria-disabled"); // 루트(vstack)는 스타일 가능
  });

  it("감싸기: 대상이 새 vstack 안으로 한 단계 내려간다", () => {
    const { container } = drawApp();
    fireEvent.contextMenu(rtl.getByText("인사말"));
    fireEvent.click(item("세로로 감싸기"));
    expect(container.querySelector('[data-spath="s|0.0"]')?.textContent).toContain("인사말");
  });

  it("풀기: layout 컨테이너에서만 활성이고 children이 제자리 승격된다", () => {
    const { container } = drawApp();
    fireEvent.contextMenu(rtl.getByText("인사말")); // element 대상 — 비활성
    expect(item("풀기")).toHaveAttribute("aria-disabled", "true");
    fireEvent.contextMenu(container.querySelector('[data-spath="s|1"]')!); // vstack 대상
    fireEvent.click(item("풀기"));
    expect(container.querySelector('[data-spath="s|1"]')?.textContent).toContain("안쪽"); // 승격
    expect(container.querySelector('[data-spath="s|1.0"]')).toBeNull(); // 컨테이너 제거
  });

  it("위로/아래로 이동: 형제 스왑과 경계 비활성화", () => {
    const { container } = drawApp();
    fireEvent.contextMenu(rtl.getByText("인사말")); // 첫 형제 — 위로 이동 불가
    expect(item("위로 이동")).toHaveAttribute("aria-disabled", "true");
    expect(item("아래로 이동")).not.toHaveAttribute("aria-disabled");
    fireEvent.contextMenu(container.querySelector('[data-spath="s|1"]')!);
    fireEvent.click(item("위로 이동"));
    expect(container.querySelector('[data-spath="s|0"]')?.textContent).toContain("안쪽");
  });

  it("스타일: 메뉴 자리의 2단 패널에서 직접 커밋되고 패널은 유지된다(피드백 6)", () => {
    const { container } = drawApp();
    fireEvent.contextMenu(rtl.getByText("인사말"));
    fireEvent.click(item("스타일…"));
    expect(rtl.queryByRole("menu")).toBeNull(); // 메뉴 → 패널 전환
    const dialog = rtl.getByRole("dialog", { name: "스타일 편집" });
    // 인스펙터에도 같은 라벨의 StyleFields가 있으므로 패널 범위로 한정해 조작한다.
    fireEvent.change(within(dialog).getByLabelText("바깥 여백"), { target: { value: "8" } });
    expect(container.querySelector(".m-8")).not.toBeNull(); // 캔버스 블록에 즉시 반영
    expect(rtl.getByRole("dialog", { name: "스타일 편집" })).toBeInTheDocument(); // 연속 커밋 유지
  });

  it("스타일: noStyle 블록(logo)은 항목이 disabled", () => {
    const { container } = drawApp();
    fireEvent.contextMenu(container.querySelector('[data-spath="s|2"]')!);
    expect(item("스타일…")).toHaveAttribute("aria-disabled", "true");
  });

  it("이름 변경: 2단 입력 패널에서 Enter로 커밋한다(트리 인라인과 같은 규칙)", () => {
    const { container } = drawApp();
    fireEvent.contextMenu(rtl.getByText("인사말"));
    fireEvent.click(item("이름 변경…"));
    const dialog = rtl.getByRole("dialog", { name: "이름 변경" });
    const input = within(dialog).getByRole("textbox");
    fireEvent.change(input, { target: { value: "환영 문구" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(rtl.queryByRole("dialog")).toBeNull();
    // 트리 행 표시명 갱신(인스펙터 헤더에도 같은 이름이 떠서 행 요소로 한정한다)
    expect(container.querySelector('[data-treerow="s|0"]')!.textContent).toContain("환영 문구");
  });

  it("이름 변경: Escape는 커밋 없이 닫는다", () => {
    drawApp();
    fireEvent.contextMenu(rtl.getByText("인사말"));
    fireEvent.click(item("이름 변경…"));
    const input = within(rtl.getByRole("dialog")).getByRole("textbox");
    fireEvent.change(input, { target: { value: "임시" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(rtl.queryByRole("dialog")).toBeNull();
    expect(rtl.queryByText("임시")).toBeNull();
  });

  it("Shift+F10: 선택된 대상 기준으로 키보드 열림(anchorRect 폴백)", () => {
    drawApp();
    fireEvent.click(rtl.getByText("인사말")); // 캔버스 클릭 선택
    fireEvent.keyDown(window, { key: "F10", shiftKey: true });
    expect(rtl.getByRole("menu")).toBeInTheDocument();
    expect(item("복제")).not.toHaveAttribute("aria-disabled");
  });

  it("트리 행 우클릭도 같은 메뉴를 연다(선택 교체 포함)", () => {
    const { container } = drawApp();
    fireEvent.contextMenu(container.querySelector('[data-treerow="s|0"]')!, { clientX: 5, clientY: 6 });
    expect(rtl.getByRole("menu")).toBeInTheDocument();
    expect(container.querySelector('[data-treerow="s|0"]')!.className).toContain("border-accent");
  });

  it("유령 탭 행 우클릭은 메뉴를 열지 않는다(물질화는 편집 시작 버튼 경로)", () => {
    const { container } = drawApp();
    const aside = container.querySelector("aside")!; // 좌측 패널(트리) — chat 유령 섹션 보유
    fireEvent.contextMenu(aside.querySelector(".border-dashed")!);
    expect(rtl.queryByRole("menu")).toBeNull();
  });
});
