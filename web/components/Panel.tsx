"use client";

import { useI18n } from "../lib/i18n";
import type { Layout } from "../lib/builder/schema";
import { PanelProvider, usePanel } from "../lib/builder/context";
import ChatFeed from "../lib/builder/blocks/ChatFeed";
import ServerStatus from "../lib/builder/blocks/ServerStatus";
import SettingsButton from "../lib/builder/blocks/SettingsButton";
import ThemeToggle from "./ThemeToggle";
import PerfView from "./PerfView";
import TimelineView from "./TimelineView";

// 공유 상태(탭·접속현황·닉네임·미확인·연결)는 PanelProvider가, 각 영역의 로컬
// 상태(채팅·시트·모달)는 해당 블록이 소유한다.
export default function Panel({ onLogout, layout }: { onLogout: () => void; layout: Layout }) {
  return (
    <PanelProvider layout={layout} onLogout={onLogout}>
      <PanelShell />
    </PanelProvider>
  );
}

function PanelShell() {
  const { t } = useI18n();
  const { onLogout, tab, setTab, visibleTabs, up, unread, connLost } = usePanel();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 헤더 */}
      <header className="pt-safe flex shrink-0 items-center justify-between px-5 pb-3">
        <h1 className="text-lg font-bold tracking-tight">{t("panel.title")}</h1>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <SettingsButton />
        </div>
      </header>

      {/* 연결 끊김 배너 — 오프라인·서버 무응답 공통 */}
      {connLost && (
        <div className="mx-5 mb-2 shrink-0 rounded-xl border border-line bg-card px-3 py-1.5 text-center text-xs font-medium text-danger">
          {t("panel.connLost")}
        </div>
      )}

      <ServerStatus />

      {/* 탭 */}
      <div role="tablist" aria-label={t("panel.tabsAria")} className="mx-4 mt-1 flex shrink-0 gap-1 rounded-2xl bg-card2 p-1">
        {visibleTabs.map((tb) => (
          <button
            key={tb}
            role="tab"
            aria-selected={tab === tb}
            onClick={() => setTab(tb)}
            className={[
              "flex-1 min-h-[44px] rounded-xl text-sm font-medium transition-colors",
              tab === tb ? "bg-card text-fg shadow-card" : "text-muted hover:text-fg",
            ].join(" ")}
          >
            {tb === "chat" ? t("tab.chat") : tb === "perf" ? t("tab.perf") : t("tab.timeline")}
            {tb === "chat" && unread > 0 && tab !== "chat" && (
              <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold tabular-nums text-accent-fg">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "perf" && <PerfView serverUp={up} onLogout={onLogout} />}
      {tab === "timeline" && <TimelineView onLogout={onLogout} />}
      <ChatFeed />
    </div>
  );
}
