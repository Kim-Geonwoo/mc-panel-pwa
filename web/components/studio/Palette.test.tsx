import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen as rtl, fireEvent } from "@testing-library/react";
import { LangProvider } from "../../lib/i18n";
import Palette from "./Palette";

beforeEach(() => localStorage.setItem("panel-lang", "ko"));

function setup(placed: ReadonlySet<string> = new Set()) {
  const onAdd = vi.fn();
  render(
    <LangProvider>
      <Palette onAdd={onAdd} placed={placed} />
    </LangProvider>,
  );
  return onAdd;
}

describe("Palette (도움말 토글 — T3.3)", () => {
  it("행 클릭으로 블록을 추가한다", () => {
    const onAdd = setup();
    fireEvent.click(rtl.getByRole("button", { name: "세로 스택 블록 추가" }));
    expect(onAdd).toHaveBeenCalledWith("vstack");
  });

  it("? 버튼 클릭으로 설명 노트를 펼치고 다시 닫는다(aria 연결 포함)", () => {
    setup();
    const help = rtl.getByRole("button", { name: "세로 스택 설명" });
    expect(help).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(help);
    expect(help).toHaveAttribute("aria-expanded", "true");
    const note = rtl.getByRole("note");
    expect(note.textContent).toContain("세로로 쌓는");
    expect(help).toHaveAttribute("aria-describedby", note.id);
    fireEvent.click(help);
    expect(rtl.queryByRole("note")).toBeNull();
    expect(help).not.toHaveAttribute("aria-describedby");
  });

  it("설명은 한 번에 하나만 열린다(다른 행을 열면 이전 행은 닫힘)", () => {
    setup();
    fireEvent.click(rtl.getByRole("button", { name: "세로 스택 설명" }));
    fireEvent.click(rtl.getByRole("button", { name: "가로 스택 설명" }));
    const notes = rtl.getAllByRole("note");
    expect(notes).toHaveLength(1);
    expect(notes[0].textContent).toContain("가로로");
  });

  it("배치됨(추가 비활성) 상태에서도 도움말은 열리고, unique 제약 문구를 담는다", () => {
    const onAdd = setup(new Set(["tabbar"]));
    expect(rtl.getByRole("button", { name: "탭바 블록 추가" })).toBeDisabled();
    fireEvent.click(rtl.getByRole("button", { name: "탭바 설명" }));
    expect(rtl.getByRole("note").textContent).toContain("하나만");
    expect(onAdd).not.toHaveBeenCalled();
  });
});
