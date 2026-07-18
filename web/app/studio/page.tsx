"use client";

// /studio — 관리자 전용 SDUI 시각 편집기 진입점. 정적 익스포트이므로 가드는 전부
// 클라이언트에서: 토큰 없음 → 로그인 안내, 비관리자 → 권한 안내, 좁은 뷰포트(<768px)
// → 데스크톱 안내. 통과 시 서버 레이아웃과 로컬 드래프트(검증 실패 시 무시)를 합쳐
// StudioApp을 띄운다. 발행 권한 판정은 어차피 서버가 한다 — 가드는 UX용이다.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getLayout, getMe, getToken, UnauthorizedError } from "../../lib/api";
import type { Layout } from "../../lib/builder/schema";
import { keyedBlocks, keyedScreen } from "../../lib/builder/studioTree";
import { loadDraft } from "../../lib/builder/studioDraft";
import { useI18n } from "../../lib/i18n";
import StudioApp from "../../components/studio/StudioApp";

type Stage = "checking" | "noToken" | "denied" | "error" | "ready";

// 편집 대상 레이아웃 정규화 — key 없는 노드에 key를 부여해 두어 재배치 시 React
// 상태가 엉키지 않게 한다(기존 key는 보존). 화면 트리와 각 탭 content(스코프 편집
// 대상) 모두에 적용하고, content 없는 탭은 그대로 둔다(기본 매핑 폴백·유령 표기 유지).
function normalize(l: Layout): Layout {
  const out: Layout = { ...l };
  if (l.screen) out.screen = keyedScreen(l.screen);
  if (l.tabs) {
    out.tabs = l.tabs.map((tb) =>
      tb.content?.length ? { ...tb, content: keyedBlocks(tb.content) } : tb,
    );
  }
  return out;
}

function GuardCard({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-card p-6 text-center shadow-card">
        <h1 className="mb-2 text-base font-bold text-fg">{title}</h1>
        <p className="mb-4 text-sm text-muted">{body}</p>
        {action}
      </div>
    </div>
  );
}

// 로딩 스켈레톤 — 3패널 실루엣(시각) + 스크린리더용 문구.
function Skeleton() {
  const { t } = useI18n();
  return (
    <div className="flex h-screen flex-col bg-bg" aria-busy="true">
      <span className="sr-only" role="status">
        {t("studio.loading")}
      </span>
      <div className="h-11 shrink-0 animate-pulse border-b border-line bg-card" />
      <div className="flex min-h-0 flex-1">
        <div className="w-60 shrink-0 animate-pulse border-r border-line bg-card" />
        <div className="flex flex-1 items-start justify-center p-6">
          <div className="h-[780px] w-[390px] animate-pulse rounded-[2rem] bg-card2" />
        </div>
        <div className="w-80 shrink-0 animate-pulse border-l border-line bg-card" />
      </div>
    </div>
  );
}

export default function Studio() {
  const { t } = useI18n();
  const [stage, setStage] = useState<Stage>("checking");
  const [initial, setInitial] = useState<Layout | null>(null);
  // SSG 프리렌더에는 뷰포트가 없다 — null(미확정) 동안은 스켈레톤만 그린다.
  const [wide, setWide] = useState<boolean | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const resolve = useCallback(async () => {
    setStage("checking");
    if (!getToken()) {
      setStage("noToken");
      return;
    }
    try {
      const me = await getMe();
      if (!me.admin) {
        setStage("denied");
        return;
      }
      // 드래프트가 있으면(검증 통과 시) 이어서 편집, 없으면 서버 발행본에서 시작.
      const server = await getLayout();
      setInitial(normalize(loadDraft() ?? server));
      setStage("ready");
    } catch (e) {
      setStage(e instanceof UnauthorizedError ? "noToken" : "error");
    }
  }, []);

  useEffect(() => {
    resolve();
  }, [resolve]);

  if (wide === false) {
    return (
      <GuardCard title={t("studio.guard.desktopTitle")} body={t("studio.guard.desktopBody")} />
    );
  }
  if (wide === null || stage === "checking") return <Skeleton />;

  if (stage === "noToken") {
    return (
      <GuardCard
        title={t("studio.guard.loginTitle")}
        body={t("studio.guard.loginBody")}
        action={
          <Link
            href="/"
            className="inline-block rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:opacity-90"
          >
            {t("studio.guard.goPanel")}
          </Link>
        }
      />
    );
  }
  if (stage === "denied") {
    return (
      <GuardCard
        title={t("studio.guard.deniedTitle")}
        body={t("studio.guard.deniedBody")}
        action={
          <Link
            href="/"
            className="inline-block rounded-xl border border-line px-4 py-2 text-sm font-medium text-fg hover:bg-card2"
          >
            {t("studio.guard.goPanel")}
          </Link>
        }
      />
    );
  }
  if (stage === "error" || !initial) {
    return (
      <GuardCard
        title={t("studio.guard.errorTitle")}
        body={t("studio.guard.errorBody")}
        action={
          <button
            type="button"
            onClick={resolve}
            className="rounded-xl border border-line px-4 py-2 text-sm font-medium text-fg hover:bg-card2"
          >
            {t("studio.guard.retry")}
          </button>
        }
      />
    );
  }

  return <StudioApp initial={initial} onNeedLogin={() => setStage("noToken")} />;
}
