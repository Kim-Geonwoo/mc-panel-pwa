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
//
// 파일 구성: 메뉴(ContextMenu)와 2단 폼 패널(ContextMenuPanel — 피드백 6, 메뉴 항목
// 실행 후 같은 앵커에 여는 스타일·이름 편집 폼)이 배치·닫기 세트·포커스 복원 훅을
// 공유한다 — 규율(외부클릭·Escape·포커스 복원)이 두 단계에서 동일하게 유지된다.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../lib/i18n";
import {
  placeMenu,
  nextItemIndex,
  edgeItemIndex,
  type ContextMenuItem,
} from "../../lib/builder/contextMenu";

export type { ContextMenuItem, ContextMenuAction } from "../../lib/builder/contextMenu";

type AnchorRect = { left: number; bottom: number } | null;

export interface ContextMenuProps {
  x: number; // 열림 좌표(clientX). Shift+F10 등 키보드 열림으로 (0,0)이면 anchorRect로 폴백
  y: number; // 열림 좌표(clientY)
  items: ContextMenuItem[];
  onClose: () => void; // 닫힘 통지 — 부모가 상태를 지워 unmount한다(컴포넌트는 상태 무소유)
  // 키보드 열림(좌표 0,0) 시 배치 기준이 되는 선택 요소의 rect(좌하단에 붙인다).
  anchorRect?: AnchorRect;
}

// ── 메뉴·패널 공용 훅 ──────────────────────────────────────────────────────────

// 닫힐 때 포커스를 되돌릴 요소를 열림 시점(첫 layout effect — 메뉴가 포커스를 가져가기
// 전)에 저장해 두고, restore=true(키보드 닫힘·항목 실행)에서만 복원하는 close를 만든다.
// 바깥 클릭·스크롤 등 포인터 유발 닫힘은 복원하지 않는다(사용자가 옮긴 포커스를 빼앗지
// 않도록). onClose 최신값은 ref로 유지 — 반환 close가 재생성 없이 안정적이다.
function useCloseWithFocusReturn(onClose: () => void): (restore: boolean) => void {
  const invokerRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    invokerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, []);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  return useCallback((restore: boolean) => {
    const inv = invokerRef.current;
    if (restore && inv && inv.isConnected) inv.focus({ preventScroll: true });
    onCloseRef.current();
  }, []);
}

// 실측 후 배치 — clientX/Y 기준이므로 fixed 좌표에 그대로 쓴다. 키보드 열림((0,0))은
// 선택 요소 rect의 좌하단을 기준점으로 폴백한다.
function usePlacement(
  ref: RefObject<HTMLDivElement | null>,
  x: number,
  y: number,
  anchorRect: AnchorRect | undefined,
): { left: number; top: number } {
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const kb = x === 0 && y === 0 && anchorRect ? anchorRect : null;
    const r = el.getBoundingClientRect();
    setPos(placeMenu(kb ? kb.left : x, kb ? kb.bottom : y, r.width, r.height, window.innerWidth, window.innerHeight));
  }, [ref, x, y, anchorRect]);
  return pos;
}

// 닫기 세트 — 전부 document/window 네이티브 리스너. pointerdown·scroll·contextmenu는
// capture로 잡아 내부 컨테이너의 stopPropagation·비버블 스크롤에도 닫힘이 누락되지
// 않게 한다. 메뉴/패널 내부에서 시작한 이벤트는 제외(여기서 닫으면 항목 click·폼
// 조작이 소실된다).
function useDismissListeners(ref: RefObject<HTMLDivElement | null>, close: (restore: boolean) => void) {
  useEffect(() => {
    const inside = (e: Event) => !!(e.target instanceof Node && ref.current?.contains(e.target));
    const onPointerDown = (e: Event) => {
      if (!inside(e)) close(false);
    };
    const onContextMenu = (e: Event) => {
      // 내부 우클릭은 브라우저 기본 메뉴만 막고 유지, 다른 곳 우클릭은 닫는다
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
  }, [ref, close]);
}

export default function ContextMenu({ x, y, items, onClose, anchorRect }: ContextMenuProps) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // roving tabindex의 활성 인덱스 — 활성 항목만 tabIndex=0, 포커스는 이펙트가 따라간다.
  const [active, setActive] = useState(() => edgeItemIndex(items, "first"));

  const close = useCloseWithFocusReturn(onClose);
  const pos = usePlacement(menuRef, x, y, anchorRect);
  useDismissListeners(menuRef, close);

  // 실행 — disabled는 포커스만 허용하고 실행은 차단(APG). 포커스 복원을 먼저 하고
  // onRun을 나중에 호출한다: 포커스를 옮기는 명령(예: 2단 스타일 패널 열기)이 최종 승자.
  const run = useCallback(
    (idx: number) => {
      const item = items[idx];
      if (!item || item === "separator" || item.disabled) return;
      close(true);
      item.onRun();
    },
    [items, close],
  );

  // 활성 항목으로 포커스 이동(열림 직후 첫 항목 포함). preventScroll — 포커스 유발
  // 스크롤이 닫기 세트의 scroll 리스너를 오발화시키지 않도록.
  useEffect(() => {
    itemRefs.current[active]?.focus({ preventScroll: true });
  }, [active]);

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

// ── 2단 폼 패널(피드백 6 — 우클릭 도구 안의 직접 수정 폼) ───────────────────────
// 메뉴 항목 실행이 메뉴를 닫은 뒤 같은 앵커 좌표에 이 패널을 열어, 스타일·이름 같은
// 폼 편집을 메뉴 자리에서 잇는다(부모가 stage 상태로 전환·소유). 포지셔닝·닫기 세트·
// 포커스 복원 규율은 위 ContextMenu와 동일 훅을 쓴다. 메뉴(role=menu)와 달리 폼
// 컨테이너이므로 role=dialog + Tab 가장자리 순환(경량 트랩)을 쓴다 — roving tabindex는
// 폼 컨트롤(셀렉트·입력)에 부적합하다. children은 render prop — 폼이 "커밋 후 닫기"
// 같은 흐름에서 포커스 복원 포함 close를 직접 쓸 수 있게 한다.
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function ContextMenuPanel({
  x,
  y,
  anchorRect,
  label,
  onClose,
  children,
}: {
  x: number;
  y: number;
  anchorRect?: AnchorRect;
  label: string; // 패널 제목 겸 aria-label(호출부가 i18n 문자열을 넘긴다)
  onClose: () => void;
  children: (close: (restore: boolean) => void) => ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCloseWithFocusReturn(onClose);
  const pos = usePlacement(panelRef, x, y, anchorRect);
  useDismissListeners(panelRef, close);

  // 열릴 때 첫 폼 컨트롤로 포커스(없으면 패널 자신 — tabIndex=-1). preventScroll은
  // 닫기 세트의 scroll 리스너 오발화 방지(메뉴의 항목 포커스와 동일).
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? el).focus({ preventScroll: true });
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // 상위(모달 등)의 Escape 처리로 번지지 않게(메뉴와 동일)
      close(true);
      return;
    }
    if (e.key !== "Tab") return;
    // 경량 포커스 순환 — 패널이 열린 채 Tab이 뒤 문서로 새어 나가지 않게 가장자리에서
    // 반대편으로 감는다(내부 이동은 브라우저 기본에 맡긴다).
    const els = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (els.length === 0) {
      e.preventDefault();
      return;
    }
    const first = els[0];
    const last = els[els.length - 1];
    const cur = document.activeElement;
    if (!e.shiftKey && cur === last) {
      e.preventDefault();
      first.focus({ preventScroll: true });
    } else if (e.shiftKey && (cur === first || cur === panelRef.current)) {
      e.preventDefault();
      last.focus({ preventScroll: true });
    }
  };

  if (typeof document === "undefined") return null; // SSR 가드 — 포털 대상 없음

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={{ left: pos.left, top: pos.top }}
      // 내용이 길어도(스타일 폼) 뷰포트를 넘지 않게 내부 스크롤 — 내부 scroll 이벤트는
      // 닫기 세트의 inside 판정으로 제외된다.
      className="fixed z-50 max-h-[70vh] w-[248px] overflow-y-auto rounded-xl border border-line bg-card p-2 shadow-card outline-none"
    >
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      {children(close)}
    </div>,
    document.body,
  );
}
