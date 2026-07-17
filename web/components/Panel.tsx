"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Status } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { Layout } from "../lib/builder/schema";
import { PanelProvider, usePanel } from "../lib/builder/context";
import ChatFeed from "../lib/builder/blocks/ChatFeed";
import Avatar from "./Avatar";
import ThemeToggle from "./ThemeToggle";
import PerfView from "./PerfView";
import ProfileSheet from "./ProfileSheet";
import SettingsSheet from "./SettingsSheet";
import Sparkline from "./Sparkline";
import TimelineView from "./TimelineView";

type Player = Status["players"][number];

// 공유 상태(탭·접속현황·닉네임·미확인·연결)는 PanelProvider가, 채팅 내부 상태는
// keepMounted인 ChatFeed 블록이 소유한다.
export default function Panel({ onLogout, layout }: { onLogout: () => void; layout: Layout }) {
  return (
    <PanelProvider layout={layout} onLogout={onLogout}>
      <PanelShell />
    </PanelProvider>
  );
}

function PanelShell() {
  const { t } = useI18n();
  const {
    onLogout,
    tab,
    setTab,
    visibleTabs,
    tabPrefs,
    updateTabPrefs,
    status,
    tpsHist,
    up,
    players,
    nick,
    setNick,
    unread,
    connLost,
  } = usePanel();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tpsOpen, setTpsOpen] = useState(false);
  const [playersOpen, setPlayersOpen] = useState(false);
  const [profile, setProfile] = useState<Player | null>(null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 헤더 */}
      <header className="pt-safe flex shrink-0 items-center justify-between px-5 pb-3">
        <h1 className="text-lg font-bold tracking-tight">{t("panel.title")}</h1>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            onClick={() => setSettingsOpen(true)}
            aria-label={t("settings.title")}
            className="grid h-9 w-9 place-items-center rounded-full border border-line bg-card text-muted transition-colors hover:text-fg active:scale-95"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </header>

      {/* 연결 끊김 배너 — 오프라인·서버 무응답 공통 */}
      {connLost && (
        <div className="mx-5 mb-2 shrink-0 rounded-xl border border-line bg-card px-3 py-1.5 text-center text-xs font-medium text-danger">
          {t("panel.connLost")}
        </div>
      )}

      {/* 고정 상태 카드 */}
      <div className="shrink-0 px-5">
        <div className="rounded-2xl border border-line bg-card p-4 shadow-card">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              {up && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
              )}
              <span className={["relative inline-flex h-3 w-3 rounded-full", up ? "bg-accent" : "bg-danger"].join(" ")} />
            </span>
            <div className="flex flex-col">
              <span className="font-semibold">{up ? t("panel.serverOnline") : t("panel.serverOffline")}</span>
              <span className="flex items-center gap-1 text-xs text-muted">
                {up ? (
                  <>
                    TPS {status && status.tps >= 0 ? status.tps.toFixed(1) : "—"}
                    <button
                      onClick={() => setTpsOpen(true)}
                      aria-label={t("panel.tpsInfoAria")}
                      className="grid h-4 w-4 place-items-center rounded-full border border-line text-[10px] leading-none text-muted transition-colors hover:text-fg"
                    >
                      i
                    </button>
                    {tpsHist.length >= 2 && (
                      <span
                        className={status && status.tps < 18 ? "text-danger" : "text-accent"}
                        aria-label={t("panel.tpsTrendAria")}
                      >
                        <Sparkline points={tpsHist} />
                      </span>
                    )}
                  </>
                ) : (
                  t("panel.serverDown")
                )}
              </span>
            </div>
            <button
              onClick={() => setPlayersOpen((v) => !v)}
              className="ml-auto text-right"
              aria-label={t("panel.playersListAria")}
              aria-expanded={playersOpen}
            >
              <div className="text-2xl font-bold tabular-nums text-accent">
                {up ? status?.count ?? 0 : 0}
                <span className="text-base font-semibold text-muted"> / {status?.max ?? 20}</span>
              </div>
              <div className="text-[11px] text-muted">{t("panel.playersLabel")} {up && players.length ? "▾" : ""}</div>
            </button>
          </div>

          <AnimatePresence initial={false}>
            {playersOpen && up && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-3 max-h-40 space-y-1 overflow-y-auto border-t border-line pt-3">
                  {players.length ? (
                    players.map((p) => (
                      <button
                        key={p.uuid || p.name}
                        onClick={() => setProfile(p)}
                        aria-label={t("panel.viewProfileAria", { name: p.name })}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-card2"
                      >
                        <Avatar uuid={p.uuid} name={p.name} px={24} className="rounded" />
                        <span className="text-sm">{p.name}</span>
                        <span className="ml-auto text-xs tabular-nums text-muted">
                          {p.ping >= 0 ? `${p.ping}ms` : "—"}
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="text-sm text-muted">{t("panel.noPlayers")}</div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="px-1 pt-1.5 text-[11px] text-muted">
          {t("panel.peak", { n: status?.max_concurrent ?? 0 })}
        </div>
      </div>

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

      {/* 플레이어 프로필 바텀시트 */}
      <AnimatePresence>
        {profile && (
          <ProfileSheet
            uuid={profile.uuid}
            name={profile.name}
            ping={profile.ping}
            onClose={() => setProfile(null)}
            onLogout={onLogout}
          />
        )}
      </AnimatePresence>

      {/* 설정 시트 — 알림·탭 표시·닉네임 변경·로그아웃 */}
      <AnimatePresence>
        {settingsOpen && (
          <SettingsSheet
            nick={nick}
            onNickChanged={setNick}
            tabPrefs={tabPrefs}
            onTabPrefs={updateTabPrefs}
            onLogout={onLogout}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* TPS 설명 모달 */}
      <AnimatePresence>
        {tpsOpen && (
          <motion.div
            className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setTpsOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[300px] rounded-2xl border border-line bg-card p-5 shadow-card"
            >
              <h2 className="text-base font-bold">{t("tps.title")}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {t("tps.bodyBefore")}
                <span className="font-semibold text-fg">20</span>
                {t("tps.bodyAfter")}
              </p>
              <button
                onClick={() => setTpsOpen(false)}
                className="mt-4 w-full rounded-xl bg-accent py-2.5 text-sm font-bold text-accent-fg active:scale-[0.99]"
              >
                {t("common.confirm")}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
