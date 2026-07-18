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
  getAt,
  insertAt,
  moveNode,
  removeAt,
  updateProps,
  type BlockPath,
} from "../../lib/builder/editOps";
import { countBlockType } from "../../lib/builder/layoutQuery";
import {
  getScopeRoot,
  spathId,
  writeScopeRoot,
  type EditScope,
  type ScopedPath,
} from "../../lib/builder/studioScope";
import { ghostTabContent, keyedBlocks, keyedScreen, renameProps } from "../../lib/builder/studioTree";
import { clearDraft, saveDraft } from "../../lib/builder/studioDraft";
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
import Palette from "./Palette";
import StructureTree from "./StructureTree";
import StudioCanvas from "./Canvas";
import Inspector from "./Inspector";
import TabsEditor from "./TabsEditor";
import ThemeEditor from "./ThemeEditor";

type Section = "block" | "tabs" | "theme";
type PubState = { state: "idle" | "busy" | "ok" | "err"; errKey?: string };

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
  const { t } = useI18n();
  const [hist, setHist] = useState<StudioHistory>(() => initHistory(initial));
  // 선택은 스코프 경로(ScopedPath) — 화면 트리 또는 탭 콘텐츠 안의 위치.
  // 캔버스 탭 콘텐츠 선택(T2.3)도 이 모델을 그대로 소비한다.
  const [selected, setSelected] = useState<ScopedPath | null>(null);
  const [editing, setEditing] = useState(true);
  const [section, setSection] = useState<Section>("block");
  const [pub, setPub] = useState<PubState>({ state: "idle" });
  const [savedOnce, setSavedOnce] = useState(false);
  // 서버본을 드래프트로 가리지 않도록, 실제 편집이 시작된 뒤에만 자동저장한다.
  const dirtyRef = useRef(false);

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
    },
    [selected],
  );

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
        <aside className="w-60 shrink-0 overflow-y-auto border-r border-line bg-card p-3">
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
          />
        </aside>
        <main className="flex min-w-0 flex-1 items-start justify-center overflow-auto p-6">
          {/* 캔버스는 아직 화면 스코프 전용(BlockPath 인터페이스 유지) — 탭 스코프
              선택은 표시선 없이 트리·인스펙터에만 나타난다. 탭 콘텐츠의 캔버스
              선택·프리뷰 탭 제어는 T2.3에서 배선한다. */}
          <StudioCanvas
            layout={draft}
            screen={screen}
            editing={editing}
            selected={selected?.scope.kind === "screen" ? selected.path : null}
            onSelect={(p) => onSelect(p ? { scope: { kind: "screen" }, path: p } : null)}
            onLogout={onNeedLogin}
          />
        </main>
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-line bg-card p-3">
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
    </div>
  );
}
