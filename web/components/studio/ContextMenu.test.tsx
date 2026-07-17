import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { LangProvider } from "../../lib/i18n";
import ContextMenu from "./ContextMenu";
import type { ContextMenuItem } from "../../lib/builder/contextMenu";

beforeEach(() => localStorage.setItem("panel-lang", "ko"));

// 부모(StudioApp) 싱글턴 소유 계약의 축약형 — 버튼 클릭으로 열고 onClose로 unmount한다.
// 열기 전에 opener에 포커스를 줘 두면 닫힘 시 포커스 복원을 검증할 수 있다.
function Harness({
  items,
  x = 40,
  y = 40,
  anchorRect,
}: {
  items: ContextMenuItem[];
  x?: number;
  y?: number;
  anchorRect?: { left: number; bottom: number } | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <LangProvider>
      <button data-testid="opener" onClick={() => setOpen(true)}>
        open
      </button>
      {open ? <ContextMenu x={x} y={y} items={items} anchorRect={anchorRect} onClose={() => setOpen(false)} /> : null}
    </LangProvider>
  );
}

const openMenu = () => {
  const opener = screen.getByTestId("opener");
  opener.focus();
  fireEvent.click(opener);
  return opener;
};

// 활성(포커스) 항목에 키를 보낸다 — 실제 사용과 동일하게 메뉴 컨테이너로 버블된다.
const key = (k: string) => fireEvent.keyDown(document.activeElement!, { key: k });

const makeItems = () => {
  const ran: string[] = [];
  const items: ContextMenuItem[] = [
    { id: "dup", label: "복제", shortcut: "Ctrl+D", onRun: () => ran.push("dup") },
    "separator",
    { id: "off", label: "비활성", disabled: true, onRun: () => ran.push("off") },
    { id: "del", label: "삭제", danger: true, onRun: () => ran.push("del") },
  ];
  return { items, ran };
};

describe("ContextMenu", () => {
  it("opens as role=menu at the pointer coordinates and focuses the first item", () => {
    const { items } = makeItems();
    render(<Harness items={items} x={40} y={40} />);
    openMenu();
    const menu = screen.getByRole("menu");
    // jsdom rect는 0×0 — placeMenu가 좌표를 그대로 통과시키는지 확인한다.
    expect(menu).toHaveStyle({ left: "40px", top: "40px" });
    const buttons = screen.getAllByRole("menuitem");
    expect(buttons).toHaveLength(3); // separator는 menuitem이 아니다
    expect(document.activeElement).toBe(buttons[0]);
    expect(buttons[0]).toHaveAttribute("tabindex", "0"); // roving tabindex
    expect(buttons[1]).toHaveAttribute("tabindex", "-1");
    expect(buttons[1]).toHaveAttribute("aria-disabled", "true");
  });

  it("closes on an outside pointerdown but not on one inside the menu", () => {
    const { items } = makeItems();
    render(<Harness items={items} />);
    openMenu();
    fireEvent.pointerDown(screen.getAllByRole("menuitem")[0]); // 내부 — 유지(click 소실 방지)
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.pointerDown(document.body); // 외부 — 닫힘
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape and restores focus to the invoker", () => {
    const { items } = makeItems();
    render(<Harness items={items} />);
    const opener = openMenu();
    key("Escape");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("moves focus with arrows (cyclic, separators skipped, disabled focusable) plus Home/End", () => {
    const { items } = makeItems();
    render(<Harness items={items} />);
    openMenu();
    const [dup, off, del] = screen.getAllByRole("menuitem");
    key("ArrowDown");
    expect(document.activeElement).toBe(off); // separator 스킵 + disabled도 포커스 대상
    key("ArrowDown");
    expect(document.activeElement).toBe(del);
    key("ArrowDown");
    expect(document.activeElement).toBe(dup); // 끝에서 순환
    key("ArrowUp");
    expect(document.activeElement).toBe(del); // 역방향 순환
    key("Home");
    expect(document.activeElement).toBe(dup);
    key("End");
    expect(document.activeElement).toBe(del);
  });

  it("runs the active item on Enter, then closes and restores focus", () => {
    const { items, ran } = makeItems();
    render(<Harness items={items} />);
    const opener = openMenu();
    key("Enter");
    expect(ran).toEqual(["dup"]);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("runs an item on click and closes", () => {
    const { items, ran } = makeItems();
    render(<Harness items={items} />);
    openMenu();
    fireEvent.click(screen.getAllByRole("menuitem")[2]);
    expect(ran).toEqual(["del"]);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("never runs a disabled item (Enter or click) and keeps the menu open", () => {
    const { items, ran } = makeItems();
    render(<Harness items={items} />);
    openMenu();
    key("ArrowDown"); // 비활성 항목으로 포커스 이동
    key("Enter");
    fireEvent.click(screen.getAllByRole("menuitem")[1]);
    expect(ran).toEqual([]);
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("closes on Tab without running anything", () => {
    const { items, ran } = makeItems();
    render(<Harness items={items} />);
    openMenu();
    key("Tab");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(ran).toEqual([]);
  });

  it("closes when a contextmenu fires elsewhere (keyboard-invoked path)", () => {
    const { items } = makeItems();
    render(<Harness items={items} />);
    openMenu();
    fireEvent.contextMenu(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on a captured scroll outside the menu", () => {
    const { items } = makeItems();
    render(<Harness items={items} />);
    openMenu();
    fireEvent.scroll(document);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("falls back to the anchor rect when opened via keyboard at (0,0)", () => {
    const { items } = makeItems();
    render(<Harness items={items} x={0} y={0} anchorRect={{ left: 120, bottom: 200 }} />);
    openMenu();
    expect(screen.getByRole("menu")).toHaveStyle({ left: "120px", top: "200px" });
  });

  it("marks shortcuts with aria-keyshortcuts on the item", () => {
    const { items } = makeItems();
    render(<Harness items={items} />);
    openMenu();
    expect(screen.getAllByRole("menuitem")[0]).toHaveAttribute("aria-keyshortcuts", "Ctrl+D");
  });
});
