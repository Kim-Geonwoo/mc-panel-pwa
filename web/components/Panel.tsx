"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  avatarUrl,
  ChatMessage,
  fetchChat,
  fetchStatus,
  logout,
  sendChat,
  Status,
  UnauthorizedError,
} from "../lib/api";
import ThemeToggle from "./ThemeToggle";
import PerfView from "./PerfView";
import TimelineView from "./TimelineView";

const STATUS_MS = 60000; // 접속현황 갱신: 1분
const CHAT_MS = 2000;

const SRC: Record<ChatMessage["source"], { label: string; cls: string }> = {
  game: { label: "게임", cls: "bg-card2 text-accent" },
  discord: { label: "디스코드", cls: "bg-card2 text-indigo-400" },
  web: { label: "웹", cls: "bg-card2 text-amber-500" },
};

function hhmm(ts: number) {
  const d = new Date(ts);
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function Panel({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<"chat" | "perf" | "timeline">("chat");
  const [status, setStatus] = useState<Status | null>(null);
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const sinceRef = useRef(0);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [chatErr, setChatErr] = useState<string | null>(null);
  const [tpsOpen, setTpsOpen] = useState(false);
  const [playersOpen, setPlayersOpen] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const firstRef = useRef(true);

  function onFeedScroll() {
    const el = feedRef.current;
    if (el) atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }
  function scrollToBottom(smooth = true) {
    requestAnimationFrame(() => {
      const el = feedRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    });
  }

  // 접속현황 폴링 — 1분에 한 번
  useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const s = await fetchStatus();
        if (alive) setStatus(s);
      } catch (e) {
        if (e instanceof UnauthorizedError) return onLogout();
      }
      if (alive) t = setTimeout(tick, STATUS_MS);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [onLogout]);

  // 채팅 폴링 — 2초마다 증분
  useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await fetchChat(sinceRef.current);
        if (alive && r.last_id > sinceRef.current) {
          sinceRef.current = r.last_id;
          if (r.messages.length) setMsgs((p) => [...p, ...r.messages].slice(-300));
        }
      } catch (e) {
        if (e instanceof UnauthorizedError) return onLogout();
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
    } else if (atBottomRef.current) {
      scrollToBottom(true);
    }
  }, [msgs]);

  async function send() {
    const t = text.trim();
    if (!t || sending) return;
    atBottomRef.current = true; // 내가 보낸 메시지로 이동
    setSending(true);
    setChatErr(null);
    try {
      await sendChat(t);
      setText("");
      const r = await fetchChat(sinceRef.current);
      if (r.last_id > sinceRef.current) {
        sinceRef.current = r.last_id;
        if (r.messages.length) setMsgs((p) => [...p, ...r.messages].slice(-300));
      }
    } catch (e) {
      if (e instanceof UnauthorizedError) return onLogout();
      setChatErr(
        e instanceof Error && e.message === "slow_down"
          ? "너무 빨라요. 잠시 후 다시 보내세요."
          : "전송 실패",
      );
    } finally {
      setSending(false);
    }
  }

  const up = status?.server_up ?? false;
  const players = status?.players ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 헤더 */}
      <header className="pt-safe flex shrink-0 items-center justify-between px-5 pb-3">
        <h1 className="text-lg font-bold tracking-tight">마크서버</h1>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            onClick={async () => {
              await logout();
              onLogout();
            }}
            className="rounded-full border border-line bg-card px-3.5 py-2 text-xs font-medium text-muted transition-colors hover:text-fg active:scale-95"
          >
            로그아웃
          </button>
        </div>
      </header>

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
              <span className="font-semibold">{up ? "서버 온라인" : "서버 오프라인"}</span>
              <span className="flex items-center gap-1 text-xs text-muted">
                {up ? (
                  <>
                    TPS {status && status.tps >= 0 ? status.tps.toFixed(1) : "—"}
                    <button
                      onClick={() => setTpsOpen(true)}
                      aria-label="TPS 설명"
                      className="grid h-4 w-4 place-items-center rounded-full border border-line text-[10px] leading-none text-muted transition-colors hover:text-fg"
                    >
                      i
                    </button>
                  </>
                ) : (
                  "현재 서버가 꺼져 있습니다"
                )}
              </span>
            </div>
            <button
              onClick={() => setPlayersOpen((v) => !v)}
              className="ml-auto text-right"
              aria-label="접속자 목록"
            >
              <div className="text-2xl font-bold tabular-nums text-accent">
                {up ? status?.count ?? 0 : 0}
                <span className="text-base font-semibold text-muted"> / {status?.max ?? 20}</span>
              </div>
              <div className="text-[11px] text-muted">접속자 {up && players.length ? "▾" : ""}</div>
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
                      <div key={p.uuid || p.name} className="flex items-center gap-2.5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={avatarUrl(p.uuid, p.name)} alt="" width={24} height={24} className="rounded" />
                        <span className="text-sm">{p.name}</span>
                        <span className="ml-auto text-xs tabular-nums text-muted">
                          {p.ping >= 0 ? `${p.ping}ms` : "—"}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-muted">아무도 접속해 있지 않습니다</div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="px-1 pt-1.5 text-[11px] text-muted">
          역대 최대 동시접속 {status?.max_concurrent ?? 0}명 · 현황 1분마다 갱신
        </div>
      </div>

      {/* 탭 */}
      <div className="flex shrink-0 gap-1 px-4 pt-1">
        {(["chat", "perf", "timeline"] as const).map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            className={[
              "flex-1 rounded-lg py-2 text-sm font-medium transition-colors",
              tab === tb ? "bg-card text-fg shadow-card" : "text-muted hover:text-fg",
            ].join(" ")}
          >
            {tb === "chat" ? "채팅" : tb === "perf" ? "성능" : "타임라인"}
          </button>
        ))}
      </div>

      {tab === "perf" ? (
        <PerfView serverUp={up} onLogout={onLogout} />
      ) : tab === "timeline" ? (
        <TimelineView onLogout={onLogout} />
      ) : (
        <>
      {/* 채팅 피드 */}
      <div
        ref={feedRef}
        onScroll={onFeedScroll}
        className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 py-2 [-webkit-overflow-scrolling:touch]"
      >
        {msgs.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-muted">아직 채팅이 없습니다</div>
        ) : (
          msgs.map((m) => {
            const meta = SRC[m.source] ?? SRC.web;
            return (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-start gap-2.5"
              >
                {m.source === "game" ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={avatarUrl(m.uuid, m.user)} alt="" width={32} height={32} className="mt-0.5 rounded" />
                ) : (
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded bg-card2 text-sm font-bold text-muted">
                    {(m.user || "?").charAt(0).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">{m.user}</span>
                    <span className={["rounded px-1.5 py-0.5 text-[10px] font-medium", meta.cls].join(" ")}>
                      {meta.label}
                    </span>
                    <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted">{hhmm(m.ts)}</span>
                  </div>
                  <div className="whitespace-pre-wrap break-words text-sm text-fg">{m.text}</div>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

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
            placeholder="메시지를 입력하세요"
            className="min-w-0 flex-1 rounded-full border border-line bg-card px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
          <button
            onClick={send}
            disabled={sending || !text.trim()}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-accent-fg transition active:scale-95 disabled:opacity-40"
            aria-label="전송"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 11.5 21 3l-8.5 18-2.2-7.3L3 11.5Z" />
            </svg>
          </button>
        </div>
      </div>
        </>
      )}

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
              <h2 className="text-base font-bold">TPS란?</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                TPS(Ticks Per Second)는 서버가 1초에 처리하는 게임 틱 수입니다. 정상값은{" "}
                <span className="font-semibold text-fg">20</span>이며, 값이 낮을수록 서버가 버거운
                상태(렉)를 의미합니다.
              </p>
              <button
                onClick={() => setTpsOpen(false)}
                className="mt-4 w-full rounded-xl bg-accent py-2.5 text-sm font-bold text-accent-fg active:scale-[0.99]"
              >
                확인
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
