"use client";

// 우클릭 컨텍스트 메뉴 — 외부 의존성 0의 자체 구현. 항목 수가 적어 typeahead·서브메뉴는
// 범위 밖으로 두었다(필요해지면 Radix 등 라이브러리 전환을 검토 — 그 전환점을 여기 명시).
//
// 포지셔닝: createPortal(document.body) + position:fixed + clientX/Y 좌표. 캔버스의
// 스크롤·transform(dnd-kit) 오차를 좌표계 차원에서 회피한다. useLayoutEffect에서 실측한
// 크기로 뷰포트 클램프·플립(placeMenu)하므로 첫 페인트 전에 위치가 확정된다.
//
// 소유권: 열림 상태(좌표·항목)는 부모(StudioApp 싱글턴 1개)가 가진다 — 이 컴포넌트는
// 열려 있는 동안만 마운트되고, 닫을 조건을 감지하면 onClose를 호출할 뿐이다. 좌표가
// 바뀌는 재열림(우클릭 연타)은 부모가 key={`${x},${y}`}로 remount하는 것을 권장한다
// (활성 항목·포커스 초기화). remount 없이 좌표만 바뀌어도 재클램프는 동작한다.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../lib/i18n";
import {
  placeMenu,
  nextItemIndex,
  edgeItemIndex,
  type ContextMenuItem,
} from "../../lib/builder/contextMenu";

export type { ContextMenuItem, ContextMenuAction } from "../../lib/builder/contextMenu";

export interface ContextMenuProps {
  x: number; // 열림 좌표(clientX). Shift+F10 등 키보드 열림으로 (0,0)이면 anchorRect로 폴백
  y: number; // 열림 좌표(clientY)
  items: ContextMenuItem[];
  onClose: () => void; // 닫힘 통지 — 부모가 상태를 지워 unmount한다(컴포넌트는 상태 무소유)
  // 키보드 열림(좌표 0,0) 시 배치 기준이 되는 선택 요소의 rect(좌하단에 붙인다).
  anchorRect?: { left: number; bottom: number } | null;
}

export default function ContextMenu({ x, y, items, onClose, anchorRect }: ContextMenuProps) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // roving tabindex의 활성 인덱스 — 활성 항목만 tabIndex=0, 포커스는 이펙트가 따라간다.
  const [active, setActive] = useState(() => edgeItemIndex(items, "first"));
  const [pos, setPos] = useState({ left: x, top: y });

  // 닫힐 때 포커스를 되돌릴 요소 — 메뉴가 포커스를 가져가기 전(첫 layout effect)에 저장.
  const invokerRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    invokerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, []);

  // onClose 최신값을 ref로 유지 — document 리스너를 재등록 없이 안정적으로 쓰기 위함.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // restore=true(키보드 닫힘·항목 실행)면 열림 시점 포커스를 복원한다. 바깥 클릭·스크롤
  // 등 포인터 유발 닫힘은 복원하지 않는다(사용자가 옮긴 포커스를 빼앗지 않도록).
  const close = useCallback((restore: boolean) => {
    const inv = invokerRef.current;
    if (restore && inv && inv.isConnected) inv.focus({ preventScroll: true });
    onCloseRef.current();
  }, []);

  // 실행 — disabled는 포커스만 허용하고 실행은 차단(APG). 포커스 복원을 먼저 하고
  // onRun을 나중에 호출한다: 포커스를 옮기는 명령(예: 스타일 편집 진입)이 최종 승자.
  const run = useCallback(
    (idx: number) => {
      const item = items[idx];
      if (!item || item === "separator" || item.disabled) return;
      close(true);
      item.onRun();
    },
    [items, close],
  );

  // 실측 후 배치 — clientX/Y 기준이므로 fixed 좌표에 그대로 쓴다. 키보드 열림((0,0))은
  // 선택 요소 rect의 좌하단을 기준점으로 폴백한다.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const kb = x === 0 && y === 0 && anchorRect ? anchorRect : null;
    const r = el.getBoundingClientRect();
    setPos(placeMenu(kb ? kb.left : x, kb ? kb.bottom : y, r.width, r.height, window.innerWidth, window.innerHeight));
  }, [x, y, anchorRect]);

  // 활성 항목으로 포커스 이동(열림 직후 첫 항목 포함). preventScroll — 포커스 유발
  // 스크롤이 아래 scroll 닫기 리스너를 오발화시키지 않도록.
  useEffect(() => {
    itemRefs.current[active]?.focus({ preventScroll: true });
  }, [active]);

  // 닫기 세트 — 전부 document/window 네이티브 리스너. pointerdown·scroll·contextmenu는
  // capture로 잡아 내부 컨테이너의 stopPropagation·비버블 스크롤에도 닫힘이 누락되지
  // 않게 한다. 메뉴 내부에서 시작한 이벤트는 제외(여기서 닫으면 항목 click이 소실된다).
  useEffect(() => {
    const inside = (e: Event) => !!(e.target instanceof Node && menuRef.current?.contains(e.target));
    const onPointerDown = (e: Event) => {
      if (!inside(e)) close(false);
    };
    const onContextMenu = (e: Event) => {
      // 메뉴 위 우클릭은 브라우저 기본 메뉴만 막고 유지, 다른 곳 우클릭은 닫는다
      // (포인터 우클릭은 위 pointerdown이 먼저 닫고, 키보드 유발 contextmenu를 여기서 잡는다).
      if (inside(e)) e.preventDefault();
      else close(false);
    };
    const onScroll = (e: Event) => {
      if (!inside(e)) close(false);
    };
    const onResize = () => close(false);
    const onWinBlur = () => close(false);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("contextmenu", onContextMenu, true);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("blur", onWinBlur);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("contextmenu", onContextMenu, true);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("blur", onWinBlur);
    };
  }, [close]);

  // 메뉴 내부 키보드 — 포커스가 항목에 있으므로 컨테이너에서 위임 처리한다.
  const onKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => nextItemIndex(items, i, 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => nextItemIndex(items, i, -1));
        break;
      case "Home":
        e.preventDefault();
        setActive(edgeItemIndex(items, "first"));
        break;
      case "End":
        e.preventDefault();
        setActive(edgeItemIndex(items, "last"));
        break;
      case "Enter":
      case " ":
        // preventDefault — 버튼의 네이티브 click 합성으로 인한 이중 실행을 막는다.
        e.preventDefault();
        run(active);
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation(); // 상위(모달 등)의 Escape 처리로 번지지 않게
        close(true);
        break;
      case "Tab":
        e.preventDefault(); // APG: Tab은 메뉴를 닫는다(포커스 이동 없이 복원)
        close(true);
        break;
    }
  };

  if (typeof document === "undefined") return null; // SSR 가드 — 포털 대상 없음

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={t("studio.menu.aria")}
      onKeyDown={onKeyDown}
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-50 min-w-[168px] rounded-xl border border-line bg-card p-1 shadow-card"
    >
      {items.map((item, i) =>
        item === "separator" ? (
          <div key={`sep-${i}`} role="separator" className="mx-1 my-1 h-px bg-line" />
        ) : (
          <button
            key={item.id}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            type="button"
            role="menuitem"
            tabIndex={i === active ? 0 : -1}
            aria-disabled={item.disabled || undefined}
            aria-keyshortcuts={item.shortcut}
            onClick={() => run(i)}
            onMouseEnter={() => setActive(i)} // 호버 시 roving 포커스도 따라온다(메뉴 관행)
            className={[
              "flex min-h-[28px] w-full items-center gap-2 rounded-lg px-2 text-left text-xs outline-none focus:bg-card2",
              item.danger ? "text-danger" : "text-fg",
              item.disabled ? "opacity-40" : "hover:bg-card2",
            ].join(" ")}
          >
            <span className="flex-1 truncate">{item.label}</span>
            {item.shortcut ? <span className="font-mono text-[10px] text-muted">{item.shortcut}</span> : null}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
