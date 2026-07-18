"use client";

// StudioApp — 스튜디오 편집기의 배선. 드래프트(undo/redo 히스토리의 present)를 단일
// 소스로 두고, 트리 변경은 전부 editOps 경유, 영속화는 studioDraft, 발행 판정은
// studioPublish로 위임한다. 캔버스는 클릭 선택+라이브 프리뷰, 구조 트리는 DnD 재배치
// 담당(하이브리드 — 캔버스 직접 DnD는 display:contents 래퍼와 실제 블록 박스가 어긋나
// 드롭 좌표 정합을 보장하기 어렵다).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_LAYOUT, putLayout } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { DEFAULT_SCREEN, REGISTRY } from "../../lib/builder/registry";
import type { Block, Layout, TabSpec, ThemeSpec } from "../../lib/builder/schema";
import {
  duplicateAt,
  getAt,
  insertAt,
  moveNode,
  removeAt,
  unwrapAt,
  updateProps,
  wrapAt,
  type BlockPath,
} from "../../lib/builder/editOps";
import { countBlockType } from "../../lib/builder/layoutQuery";
import type { ContextMenuItem } from "../../lib/builder/contextMenu";
import {
  displayName,
  getScopeRoot,
  spathId,
  writeScopeRoot,
  type EditScope,
  type ScopedPath,
} from "../../lib/builder/studioScope";
import { ghostTabContent, keyedBlocks, keyedScreen, renameProps } from "../../lib/builder/studioTree";
import { clearDraft, saveDraft } from "../../lib/builder/studioDraft";
import {
  loadPanes,
  savePanes,
  type PaneSide,
  type PaneWidths,
} from "../../lib/builder/paneSize";
import {
  canRedo,
  canUndo,
  initHistory,
  pushHistory,
  redoHistory,
  undoHistory,
  type StudioHistory,
} from "../../lib/builder/studioHistory";
import { publishErrorKey, validateForPublish } from "../../lib/builder/studioPublish";
import TopBar from "./TopBar";
import PaneResizer from "./PaneResizer";
import Palette from "./Palette";
import StructureTree from "./StructureTree";
import StudioCanvas from "./Canvas";
import Inspector from "./Inspector";
import TabsEditor from "./TabsEditor";
import ThemeEditor from "./ThemeEditor";
import ContextMenu, { ContextMenuPanel } from "./ContextMenu";
import StyleFields from "./StyleFields";

type Section = "block" | "tabs" | "theme";
type PubState = { state: "idle" | "busy" | "ok" | "err"; errKey?: string };

// 컨텍스트 메뉴 상태(T6.3) — StudioApp 소유 싱글턴 1개. 대상 ScopedPath는 열 때
// 고정한다(메뉴 표시 중 선택 변경과 무관 — 항목 onRun 클로저에 sp가 담긴다).
// stage: "menu"=명령 목록, "style"/"rename"=같은 앵커에 여는 2단 폼 패널(피드백 6 —
// 스타일 수정 폼이 우클릭 도구에 직접 포함된다).
type MenuStage = "menu" | "style" | "rename";
type MenuState = {
  sp: ScopedPath;
  x: number;
  y: number;
  anchorRect: { left: number; bottom: number } | null;
  stage: MenuStage;
};

// 선택 요소의 화면 rect — Shift+F10(키보드 열림, 좌표 (0,0))의 배치 앵커. 캔버스 래퍼는
// display:contents라 자체 박스가 없어 Range로 내용 합집합 rect를 재고(SelectionOutline과
// 동일 기법), 비어 있으면 트리 행(data-treerow)으로 폴백한다. 둘 다 없으면 null —
// placeMenu가 (0,0)을 뷰포트 여백으로 클램프해 좌상단에 연다.
function menuAnchorRect(sp: ScopedPath): { left: number; bottom: number } | null {
  const esc = spathId(sp).replace(/["\\]/g, "\\$&");
  const wrap = document.querySelector(`[data-spath="${esc}"]`);
  if (wrap) {
    const range = document.createRange();
    range.selectNodeContents(wrap);
    const r = range.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) return { left: r.left, bottom: r.bottom };
  }
  const row = document.querySelector(`[data-treerow="${esc}"]`);
  if (row) {
    const r = row.getBoundingClientRect();
    return { left: r.left, bottom: r.bottom };
  }
  return null;
}

// 메뉴 이름 변경 패널의 입력 — 커밋 규칙(트림·40자·no-op 걸러내기)은 상위 onRename
// (renameProps)이 처리한다. Enter=커밋+닫기, blur=커밋, Escape=취소. 트리 인라인과
// 달리 패널의 Escape 닫기는 포커스 복원(focus())이 blur를 유발하므로, Escape를 먼저
// 기록해 그 blur가 커밋으로 이어지지 않게 한다(트리는 unmount 경로라 blur 자체가 없다).
function RenameField({
  initial,
  placeholder,
  ariaLabel,
  hint,
  onCommit,
  onDone,
}: {
  initial: string;
  placeholder: string;
  ariaLabel: string;
  hint: string;
  onCommit: (v: string) => void;
  onDone: () => void; // Enter 커밋 후 닫기(포커스 복원 포함 close)
}) {
  const canceledRef = useRef(false);
  return (
    <div>
      <input
        type="text"
        defaultValue={initial}
        placeholder={placeholder}
        maxLength={40}
        aria-label={ariaLabel}
        className="w-full rounded-lg border border-line bg-card px-2 py-1.5 text-xs text-fg outline-none focus:border-accent"
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            // 닫기(포커스 복원)가 유발하는 blur의 재커밋은 renameProps가 no-op 처리한다.
            onCommit(e.currentTarget.value);
            onDone();
          } else if (e.key === "Escape") {
            canceledRef.current = true; // 버블된 Escape가 패널을 닫는다 — blur 커밋만 차단
          }
        }}
        onBlur={(e) => {
          if (!canceledRef.current) onCommit(e.target.value);
        }}
      />
      <p className="mt-1 text-[10px] text-muted">{hint}</p>
    </div>
  );
}

// 팔레트에서 새로 만드는 블록. text는 레지스트리 라벨을 초기 문구로 넣어 캔버스에서
// 바로 보이게 한다(빈 텍스트는 찾기 어렵다). key는 insertAt이 부여한다.
function newBlock(type: string): Block {
  if (type === "text") {
    const l = REGISTRY.text.label;
    return { type, props: { ko: l.ko, en: l.en } };
  }
  return { type };
}

export default function StudioApp({
  initial,
  onNeedLogin,
}: {
  initial: Layout;
  onNeedLogin: () => void;
}) {
  const { t, lang } = useI18n();
  const [hist, setHist] = useState<StudioHistory>(() => initHistory(initial));
  // 선택은 스코프 경로(ScopedPath) — 화면 트리 또는 탭 콘텐츠 안의 위치.
  // 캔버스 탭 콘텐츠 선택(T2.3)도 이 모델을 그대로 소비한다.
  const [selected, setSelected] = useState<ScopedPath | null>(null);
  const [editing, setEditing] = useState(true);
  const [section, setSection] = useState<Section>("block");
  // 캔버스 프리뷰의 활성 탭 — PanelProvider의 tabControl로 주입한다(T2.3). 탭 스코프
  // 선택 시 여기를 갱신해 트리·캔버스가 같은 탭 시점을 보게 한다. 초기값은
  // PanelProvider 내부 기본과 동일한 "chat"(회귀 0). 숨김 탭으로 바뀌면 Provider의
  // 기존 폴백 이펙트가 이 setter로 "chat" 복귀를 요청한다(제어 역전·루프 없음).
  const [previewTab, setPreviewTab] = useState("chat");
  const [pub, setPub] = useState<PubState>({ state: "idle" });
  const [savedOnce, setSavedOnce] = useState(false);
  // 서버본을 드래프트로 가리지 않도록, 실제 편집이 시작된 뒤에만 자동저장한다.
  const dirtyRef = useRef(false);
  // 좌·우 패널 폭(T3.2) — 저장본 복원(검증·클램프는 loadPanes 책임). StudioApp은
  // 클라 가드 통과 후에만 마운트되므로 초기화에서 localStorage를 읽어도 SSR
  // 프리렌더 불일치가 없다. 저장은 제스처 종료(onPaneCommit) 시에만 한다.
  const [panes, setPanes] = useState<PaneWidths>(() => loadPanes());
  // 커밋 시 "반대편 폭"을 읽기 위한 미러 — 반대편은 자기 제스처의 커밋에서만
  // 바뀌고 그때 동기 갱신되므로, 드래그 미리보기(onPaneResize) 중에도 어긋나지 않는다.
  const panesRef = useRef(panes);
  const onPaneResize = useCallback((side: PaneSide, w: number) => {
    setPanes((p) => (p[side] === w ? p : { ...p, [side]: w }));
  }, []);
  const onPaneCommit = useCallback((side: PaneSide, w: number) => {
    const next = { ...panesRef.current, [side]: w };
    panesRef.current = next;
    savePanes(next);
    setPanes((p) => (p[side] === w ? p : { ...p, [side]: w }));
  }, []);

  const draft = hist.present;
  // 캔버스·트리가 다루는 유효 화면 — 드래프트에 screen이 없으면 번들 기본을 쓴다.
  // key를 부여해 두어 재배치 시 React 상태가 다른 블록에 옮겨붙지 않게 한다.
  const fallbackScreen = useMemo(() => keyedScreen(DEFAULT_SCREEN), []);
  const screen = draft.screen ?? fallbackScreen;

  const apply = useCallback((next: Layout) => {
    dirtyRef.current = true;
    setPub({ state: "idle" });
    setHist((h) => pushHistory(h, next));
  }, []);

  // 탭 목록(트리 섹션·유령 판정·물질화 공용) — 드래프트에 없으면 기본 탭.
  const tabs: TabSpec[] = useMemo(() => draft.tabs ?? DEFAULT_LAYOUT.tabs ?? [], [draft.tabs]);

  // ── 스코프 편집 공통 — 모든 트리 편집은 getScopeRoot → editOps → writeScopeRoot
  // 한 경로만 쓴다(화면·탭 콘텐츠 동형). ────────────────────────────────────────
  const rootOf = useCallback(
    (scope: EditScope) => getScopeRoot(draft, scope, fallbackScreen),
    [draft, fallbackScreen],
  );

  // prev는 호출부가 이미 얻어 editOps에 넘긴 스코프 루트. editOps가 no-op(원본
  // 반환)이면 히스토리에 넣지 않는다 — 탭 스코프는 getScopeRoot가 호출마다 새
  // 가상 루트를 만들므로 여기서 재조회해 비교하면 no-op을 놓친다.
  const applyScope = useCallback(
    (scope: EditScope, prev: Block, next: Block) => {
      if (next === prev) return;
      apply(writeScopeRoot(draft, scope, next));
    },
    [apply, draft],
  );

  // undo/redo 공통 경로. 히스토리 이동도 편집이다 — "발행됨" 표시를 무효화하고(B5)
  // 자동저장을 되살린다. 이동 후 같은 경로에 다른 블록이 올 수 있으므로 선택은
  // 해제가 안전 기본값이다(B7 — key 기반 선택 추적은 스코프 도입 후 재평가).
  const applyHist = useCallback(
    (fn: (h: StudioHistory) => StudioHistory) => {
      const next = fn(hist);
      if (next === hist) return; // 이동 불가(no-op) — 상태 오염 방지
      dirtyRef.current = true;
      setPub({ state: "idle" });
      setSelected(null);
      setHist(next);
    },
    [hist],
  );

  // 드래프트 자동저장(300ms 디바운스) — 편집 시작 후에만.
  useEffect(() => {
    if (!dirtyRef.current) return;
    const id = setTimeout(() => {
      // 대기 중 발행이 성공해 드래프트가 지워졌을 수 있다 — 발화 시점에 재확인(B4).
      if (!dirtyRef.current) return;
      saveDraft(draft);
      setSavedOnce(true);
    }, 300);
    return () => clearTimeout(id);
  }, [draft]);

  // undo/redo·삭제·탭 삭제로 선택 스코프/경로가 무효해지면 해제한다. 콘텐츠가
  // 비어 유령(기본 매핑 폴백) 상태로 되돌아간 탭의 선택도 해제한다 — 유령 탭은
  // 트리에서 선택 대상이 아니므로 stale 선택을 남기지 않는다.
  useEffect(() => {
    if (!selected) return;
    const root = getScopeRoot(draft, selected.scope, fallbackScreen);
    let stale = !root || (selected.path.length > 0 && !getAt(root, selected.path));
    if (!stale && selected.scope.kind === "tab") {
      const tabId = selected.scope.tabId;
      const tb = tabs.find((x) => x.id === tabId);
      stale = !tb || ghostTabContent(tb) !== null;
    }
    if (stale) setSelected(null);
  }, [draft, fallbackScreen, selected, tabs]);

  // 단축키: Ctrl/Cmd+Z = undo, +Shift = redo(또는 Ctrl+Y). 입력 필드에서는 무시.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === "z") {
        e.preventDefault();
        applyHist(e.shiftKey ? redoHistory : undoHistory);
      } else if (k === "y") {
        e.preventDefault();
        applyHist(redoHistory);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applyHist]);

  // ── 트리 편집(전부 editOps 경유) ──────────────────────────────────────────
  // 캔버스·트리 선택. 우패널 섹션 전환은 선택이 "실제로 바뀐 경우"로 한정한다(B10)
  // — 같은 블록 재클릭·빈 곳 클릭(해제) 시 탭/테마 섹션이 블록 섹션으로 튕기지 않는다.
  const onSelect = useCallback(
    (sp: ScopedPath | null) => {
      const changed = (sp ? spathId(sp) : null) !== (selected ? spathId(selected) : null);
      setSelected(sp);
      if (sp && changed) setSection("block");
      // 탭 스코프 선택은 캔버스 프리뷰를 그 탭으로 전환한다(트리·캔버스 시점 일치).
      // 재클릭(비변경)에도 전환한다 — 미리보기 모드에서 다른 탭으로 옮겨둔 뒤 같은
      // 선택 행을 다시 눌러 복귀하는 경로. 같은 값이면 setState no-op이라 무해하다.
      if (sp?.scope.kind === "tab") setPreviewTab(sp.scope.tabId);
    },
    [selected],
  );

  // ── 컨텍스트 메뉴(T6.3) — 열림 상태·좌표·항목은 StudioApp 소유 ────────────────
  const [menu, setMenu] = useState<MenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  // 우클릭 열기(캔버스·트리 공용) — 같은 핸들러에서 선택을 대상으로 교체한 뒤 연다
  // (React 배칭으로 항목 활성화·인스펙터가 새 선택 기준으로 렌더된다, 빌더 관행).
  const onOpenMenu = useCallback(
    (sp: ScopedPath, x: number, y: number) => {
      onSelect(sp);
      setMenu({ sp, x, y, anchorRect: null, stage: "menu" });
    },
    [onSelect],
  );

  // Shift+F10 — 선택 요소 기준 키보드 열림(좌표 (0,0) + anchorRect 폴백, T6.2 계약).
  // 입력 필드에서는 무시(undo 단축키와 동일 가드).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "F10" || !e.shiftKey || !selected) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      e.preventDefault();
      setMenu({ sp: selected, x: 0, y: 0, anchorRect: menuAnchorRect(selected), stage: "menu" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  // 메뉴·패널 대상 무효화 — 대상 노드가 사라지면(undo·삭제·탭 제거 등) 닫는다.
  // 유령 복귀 등 선택 해제 조건은 위 선택 이펙트가 처리하고, 여기는 메뉴 대상만 본다.
  useEffect(() => {
    if (!menu) return;
    const root = getScopeRoot(draft, menu.sp.scope, fallbackScreen);
    if (!root || !getAt(root, menu.sp.path)) setMenu(null);
  }, [draft, fallbackScreen, menu]);

  // 중복 배치 가드(B8) — unique 블록이 레이아웃 어딘가(화면·탭 content·암묵 기본
  // 매핑)에 이미 있으면 팔레트 버튼을 비활성화한다. 계수는 layoutQuery의 순수 로직.
  const placed = useMemo(() => {
    const s = new Set<string>();
    for (const [type, def] of Object.entries(REGISTRY)) {
      if (def.unique && countBlockType(draft, type) >= 1) s.add(type);
    }
    return s;
  }, [draft]);

  const onAdd = useCallback(
    (type: string) => {
      // 중복 배치 방어(B8) — 팔레트 비활성화를 우회한 호출도 여기서 no-op.
      const addedDef = Object.hasOwn(REGISTRY, type) ? REGISTRY[type] : undefined;
      if (addedDef?.unique && countBlockType(draft, type) >= 1) return;
      // 목적지 스코프: 선택이 있으면 그 스코프, 없으면 화면 루트. 유령 탭은 트리에서
      // 선택 불가라 여기 오지 않고, 탭 부재(rootOf null)는 방어적으로 no-op.
      const sp: ScopedPath = selected ?? { scope: { kind: "screen" }, path: [] };
      const root = rootOf(sp.scope);
      if (!root) return;
      // 목적지: 선택이 루트/컨테이너면 그 안(끝), 요소면 그 뒤(형제), 무효면 루트 끝.
      let parent: BlockPath = [];
      let index = root.children?.length ?? 0;
      const sel = getAt(root, sp.path);
      if (sel && sp.path.length > 0) {
        const def = Object.hasOwn(REGISTRY, sel.type) ? REGISTRY[sel.type] : undefined;
        if (def?.kind === "layout") {
          parent = sp.path;
          index = sel.children?.length ?? 0;
        } else {
          parent = sp.path.slice(0, -1);
          index = sp.path[sp.path.length - 1] + 1;
        }
      }
      applyScope(sp.scope, root, insertAt(root, parent, index, newBlock(type)));
      setSelected({ scope: sp.scope, path: [...parent, index] });
      setSection("block");
    },
    [applyScope, draft, rootOf, selected],
  );

  const onMove = useCallback(
    (scope: EditScope, from: BlockPath, toParent: BlockPath, toIndex: number) => {
      const root = rootOf(scope);
      if (!root) return;
      applyScope(scope, root, moveNode(root, from, toParent, toIndex));
      setSelected(null); // 이동 후 경로가 재계산되므로 선택은 해제한다
    },
    [applyScope, rootOf],
  );

  // 탭의 마지막 블록을 지우면 content=[]가 되고, 렌더는 기본 매핑으로 폴백하며
  // 트리는 유령 섹션으로 되돌아간다(ghostTabContent — 표기와 렌더 일치).
  const onRemove = useCallback(
    (sp: ScopedPath) => {
      const root = rootOf(sp.scope);
      if (!root) return;
      applyScope(sp.scope, root, removeAt(root, sp.path));
      setSelected(null);
    },
    [applyScope, rootOf],
  );

  const onUpdateProps = useCallback(
    (sp: ScopedPath, props: Record<string, unknown>) => {
      const root = rootOf(sp.scope);
      if (!root) return;
      applyScope(sp.scope, root, updateProps(root, sp.path, props));
    },
    [applyScope, rootOf],
  );

  // 더블클릭 이름변경 — 표시명 메타(props.name)만 바꾼다. renameProps가 변화 없음을
  // null로 알려 no-op 처리하므로 히스토리에는 실제 변경만 1항목 쌓인다. key 보존은
  // renameProps(전체 키 복사)와 updateProps 양쪽이 보장한다.
  const onRename = useCallback(
    (sp: ScopedPath, name: string) => {
      const root = rootOf(sp.scope);
      if (!root) return;
      const node = getAt(root, sp.path);
      if (!node) return;
      const props = renameProps(node.props, name);
      if (!props) return;
      applyScope(sp.scope, root, updateProps(root, sp.path, props));
    },
    [applyScope, rootOf],
  );

  // 유령 탭 물질화 — "편집 시작" 클릭 시에만 기본 매핑을 실제 content로 복사한다
  // (발행본 변화는 항상 명시 조작의 결과 — 암묵 물질화 금지). draft.tabs가 없으면
  // 기본 탭 목록째로 드래프트에 올린다(이 역시 같은 클릭의 명시적 결과다).
  const onMaterializeTab = useCallback(
    (tabId: string) => {
      const i = tabs.findIndex((tb) => tb.id === tabId);
      if (i < 0) return;
      const ghost = ghostTabContent(tabs[i]);
      if (!ghost) return;
      const nextTabs = [...tabs];
      nextTabs[i] = { ...tabs[i], content: keyedBlocks(ghost) };
      apply({ ...draft, tabs: nextTabs });
      setSelected({ scope: { kind: "tab", tabId }, path: [] });
      setPreviewTab(tabId); // 편집을 시작한 탭을 캔버스에서 바로 보여준다
    },
    [apply, draft, tabs],
  );

  // ── 탭·테마·메타 ─────────────────────────────────────────────────────────
  const onTabsChange = useCallback((next: TabSpec[]) => apply({ ...draft, tabs: next }), [apply, draft]);
  const onTheme = useCallback(
    (next: ThemeSpec) => apply({ ...draft, theme: next }),
    [apply, draft],
  );
  const onMetaTitle = useCallback(
    (title: string) => apply({ ...draft, meta: { ...draft.meta, title } }),
    [apply, draft],
  );

  const onRestore = useCallback(() => {
    if (!window.confirm(t("studio.restore.confirm"))) return;
    apply(DEFAULT_LAYOUT);
    setSelected(null);
  }, [apply, t]);

  // ── 발행 ────────────────────────────────────────────────────────────────
  const check = useMemo(() => validateForPublish(draft), [draft]);
  const onPublish = useCallback(async () => {
    if (!check.ok) return;
    setPub({ state: "busy" });
    try {
      await putLayout(draft);
      // 발행 성공 = 드래프트와 발행본 일치(스펙 §5) — 로컬 드래프트를 지워 다음
      // 방문이 서버 발행본에서 시작하게 한다(B4). 편집 재개 시 드래프트 재생성은
      // 기존 dirty 게이트가 처리한다.
      clearDraft();
      dirtyRef.current = false;
      setPub({ state: "ok" });
    } catch (e) {
      setPub({ state: "err", errKey: publishErrorKey(e) });
    }
  }, [check.ok, draft]);

  // 상단바 상태 문구 — 사전검사 실패 > 발행 오류 > 발행됨 > 임시저장됨 순으로 보여준다.
  let statusText = "";
  let statusKind: "muted" | "ok" | "danger" = "muted";
  if (!check.ok) {
    statusText = t(check.reasonKey);
    statusKind = "danger";
  } else if (pub.state === "err" && pub.errKey) {
    statusText = t(pub.errKey);
    statusKind = "danger";
  } else if (pub.state === "ok") {
    statusText = t("studio.bar.published");
    statusKind = "ok";
  } else if (savedOnce) {
    statusText = t("studio.bar.saved");
  }

  const sections: Array<{ v: Section; label: string }> = [
    { v: "block", label: t("studio.section.block") },
    { v: "tabs", label: t("studio.section.tabs") },
    { v: "theme", label: t("studio.section.theme") },
  ];

  // 인스펙터는 스코프 무지 컴포넌트(T5.1에서 재작성 예정) — 선택 스코프의 루트를
  // screen 자리에 넣어 그대로 재사용한다. 탭 루트 선택([] 경로)은 편집 대상 노드가
  // 아니므로(가상 tab-root 노출 방지) 빈 상태로 보낸다. key(스코프 포함 id)로
  // 스코프 간 재마운트를 강제해 미커밋 입력이 다른 선택으로 넘어가지 않게 한다.
  const inspRoot = (selected ? rootOf(selected.scope) : null) ?? screen;
  const inspPath =
    selected && !(selected.scope.kind === "tab" && selected.path.length === 0)
      ? selected.path
      : null;

  // ── 컨텍스트 메뉴 대상 스냅샷·명령 목록(T6.3) ─────────────────────────────────
  // 대상 노드는 렌더마다 현재 드래프트에서 재해석한다 — 2단 스타일 패널의 연속 커밋이
  // 항상 최신 props 위에 쌓이고, 실행(onRun)도 rootOf 재조회로 최신 트리에 연산한다.
  // 대상이 사라진 프레임은 null이 되어 아무것도 렌더하지 않고, 위 무효화 이펙트가 닫는다.
  const menuRoot = menu ? rootOf(menu.sp.scope) : null;
  const menuNode = menu && menuRoot ? getAt(menuRoot, menu.sp.path) : null;
  const menuDef =
    menuNode && Object.hasOwn(REGISTRY, menuNode.type) ? REGISTRY[menuNode.type] : undefined;

  // 명령 목록 — 대상별 활성화(계획 T6.3 그룹 순서). 불가 항목은 숨기지 않고 disabled로
  // 둔다(APG — 포커스 가능·실행 차단, 루트의 복제·삭제·감싸기 등이 여기 해당).
  let menuItems: ContextMenuItem[] | null = null;
  if (menu && menu.stage === "menu" && menuRoot && menuNode) {
    const m = menu;
    const sp = m.sp;
    const isRoot = sp.path.length === 0;
    const idx = isRoot ? -1 : sp.path[sp.path.length - 1];
    const parentPath = sp.path.slice(0, -1);
    const siblings = isRoot ? 0 : getAt(menuRoot, parentPath)?.children?.length ?? 0;
    // 스타일 적용 가능 대상 — noStyle·미지 타입 제외. 탭 루트([])는 tab-root가 레지스트리
    // 비등록이라 def=undefined로 자연히 걸러진다(인스펙터의 지원 판정과 동일 기준).
    const styleable = !!menuDef && !menuDef.noStyle;
    // 실행 공통부 — 루트를 재조회해 editOps에 넘기고, no-op(원본 반환)이면 히스토리도
    // 선택도 건드리지 않는다. nextSel 지정 시 성공한 경우에만 선택을 옮긴다.
    const exec = (fn: (root: Block) => Block, nextSel?: ScopedPath | null) => {
      const root = rootOf(sp.scope);
      if (!root) return;
      const next = fn(root);
      if (next === root) return;
      applyScope(sp.scope, root, next);
      if (nextSel !== undefined) setSelected(nextSel);
    };
    // 2단 전환 — close(메뉴 unmount) 뒤에 실행되지만 m 스냅샷을 직접 쓰므로 배칭의
    // 최종 승자가 된다(함수형 갱신은 직전 setMenu(null)을 봐서 쓰면 안 된다).
    const toStage = (stage: MenuStage) => setMenu({ ...m, stage });
    menuItems = [
      { id: "rename", label: t("studio.menu.rename"), disabled: isRoot, onRun: () => toStage("rename") },
      {
        id: "duplicate",
        label: t("studio.menu.duplicate"),
        disabled: isRoot,
        onRun: () => exec((r) => duplicateAt(r, sp.path)),
      },
      "separator",
      {
        id: "wrap-v",
        label: t("studio.menu.wrapV"),
        disabled: isRoot,
        onRun: () => exec((r) => wrapAt(r, sp.path, "vstack")),
      },
      {
        id: "wrap-h",
        label: t("studio.menu.wrapH"),
        disabled: isRoot,
        onRun: () => exec((r) => wrapAt(r, sp.path, "hstack")),
      },
      {
        id: "unwrap",
        label: t("studio.menu.unwrap"),
        // unwrapAt의 컨테이너 판정은 children 유무만이므로 registry kind==="layout"
        // 가드를 배선에서 건다(T6.1 인계) — element가 비정상적으로 children을 가져도
        // 메뉴에서는 풀 수 없다.
        disabled: isRoot || menuDef?.kind !== "layout" || !menuNode.children?.length,
        onRun: () => exec((r) => unwrapAt(r, sp.path), null), // 경로 재계산 — 선택 해제(onMove와 동일)
      },
      "separator",
      {
        id: "move-up",
        label: t("studio.menu.moveUp"),
        disabled: isRoot || idx <= 0,
        // moveNode의 toIndex는 "제거 전 좌표" — 위로는 idx-1 그대로 그 자리에 안착한다.
        onRun: () =>
          exec((r) => moveNode(r, sp.path, parentPath, idx - 1), { scope: sp.scope, path: [...parentPath, idx - 1] }),
      },
      {
        id: "move-down",
        label: t("studio.menu.moveDown"),
        disabled: isRoot || idx >= siblings - 1,
        // 아래로는 제거 보정(-1)을 감안해 idx+2를 넘기면 결과가 idx+1이 된다.
        onRun: () =>
          exec((r) => moveNode(r, sp.path, parentPath, idx + 2), { scope: sp.scope, path: [...parentPath, idx + 1] }),
      },
      "separator",
      { id: "style", label: t("studio.menu.style"), disabled: !styleable, onRun: () => toStage("style") },
      "separator",
      { id: "remove", label: t("studio.menu.remove"), danger: true, disabled: isRoot, onRun: () => onRemove(sp) },
    ];
  }

  return (
    <div className="flex h-screen flex-col bg-bg text-fg">
      <TopBar
        editing={editing}
        onToggleEditing={setEditing}
        canUndo={canUndo(hist)}
        canRedo={canRedo(hist)}
        onUndo={() => applyHist(undoHistory)}
        onRedo={() => applyHist(redoHistory)}
        onRestore={onRestore}
        publishDisabled={!check.ok}
        publishBusy={pub.state === "busy"}
        onPublish={onPublish}
        statusText={statusText}
        statusKind={statusKind}
      />
      <div className="flex min-h-0 flex-1">
        {/* 패널 폭은 인라인 style — Tailwind JIT는 동적 값 클래스를 못 본다(T3.2). */}
        <aside
          style={{ width: panes.left }}
          className="shrink-0 overflow-y-auto border-r border-line bg-card p-3"
        >
          <Palette onAdd={onAdd} placed={placed} />
          <div className="my-3 border-t border-line" />
          <StructureTree
            screen={screen}
            tabs={tabs}
            selected={selected}
            onSelect={onSelect}
            onMove={onMove}
            onRemove={onRemove}
            onRename={onRename}
            onMaterialize={onMaterializeTab}
            onContextMenu={onOpenMenu}
          />
        </aside>
        <PaneResizer
          side="left"
          width={panes.left}
          onResize={(w) => onPaneResize("left", w)}
          onCommit={(w) => onPaneCommit("left", w)}
        />
        <main className="flex min-w-0 flex-1 items-start justify-center overflow-auto p-6">
          {/* 캔버스는 ScopedPath 직결(T2.3) — 화면·탭 콘텐츠 블록 모두 클릭 선택되고,
              프리뷰 탭은 previewTab(스튜디오 소유)으로 제어한다. */}
          <StudioCanvas
            layout={draft}
            screen={screen}
            editing={editing}
            selected={selected}
            onSelect={onSelect}
            onContextMenu={onOpenMenu}
            previewTab={previewTab}
            onPreviewTab={setPreviewTab}
            onLogout={onNeedLogin}
          />
        </main>
        <PaneResizer
          side="right"
          width={panes.right}
          onResize={(w) => onPaneResize("right", w)}
          onCommit={(w) => onPaneCommit("right", w)}
        />
        <aside
          style={{ width: panes.right }}
          className="shrink-0 overflow-y-auto border-l border-line bg-card p-3"
        >
          <div className="mb-3 flex gap-1 rounded-xl bg-card2 p-1" role="tablist">
            {sections.map((s) => (
              <button
                key={s.v}
                type="button"
                role="tab"
                aria-selected={section === s.v}
                onClick={() => setSection(s.v)}
                className={[
                  "flex-1 rounded-lg px-2 py-1 text-xs font-medium",
                  section === s.v ? "bg-card text-fg shadow-card" : "text-muted hover:text-fg",
                ].join(" ")}
              >
                {s.label}
              </button>
            ))}
          </div>
          {section === "block" && (
            <Inspector
              key={selected ? spathId(selected) : "none"}
              screen={inspRoot}
              selected={inspPath}
              onUpdateProps={(p, props) => {
                if (selected) onUpdateProps({ scope: selected.scope, path: p }, props);
              }}
              onRemove={(p) => {
                if (selected) onRemove({ scope: selected.scope, path: p });
              }}
            />
          )}
          {section === "tabs" && <TabsEditor tabs={tabs} onChange={onTabsChange} />}
          {section === "theme" && (
            <ThemeEditor
              theme={draft.theme ?? {}}
              metaTitle={draft.meta?.title ?? ""}
              onTheme={onTheme}
              onMetaTitle={onMetaTitle}
            />
          )}
        </aside>
      </div>
      {/* 컨텍스트 메뉴(T6.3, 포털) — 재열림은 key로 remount(활성 항목·포커스 초기화). */}
      {menu?.stage === "menu" && menuItems && (
        <ContextMenu
          key={`${menu.x},${menu.y}`}
          x={menu.x}
          y={menu.y}
          items={menuItems}
          anchorRect={menu.anchorRect}
          onClose={closeMenu}
        />
      )}
      {/* 2단 스타일 패널(피드백 6 — 메뉴 자리에서 직접 수정). 폼·커밋 규약은 인스펙터와
          동일(StyleFields·styleProps 단일 소스) — 패널은 열린 채 연속 커밋된다. */}
      {menu?.stage === "style" && menuNode && menuDef && !menuDef.noStyle && (
        <ContextMenuPanel
          key={`${menu.x},${menu.y}:style`}
          x={menu.x}
          y={menu.y}
          anchorRect={menu.anchorRect}
          label={t("studio.menu.styleTitle")}
          onClose={closeMenu}
        >
          {() => (
            <StyleFields
              value={menuNode.props?.style}
              layout={menuDef.kind === "layout"}
              onCommit={(style) => {
                // 인스펙터 setProp("style", …)과 동일 규칙 — undefined면 키 제거.
                const cur: Record<string, unknown> = { ...menuNode.props };
                if (style === undefined) delete cur.style;
                else cur.style = style;
                onUpdateProps(menu.sp, cur);
              }}
            />
          )}
        </ContextMenuPanel>
      )}
      {/* 2단 이름 변경 패널 — 트리 인라인과 같은 커밋 규칙(onRename→renameProps 공유). */}
      {menu?.stage === "rename" && menuNode && menu.sp.path.length > 0 && (
        <ContextMenuPanel
          key={`${menu.x},${menu.y}:rename`}
          x={menu.x}
          y={menu.y}
          anchorRect={menu.anchorRect}
          label={t("studio.menu.renameTitle")}
          onClose={closeMenu}
        >
          {(close) => (
            <RenameField
              initial={typeof menuNode.props?.name === "string" ? menuNode.props.name : ""}
              placeholder={displayName(menuNode, menuDef, lang)}
              ariaLabel={t("studio.tree.renameAria")}
              hint={t("studio.menu.renameHint")}
              onCommit={(v) => onRename(menu.sp, v)}
              onDone={() => close(true)}
            />
          )}
        </ContextMenuPanel>
      )}
    </div>
  );
}
