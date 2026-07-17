"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChatMessage,
  fetchChat,
  fetchChatBefore,
  sendChat,
  Status,
  UnauthorizedError,
} from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { Layout } from "../lib/builder/schema";
import { PanelProvider, usePanel } from "../lib/builder/context";
import Avatar from "./Avatar";
import ThemeToggle from "./ThemeToggle";
import PerfView from "./PerfView";
import ProfileSheet from "./ProfileSheet";
import SettingsSheet from "./SettingsSheet";
import Sparkline from "./Sparkline";
import TimelineView from "./TimelineView";

type Player = Status["players"][number];

const CHAT_MS = 2000;

const SRC: Record<ChatMessage["source"], { labelKey: string; cls: string }> = {
  game: { labelKey: "chat.sourceGame", cls: "bg-card2 text-accent" },
  discord: { labelKey: "chat.sourceDiscord", cls: "bg-card2 text-indigo-400" },
  web: { labelKey: "chat.sourceWeb", cls: "bg-card2 text-amber-500" },
};

function hhmm(ts: number) {
  const d = new Date(ts);
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 전송 중/실패 상태의 내 메시지(서버 확정 전) — 확정되면 msgs로 옮겨진다
type LocalMsg = { key: number; text: string; status: "pending" | "failed" };

// 확정 메시지 병합: id 기준 중복 제거 + 정렬. 낙관적 확정과 폴링이 같은 메시지를
// 각각 가져와도 한 번만 표시된다. capTail=false면 최신 3000개 자르기를 건너뛴다 —
// 과거 로딩(loadOlder)이 붙인 옛 메시지가 곧바로 잘려 나가 스크롤이 제자리걸음하지 않도록.
function mergeMsgs(prev: ChatMessage[], incoming: ChatMessage[], capTail = true): ChatMessage[] {
  if (!incoming.length) return prev;
  const ids = new Set(incoming.map((m) => m.id));
  const kept = prev.filter((m) => !ids.has(m.id));
  const merged = [...kept, ...incoming].sort((a, b) => a.id - b.id);
  return capTail ? merged.slice(-3000) : merged;
}

// 공유 상태(탭·접속현황·닉네임·미확인·연결)는 PanelProvider가, 채팅 내부 상태는
// 셸이 소유한다(추후 ChatFeed 블록으로 이동 예정).
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
    tabRef,
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
    setUnread,
    connLost,
    setConnLost,
  } = usePanel();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [localMsgs, setLocalMsgs] = useState<LocalMsg[]>([]);
  const sinceRef = useRef(0);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [chatErr, setChatErr] = useState<string | null>(null);
  const [chatLoaded, setChatLoaded] = useState(false); // 첫 채팅 응답 도착 여부(스켈레톤 해제)
  const [tpsOpen, setTpsOpen] = useState(false);
  const [playersOpen, setPlayersOpen] = useState(false);
  const [profile, setProfile] = useState<Player | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const firstRef = useRef(true);
  const savedScrollRef = useRef(0); // 탭 이동 후 복귀 시 스크롤 위치 복원용
  const msgsRef = useRef<ChatMessage[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingOlderRef = useRef(false);
  const hasMoreRef = useRef(true); // 과거 메시지가 더 있는지 (50개 미만 응답 시 소진)

  useEffect(() => {
    msgsRef.current = msgs;
  }, [msgs]);

  // 과거 메시지 로딩 — 프리펜드 후 scrollHeight 차이만큼 보정해 읽던 위치를 유지
  async function loadOlder() {
    const first = msgsRef.current[0];
    if (!first || loadingOlderRef.current || !hasMoreRef.current) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const r = await fetchChatBefore(first.id);
      if (r.messages.length < 50) hasMoreRef.current = false;
      if (r.messages.length) {
        const el = feedRef.current;
        const prevH = el?.scrollHeight ?? 0;
        setMsgs((p) => mergeMsgs(p, r.messages, false));
        requestAnimationFrame(() => {
          const el2 = feedRef.current;
          if (el2) el2.scrollTop += el2.scrollHeight - prevH;
        });
      }
    } catch (e) {
      if (e instanceof UnauthorizedError) return onLogout();
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }

  function onFeedScroll() {
    const el = feedRef.current;
    if (!el) return;
    savedScrollRef.current = el.scrollTop;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottomRef.current) setUnread(0);
    if (el.scrollTop < 60) loadOlder(); // 맨 위 근처 — 과거 메시지 로딩
  }
  function scrollToBottom(smooth = true) {
    requestAnimationFrame(() => {
      const el = feedRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    });
  }

  // 채팅 폴링 — 2초마다 증분
  useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await fetchChat(sinceRef.current);
        if (alive && r.last_id > sinceRef.current) {
          sinceRef.current = r.last_id;
          if (r.messages.length) {
            setMsgs((p) => mergeMsgs(p, r.messages));
            // 채팅 탭 밖이거나 위로 스크롤해 읽는 중이면 미확인으로 집계
            if (tabRef.current !== "chat" || !atBottomRef.current) {
              setUnread((u) => u + r.messages.length);
            }
          }
        }
        if (alive) setConnLost(false);
        if (alive) setChatLoaded(true); // 첫 응답 도착 — 스켈레톤 해제
      } catch (e) {
        if (e instanceof UnauthorizedError) return onLogout();
        if (alive) setConnLost(true); // 네트워크 단절 등 — 배너 표시, 폴링은 계속 재시도
        if (alive) setChatLoaded(true); // 실패해도 스켈레톤 무한 방지
      }
      if (alive) t = setTimeout(tick, CHAT_MS);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [onLogout]);

  // 피드를 최신 메시지에 고정한다. 단 사용자가 이미 맨 아래에 있을 때만 — 위로 올려
  // 기록을 읽는 중에 새 메시지가 와도 아래로 끌려 내려가지 않도록.
  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false;
      scrollToBottom(false);
    } else if (tabRef.current === "chat" && atBottomRef.current) {
      scrollToBottom(true);
    }
  }, [msgs, localMsgs]);

  // 채팅 탭 복귀 시 스크롤 복원 — 맨 아래였으면 다시 맨 아래로, 읽던 중이면 그 위치로.
  // 맨 아래 복귀는 스크롤 이벤트가 발생하지 않으므로 미확인 수도 여기서 초기화한다.
  useEffect(() => {
    if (tab !== "chat") return;
    requestAnimationFrame(() => {
      const el = feedRef.current;
      if (!el) return;
      if (atBottomRef.current) {
        scrollToBottom(false);
        setUnread(0);
      } else el.scrollTop = savedScrollRef.current;
    });
  }, [tab]);

  // 낙관적 전송: 보내자마자 피드에 '전송 중'으로 표시하고, 서버가 id를 확정하면
  // 확정 메시지로 승격한다. 실패하면 '실패' 상태로 남겨 재시도할 수 있게 한다.
  // 폴링 커서(sinceRef)는 건드리지 않는다 — 내 메시지와 남 메시지 사이의 id를
  // 건너뛰지 않도록. 중복은 mergeMsgs가 id로 걸러 준다.
  async function send(retry?: LocalMsg) {
    const txt = retry ? retry.text : text.trim();
    if (!txt || sending) return;
    const key = retry ? retry.key : Date.now();
    atBottomRef.current = true; // 내가 보낸 메시지로 이동
    setSending(true);
    setChatErr(null);
    if (retry) {
      setLocalMsgs((p) => p.map((m) => (m.key === key ? { ...m, status: "pending" } : m)));
    } else {
      setLocalMsgs((p) => [...p, { key, text: txt, status: "pending" }]);
      setText("");
    }
    try {
      const r = await sendChat(txt);
      setLocalMsgs((p) => p.filter((m) => m.key !== key));
      if (r.id && r.ts) {
        setMsgs((p) =>
          mergeMsgs(p, [{ id: r.id!, ts: r.ts!, source: "web", user: nick || t("chat.me"), uuid: "", text: txt }]),
        );
      } else {
        // 데모 등 id 미반환 응답 — 즉시 재폴링으로 반영
        const rr = await fetchChat(sinceRef.current);
        if (rr.last_id > sinceRef.current) {
          sinceRef.current = rr.last_id;
          if (rr.messages.length) setMsgs((p) => mergeMsgs(p, rr.messages));
        }
      }
    } catch (e) {
      if (e instanceof UnauthorizedError) return onLogout();
      setLocalMsgs((p) => p.map((m) => (m.key === key ? { ...m, status: "failed" } : m)));
      setChatErr(
        e instanceof Error && e.message === "slow_down"
          ? t("chat.errSlowDown")
          : t("chat.errSendFailed"),
      );
    } finally {
      setSending(false);
    }
  }

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
      {/* 채팅은 탭을 떠나도 마운트 유지(hidden) — 스크롤 위치·입력 중 텍스트 보존 */}
      <div className={["relative flex min-h-0 flex-1 flex-col", tab === "chat" ? "" : "hidden"].join(" ")}>
      {/* 채팅 피드 */}
      <div
        ref={feedRef}
        onScroll={onFeedScroll}
        className="mt-2 min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-2 [-webkit-overflow-scrolling:touch]"
      >
        {loadingOlder && (
          <div className="py-1 text-center text-[11px] text-muted">{t("chat.loadingOlder")}</div>
        )}
        {msgs.length === 0 && localMsgs.length === 0 ? (
          !chatLoaded ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <div className="h-8 w-8 shrink-0 rounded bg-line motion-safe:animate-pulse" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="h-3 w-24 rounded bg-line motion-safe:animate-pulse" />
                    <div className={["h-3 rounded bg-line motion-safe:animate-pulse", i % 2 ? "w-40" : "w-56"].join(" ")} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid h-full place-items-center text-sm text-muted">{t("chat.empty")}</div>
          )
        ) : (
          msgs.map((m, i) => {
            const meta = SRC[m.source] ?? SRC.web;
            return (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className={["flex items-start gap-2.5", i > 0 && msgs[i - 1].source !== m.source ? "mt-1.5" : ""].filter(Boolean).join(" ")}
              >
                {m.source === "game" ? (
                  <Avatar uuid={m.uuid} name={m.user} px={32} className="mt-0.5 rounded" />
                ) : (
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded bg-card2 text-sm font-bold text-muted">
                    {(m.user || "?").charAt(0).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">{m.user}</span>
                    <span className={["rounded px-1.5 py-0.5 text-[11px] font-medium", meta.cls].join(" ")}>
                      {t(meta.labelKey)}
                    </span>
                    <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted">{hhmm(m.ts)}</span>
                  </div>
                  <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-fg">{m.text}</div>
                </div>
              </motion.div>
            );
          })
        )}
        {/* 전송 중/실패한 내 메시지 — 확정 전까지 피드 맨 아래에 표시 */}
        {localMsgs.map((m) => (
          <motion.div
            key={`local-${m.key}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className={["flex items-start gap-2.5", m.status === "pending" ? "opacity-60" : ""].join(" ")}
          >
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded bg-card2 text-sm font-bold text-muted">
              {(nick || t("chat.me")).charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-semibold">{nick || t("chat.me")}</span>
                <span className="rounded bg-card2 px-1.5 py-0.5 text-[11px] font-medium text-amber-500">{t("chat.sourceWeb")}</span>
                <span className="ml-auto shrink-0 text-[11px] text-muted">
                  {m.status === "pending" ? t("chat.pending") : ""}
                </span>
              </div>
              <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-fg">{m.text}</div>
              {m.status === "failed" && (
                <button
                  onClick={() => send(m)}
                  className="mt-0.5 flex items-center gap-1 text-xs font-medium text-danger"
                >
                  <RetryIcon />
                  {t("chat.retry")}
                </button>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {/* 새 메시지 점프 버튼 — 위로 스크롤해 읽는 중 새 메시지가 오면 표시 */}
      {unread > 0 && (
        <button
          onClick={() => {
            setUnread(0);
            atBottomRef.current = true;
            scrollToBottom(true);
          }}
          aria-label={t("chat.jumpAria")}
          className="absolute bottom-16 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-card px-3 py-1.5 text-xs font-semibold text-accent shadow-card active:scale-95"
        >
          <DownIcon />
          {t("chat.newMessages")} <span className="tabular-nums">{unread > 99 ? "99+" : unread}</span>
        </button>
      )}

      {/* 입력창 */}
      <div className="pb-safe shrink-0 border-t border-line bg-bg px-4 pt-2">
        {chatErr && <div className="pb-1 text-xs text-danger">{chatErr}</div>}
        <div className="flex items-center gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // 한글 IME 조합 확정 Enter(keyCode 229)는 무시 — 마지막 글자 유실·이중 전송 방지
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter") send();
            }}
            onFocus={() => {
              atBottomRef.current = true;
              setTimeout(() => scrollToBottom(false), 300); // 키보드가 안정된 뒤
            }}
            maxLength={256}
            aria-label={t("chat.inputAria")}
            placeholder={t("chat.placeholder")}
            className="min-w-0 flex-1 rounded-full border border-line bg-card px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
          <button
            onClick={() => send()}
            disabled={sending || !text.trim()}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-accent-fg transition active:scale-95 disabled:opacity-40"
            aria-label={t("chat.sendAria")}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 11.5 21 3l-8.5 18-2.2-7.3L3 11.5Z" />
            </svg>
          </button>
        </div>
      </div>
      </div>

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

// ── 인라인 SVG 아이콘 (이모지 없음) ──────────────────────────────────────────
function DownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <path d="M12 5v14m0 0l-6-6m6 6l6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 12a8 8 0 1 1 2.3 5.6M4 20v-5h5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
