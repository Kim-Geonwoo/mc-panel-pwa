"use client";

// 캔버스 — 드래프트 레이아웃을 실제 PanelProvider+BlockRenderer 조합으로 라이브
// 프리뷰한다(블록들이 실제 API를 폴링). 편집 모드에서는 캡처 단계에서 클릭·마우스다운을
// 가로채 내부 버튼/입력의 오작동을 막고 클릭을 "블록 선택"으로 바꾼다. 단 Shift+클릭은
// 가로채기를 우회해 실제 인터랙션을 실행한다(T3.1) — 채팅 전송 등 실발신 가능성은
// 캔버스 상단 힌트로 고지한다.
// 블록 식별은 display:contents 래퍼(data-spath=spathId)로 한다 — 박스를 만들지 않으므로
// 실제 레이아웃(플렉스 체인)에 영향이 없고, DOM 조상 체인으로 스코프 경로를 역추적할
// 수 있다. 프리뷰 탭 상태는 StudioApp이 소유하고 tabControl로 주입한다(T2.3) —
// 트리·캔버스의 탭 스코프 선택과 캔버스 프리뷰 탭이 항상 같은 시점을 본다.
import { Fragment, useEffect, useRef, useState } from "react";
import BlockRenderer, { blockKey } from "../../lib/builder/BlockRenderer";
import { canvasThemeStyle } from "../../lib/builder/applyTheme";
import { PanelProvider, usePanel } from "../../lib/builder/context";
import { REGISTRY } from "../../lib/builder/registry";
import type { Block, Layout } from "../../lib/builder/schema";
import { planTabContent } from "../../lib/builder/tabContentPlan";
import { parseSpathId, spathId, type ScopedPath } from "../../lib/builder/studioScope";
import { useI18n } from "../../lib/i18n";

// 노드 하나를 선택 래퍼로 감싼다. sp=null이면 선택 대상이 아니다 — data-spath 없이
// 래퍼 구조만 유지하므로, 같은 블록이 선택 가능/불가 상태를 오가도(탭 활성 전환)
// React 요소 구조가 같아 keepMounted 블록(채팅)의 상태가 보존된다. 컨테이너는 실제
// 레지스트리 컴포넌트에 재귀 래핑한 자식을 넘기고(BlockRenderer의 디스패치 규칙과
// 동일), leaf·미지 타입·props 위반은 BlockRenderer에 그대로 위임해 폴백 동작
// (무중단)을 재사용한다.
function CanvasNode({
  node,
  sp,
  editing,
}: {
  node: Block;
  sp: ScopedPath | null;
  editing: boolean;
}) {
  const spid = sp ? spathId(sp) : undefined;
  // 화면 트리의 tab-content는 특수 경로 — 활성 탭 콘텐츠를 탭 스코프 선택 대상으로
  // 렌더한다(CanvasTabContent). 화면 스코프로 한정하는 이유: 탭 content 안에
  // tab-content가 중첩된 비정상 레이아웃이 와도 아래 BlockRenderer(블록 경계 격리)
  // 경로로 떨어져, 캔버스 전체가 경계 없는 무한 재귀로 죽지 않는다(메인 패널과
  // 같은 격리 동작).
  if (node.type === "tab-content" && sp?.scope.kind === "screen") {
    return (
      <div className="contents" data-spath={spid}>
        <CanvasTabContent editing={editing} />
      </div>
    );
  }
  const def = Object.hasOwn(REGISTRY, node.type) ? REGISTRY[node.type] : undefined;
  const isLayout =
    def?.kind === "layout" &&
    (!def.propsSchema || def.propsSchema.safeParse(node.props ?? {}).success);
  if (!isLayout) {
    return (
      <div className="contents" data-spath={spid}>
        <BlockRenderer node={node} />
      </div>
    );
  }
  const C = def!.component;
  return (
    <div className="contents" data-spath={spid}>
      <C node={node}>
        {node.children?.map((c, i) => (
          <CanvasNode
            key={blockKey(c, i)}
            node={c}
            sp={sp ? { scope: sp.scope, path: [...sp.path, i] } : null}
            editing={editing}
          />
        ))}
      </C>
    </div>
  );
}

// tab-content의 캔버스 대응 — 실사용 경로인 TabContent(불변)와 같은 planTabContent
// 계획을 쓰되, "물질화된(명시 content) 활성 탭"의 블록만 탭 스코프 선택 대상으로
// 래핑한다(data-spath="t:chat|0"). 유령(미물질화) 탭의 기본 콘텐츠는 선택 대상이
// 아니다(T2.2의 함정 차단 정책 — 안내만 표시): 클릭은 바깥 tab-content 래퍼로
// 올라가 화면 스코프의 tab-content 블록이 선택된다. keepMounted 숨김 탭은 sp=null
// 래퍼의 BlockRenderer 경로를 유지한다(채팅 상태 보존 — 숨김은 블록 자신이 한다).
function CanvasTabContent({ editing }: { editing: boolean }) {
  const { t } = useI18n();
  const { layout, tab, visibleTabs } = usePanel();
  const plan = planTabContent(
    visibleTabs,
    tab,
    layout.tabs,
    (ty) => Object.hasOwn(REGISTRY, ty) && REGISTRY[ty].keepMounted === true,
  );
  return (
    <>
      {plan.map((e) => {
        if (!e.mounted) return null;
        // 물질화 판정 — planTabContent의 폴백 조건(content 비면 기본 매핑)과 같은 식.
        const materialized = !!layout.tabs?.find((x) => x.id === e.tabId)?.content?.length;
        const selectable = e.active && materialized;
        return (
          <Fragment key={e.tabId}>
            {e.blocks.map((b, i) => (
              <CanvasNode
                key={blockKey(b, i)}
                node={b}
                sp={selectable ? { scope: { kind: "tab", tabId: e.tabId }, path: [i] } : null}
                editing={editing}
              />
            ))}
            {/* 빈 탭(기본 매핑도 없는 탭) — 편집 모드 한정 점선 플레이스홀더 */}
            {editing && e.active && e.blocks.length === 0 && (
              <div className="m-4 rounded-xl border border-dashed border-line p-4 text-center text-xs text-muted">
                {t("studio.canvas.emptyTab")}
              </div>
            )}
            {/* 유령 탭 안내 — 캔버스 선택 불가, 트리의 "편집 시작"으로 유도 */}
            {editing && e.active && !materialized && e.blocks.length > 0 && (
              <p className="mx-4 my-1 shrink-0 text-center text-[11px] text-muted">
                {t("studio.canvas.ghostTab")}
              </p>
            )}
          </Fragment>
        );
      })}
    </>
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
      // selKey는 spathId("t:chat|0.1") — 속성 선택자 따옴표 안이라 '|'·':'는 그대로
      // 안전하고, 문자열 리터럴을 깨는 '"'·'\'만 이스케이프한다(TabSchema는 tabId의
      // 내용 문자를 제한하지 않는다). 대상 부재(탭 루트·비활성 탭 등)는 표시선 없음.
      const el = host?.querySelector(`[data-spath="${selKey.replace(/["\\]/g, "\\$&")}"]`);
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
  onContextMenu,
  previewTab,
  onPreviewTab,
  onLogout,
}: {
  layout: Layout;
  screen: Block;
  editing: boolean;
  selected: ScopedPath | null;
  onSelect: (sp: ScopedPath | null) => void;
  // 우클릭 통지(T6.3) — 대상 스코프 경로와 clientX/Y. 선택 교체+메뉴 열기는 상위
  // (StudioApp)가 한 핸들러에서 처리한다.
  onContextMenu?: (sp: ScopedPath, x: number, y: number) => void;
  previewTab: string; // 프리뷰 탭 상태는 StudioApp 소유 — 탭 스코프 선택과 동기화
  onPreviewTab: (t: string) => void;
  onLogout: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const { t } = useI18n();

  // 물리 Shift 키 눌림 추적 — submit 이벤트(SubmitEvent)에는 shiftKey가 없어서,
  // Shift+클릭·Shift+Enter가 유발한 폼 제출을 통과시키려면 키 상태를 따로 기억해야
  // 한다. 편집 모드에서만 리스닝하고, 키업 유실(창 포커스 이탈 등)에 대비해 blur에서
  // 리셋한다.
  const shiftHeldRef = useRef(false);
  useEffect(() => {
    if (!editing) return;
    const down = (e: KeyboardEvent) => {
      if (e.key === "Shift") shiftHeldRef.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Shift") shiftHeldRef.current = false;
    };
    const reset = () => {
      shiftHeldRef.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", reset);
    return () => {
      shiftHeldRef.current = false;
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", reset);
    };
  }, [editing]);

  // 클릭 → 가장 가까운 래퍼(data-spath)의 스코프 경로로 선택. 캡처 단계에서 전파를
  // 끊어 블록 내부의 onClick(탭 전환·시트 열기 등)이 실행되지 않게 한다. 파싱은
  // parseSpathId(화면·탭 스코프 공용) — 형식 위반은 null(선택 해제)로 관대 처리.
  // Shift+클릭(T3.1)은 preventDefault·stopPropagation을 생략하고 즉시 반환 — 실제
  // 인터랙션(탭 전환·시트 여닫기·입력 포커스)이 그대로 실행되고 선택은 일어나지
  // 않는다. 시트가 열린 상태의 일반 클릭은 시트 DOM에 data-spath가 없어 선택 해제만
  // 되며, 시트를 닫으려면 Shift+클릭이 필요하다(상단 힌트로 고지).
  const onClickCapture = (e: React.MouseEvent) => {
    if (e.shiftKey) return;
    e.preventDefault();
    e.stopPropagation();
    const el = (e.target as Element).closest?.("[data-spath]");
    const sp = el?.getAttribute("data-spath");
    onSelect(sp == null ? null : parseSpathId(sp));
  };

  // 우클릭 → 컨텍스트 메뉴(T6.3). contextmenu는 click과 별개 이벤트라 위 click-capture와
  // 충돌하지 않는다. 캡처 단계 preventDefault로 브라우저 기본 메뉴를 막고, 대상 spath를
  // 파싱해 상위(StudioApp)에 좌표와 함께 넘긴다 — 선택 교체와 메뉴 열기를 상위가 같은
  // 핸들러에서 처리한다(React 배칭으로 메뉴 항목 활성화가 새 선택 기준으로 렌더된다).
  // 유령(미물질화) 탭 콘텐츠는 data-spath가 없어 바깥 tab-content 블록이 대상이 된다
  // — 유령 블록 자체는 메뉴 대상이 아니다(클릭 선택과 동일 정책, 트리의 "편집 시작" 유도).
  const onContextMenuCapture = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = (e.target as Element).closest?.("[data-spath]");
    const sp = el?.getAttribute("data-spath");
    const parsed = sp == null ? null : parseSpathId(sp);
    if (parsed) onContextMenu?.(parsed, e.clientX, e.clientY);
  };

  // 드래프트 테마를 캔버스 범위에만 미리 적용한다(문서 전역 오염 방지) — mode는
  // 프레임 클래스(dark/light — 라이트 강제는 globals.css .light 블록), accent·radius는
  // 스코프 CSS 변수. 기본 테마면 클래스·스타일이 모두 비어 현행 DOM과 동일(회귀 0).
  // 프레임 자체의 rounded-[2rem]은 임의값 클래스라 radius 토큰의 영향을 받지 않는다.
  const themed = canvasThemeStyle(layout.theme);

  return (
    <div ref={hostRef} className="relative">
      {/* 편집 모드 한정 힌트 — Shift+클릭 통과는 채팅 전송 등 실제 발신으로 이어질 수
          있음을 상시 고지한다. 프레임 바깥(캔버스 상단)이라 시트가 열려도 가려지지
          않고, SelectionOutline 좌표는 host 기준 상대값이라 영향이 없다. */}
      {editing && (
        <p className="mb-2 max-w-[390px] text-center text-[11px] text-muted">
          {t("studio.canvas.shiftHint")}
        </p>
      )}
      {/* 프레임의 relative: 시트·모달(absolute inset-0)의 containing block을 폰 프레임으로
          만들어 rounded+overflow-hidden 클리핑이 absolute 자손에도 적용되게 한다(B9).
          SelectionOutline은 프레임의 형제(hostRef 기준 absolute)라 영향이 없다. */}
      <div
        className={[
          "relative flex h-[780px] w-[390px] flex-col overflow-hidden rounded-[2rem] border border-line bg-bg shadow-card",
          themed.className,
        ]
          .filter(Boolean)
          .join(" ")}
        style={themed.style}
        onClickCapture={editing ? onClickCapture : undefined}
        onContextMenuCapture={editing ? onContextMenuCapture : undefined}
        // mousedown 기본동작 차단 — 편집 모드에서 입력창 포커스·텍스트 선택을 막는다.
        // Shift+마우스다운은 통과시켜 실제 포커스가 잡히게 한다(T3.1).
        onMouseDownCapture={
          editing
            ? (e) => {
                if (!e.shiftKey) e.preventDefault();
              }
            : undefined
        }
        // submit 기본동작(폼 내비게이션) 차단 — Shift가 눌린 채 유발된 제출은 통과.
        // SubmitEvent에는 shiftKey가 없어 위 shiftHeldRef로 판정한다.
        onSubmitCapture={
          editing
            ? (e) => {
                if (!shiftHeldRef.current) e.preventDefault();
              }
            : undefined
        }
      >
        {/* tabControl: 프리뷰 탭을 스튜디오가 제어한다 — 미리보기 모드의 탭바 클릭도
            이 경로(블록의 setTab→onPreviewTab)로 정상 동작하고, 편집 모드 클릭은 위
            캡처 핸들러가 가로채 선택으로 바꾼다(가로채기와 공존). */}
        <PanelProvider
          layout={layout}
          onLogout={onLogout}
          tabControl={{ tab: previewTab, setTab: onPreviewTab }}
        >
          <CanvasNode
            node={screen}
            sp={{ scope: { kind: "screen" }, path: [] }}
            editing={editing}
          />
        </PanelProvider>
      </div>
      {editing && selected && <SelectionOutline hostRef={hostRef} selKey={spathId(selected)} />}
    </div>
  );
}
