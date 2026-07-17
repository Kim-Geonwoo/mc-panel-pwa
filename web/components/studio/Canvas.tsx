"use client";

// 캔버스 — 드래프트 레이아웃을 실제 PanelProvider+BlockRenderer 조합으로 라이브
// 프리뷰한다(블록들이 실제 API를 폴링). 편집 모드에서는 캡처 단계에서 클릭·마우스다운을
// 가로채 내부 버튼/입력의 오작동을 막고 클릭을 "블록 선택"으로 바꾼다.
// 블록 식별은 display:contents 래퍼(data-spath)로 한다 — 박스를 만들지 않으므로
// 실제 레이아웃(플렉스 체인)에 영향이 없고, DOM 조상 체인으로 경로를 역추적할 수 있다.
import { useEffect, useRef, useState } from "react";
import BlockRenderer, { blockKey } from "../../lib/builder/BlockRenderer";
import { canvasThemeStyle } from "../../lib/builder/applyTheme";
import { PanelProvider } from "../../lib/builder/context";
import { REGISTRY } from "../../lib/builder/registry";
import type { Block, Layout } from "../../lib/builder/schema";
import { rowId } from "../../lib/builder/studioTree";
import type { BlockPath } from "../../lib/builder/editOps";

// 노드 하나를 선택 래퍼로 감싼다. 컨테이너는 실제 레지스트리 컴포넌트에 재귀 래핑한
// 자식을 넘기고(BlockRenderer의 디스패치 규칙과 동일), leaf·미지 타입·props 위반은
// BlockRenderer에 그대로 위임해 폴백 동작(무중단)을 재사용한다.
function CanvasNode({ node, path }: { node: Block; path: BlockPath }) {
  const sp = rowId(path);
  const def = Object.hasOwn(REGISTRY, node.type) ? REGISTRY[node.type] : undefined;
  const isLayout =
    def?.kind === "layout" &&
    (!def.propsSchema || def.propsSchema.safeParse(node.props ?? {}).success);
  if (!isLayout) {
    return (
      <div className="contents" data-spath={sp}>
        <BlockRenderer node={node} />
      </div>
    );
  }
  const C = def!.component;
  return (
    <div className="contents" data-spath={sp}>
      <C node={node}>
        {node.children?.map((c, i) => (
          <CanvasNode key={blockKey(c, i)} node={c} path={[...path, i]} />
        ))}
      </C>
    </div>
  );
}

// 선택 표시선 — display:contents 래퍼는 자체 박스가 없으므로 Range로 내용의 합집합
// 사각형을 재고, 캔버스 기준 좌표의 오버레이 박스로 그린다. 라이브 콘텐츠(채팅 폴링
// 등)로 크기가 변하므로 주기적으로 재측정한다.
function SelectionOutline({
  hostRef,
  selKey,
}: {
  hostRef: React.RefObject<HTMLDivElement | null>;
  selKey: string;
}) {
  const [rect, setRect] = useState<{ left: number; top: number; w: number; h: number } | null>(
    null,
  );

  useEffect(() => {
    const update = () => {
      const host = hostRef.current;
      const el = host?.querySelector(`[data-spath="${selKey}"]`);
      if (!host || !el) return setRect(null);
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return setRect(null);
      const hr = host.getBoundingClientRect();
      setRect({ left: r.left - hr.left, top: r.top - hr.top, w: r.width, h: r.height });
    };
    update();
    const iv = setInterval(update, 350);
    const host = hostRef.current;
    window.addEventListener("resize", update);
    // 캔버스 내부 스크롤(채팅 목록 등)도 캡처로 잡아 표시선을 따라가게 한다.
    host?.addEventListener("scroll", update, true);
    return () => {
      clearInterval(iv);
      window.removeEventListener("resize", update);
      host?.removeEventListener("scroll", update, true);
    };
  }, [hostRef, selKey]);

  if (!rect) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-40 rounded border-2 border-accent"
      style={{ left: rect.left - 2, top: rect.top - 2, width: rect.w + 4, height: rect.h + 4 }}
    />
  );
}

export default function StudioCanvas({
  layout,
  screen,
  editing,
  selected,
  onSelect,
  onLogout,
}: {
  layout: Layout;
  screen: Block;
  editing: boolean;
  selected: BlockPath | null;
  onSelect: (p: BlockPath | null) => void;
  onLogout: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  // 클릭 → 가장 가까운 래퍼(data-spath)의 경로로 선택. 캡처 단계에서 전파를 끊어
  // 블록 내부의 onClick(탭 전환·시트 열기 등)이 실행되지 않게 한다.
  const onClickCapture = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = (e.target as Element).closest?.("[data-spath]");
    const sp = el?.getAttribute("data-spath");
    onSelect(sp == null ? null : sp === "" ? [] : sp.split(".").map(Number));
  };

  // 드래프트 테마를 캔버스 범위에만 미리 적용한다(문서 전역 오염 방지) — mode는
  // 프레임 클래스(dark/light — 라이트 강제는 globals.css .light 블록), accent·radius는
  // 스코프 CSS 변수. 기본 테마면 클래스·스타일이 모두 비어 현행 DOM과 동일(회귀 0).
  // 프레임 자체의 rounded-[2rem]은 임의값 클래스라 radius 토큰의 영향을 받지 않는다.
  const themed = canvasThemeStyle(layout.theme);

  return (
    <div ref={hostRef} className="relative">
      <div
        className={[
          "flex h-[780px] w-[390px] flex-col overflow-hidden rounded-[2rem] border border-line bg-bg shadow-card",
          themed.className,
        ]
          .filter(Boolean)
          .join(" ")}
        style={themed.style}
        onClickCapture={editing ? onClickCapture : undefined}
        // mousedown 기본동작 차단 — 편집 모드에서 입력창 포커스·텍스트 선택을 막는다.
        onMouseDownCapture={editing ? (e) => e.preventDefault() : undefined}
        onSubmitCapture={editing ? (e) => e.preventDefault() : undefined}
      >
        <PanelProvider layout={layout} onLogout={onLogout}>
          <CanvasNode node={screen} path={[]} />
        </PanelProvider>
      </div>
      {editing && selected && <SelectionOutline hostRef={hostRef} selKey={rowId(selected)} />}
    </div>
  );
}
