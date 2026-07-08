"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  avatarUrl,
  ChatMessage,
  fetchChat,
  fetchChatBefore,
  fetchStatus,
  getMe,
  logout,
  sendChat,
  Status,
  UnauthorizedError,
} from "../lib/api";
import ThemeToggle from "./ThemeToggle";
import PerfView from "./PerfView";
import ProfileSheet from "./ProfileSheet";
import Sparkline from "./Sparkline";
import TimelineView from "./TimelineView";

type Player = Status["players"][number];

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

// 전송 중/실패 상태의 내 메시지(서버 확정 전) — 확정되면 msgs로 옮겨진다
type LocalMsg = { key: number; text: string; status: "pending" | "failed" };

// 확정 메시지 병합: id 기준 중복 제거 + 정렬. 낙관적 확정과 폴링이 같은 메시지를
// 각각 가져와도 한 번만 표시된다.
function mergeMsgs(prev: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (!incoming.length) return prev;
  const ids = new Set(incoming.map((m) => m.id));
  const kept = prev.filter((m) => !ids.has(m.id));
  return [...kept, ...incoming].sort((a, b) => a.id - b.id).slice(-3000);
}

export default function Panel({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<"chat" | "perf" | "timeline">("chat");
  const [status, setStatus] = useState<Status | null>(null);
  const [tpsHist, setTpsHist] = useState<number[]>([]); // 상태 폴링(1분)마다 쌓는 TPS 추세
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [localMsgs, setLocalMsgs] = useState<LocalMsg[]>([]);
  const [nick, setNick] = useState("");
  const sinceRef = useRef(0);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [chatErr, setChatErr] = useState<string | null>(null);
  const [connLost, setConnLost] = useState(false);
  const [tpsOpen, setTpsOpen] = useState(false);
  const [playersOpen, setPlayersOpen] = useState(false);
  const [profile, setProfile] = useState<Player | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const firstRef = useRef(true);
  const [unread, setUnread] = useState(0);
  const tabRef = useRef(tab);
  const savedScrollRef = useRef(0); // 탭 이동 후 복귀 시 스크롤 위치 복원용
  const msgsRef = useRef<ChatMessage[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingOlderRef = useRef(false);
  const hasMoreRef = useRef(true); // 과거 메시지가 더 있는지 (50개 미만 응답 시 소진)

  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);
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
        setMsgs((p) => mergeMsgs(p, r.messages));
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

  // 브라우저 오프라인 신호 — 폴링 실패를 기다리지 않고 즉시 배너 반영
  useEffect(() => {
    const on = () => setConnLost(false);
    const off = () => setConnLost(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // 낙관적 전송 표시에 쓸 내 닉네임 (실패해도 무해 — 폴백 표기)
  useEffect(() => {
    getMe()
      .then((m) => setNick(m.nickname))
      .catch(() => {});
  }, []);

  // 접속현황 폴링 — 1분에 한 번
  useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const s = await fetchStatus();
        if (alive) {
          setStatus(s);
          // 서버가 켜져 있을 때만 추세에 반영 (최근 30포인트 ≈ 30분)
          if (s.server_up && s.tps >= 0) setTpsHist((p) => [...p, s.tps].slice(-30));
        }
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
          if (r.messages.length) {
            setMsgs((p) => mergeMsgs(p, r.messages));
            // 채팅 탭 밖이거나 위로 스크롤해 읽는 중이면 미확인으로 집계
            if (tabRef.current !== "chat" || !atBottomRef.current) {
              setUnread((u) => u + r.messages.length);
            }
          }
        }
        if (alive) setConnLost(false);
      } catch (e) {
        if (e instanceof UnauthorizedError) return onLogout();
        if (alive) setConnLost(true); // 네트워크 단절 등 — 배너 표시, 폴링은 계속 재시도
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

  // 채팅 탭 복귀 시 스크롤 복원 — 맨 아래였으면 다시 맨 아래로, 읽던 중이면 그 위치로
  useEffect(() => {
    if (tab !== "chat") return;
    requestAnimationFrame(() => {
      const el = feedRef.current;
      if (!el) return;
      if (atBottomRef.current) scrollToBottom(false);
      else el.scrollTop = savedScrollRef.current;
    });
  }, [tab]);

  // 낙관적 전송: 보내자마자 피드에 '전송 중'으로 표시하고, 서버가 id를 확정하면
  // 확정 메시지로 승격한다. 실패하면 '실패' 상태로 남겨 재시도할 수 있게 한다.
  // 폴링 커서(sinceRef)는 건드리지 않는다 — 내 메시지와 남 메시지 사이의 id를
  // 건너뛰지 않도록. 중복은 mergeMsgs가 id로 걸러 준다.
  async function send(retry?: LocalMsg) {
    const t = retry ? retry.text : text.trim();
    if (!t || sending) return;
    const key = retry ? retry.key : Date.now();
    atBottomRef.current = true; // 내가 보낸 메시지로 이동
    setSending(true);
    setChatErr(null);
    if (retry) {
      setLocalMsgs((p) => p.map((m) => (m.key === key ? { ...m, status: "pending" } : m)));
    } else {
      setLocalMsgs((p) => [...p, { key, text: t, status: "pending" }]);
      setText("");
    }
    try {
      const r = await sendChat(t);
      setLocalMsgs((p) => p.filter((m) => m.key !== key));
      if (r.id && r.ts) {
        setMsgs((p) =>
          mergeMsgs(p, [{ id: r.id!, ts: r.ts!, source: "web", user: nick || "나", uuid: "", text: t }]),
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
          ? "너무 빨라요. 잠시 후 다시 보내세요."
          : "전송 실패 — 메시지를 눌러 재시도하세요.",
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

      {/* 연결 끊김 배너 — 오프라인·서버 무응답 공통 */}
      {connLost && (
        <div className="mx-5 mb-2 shrink-0 rounded-xl border border-line bg-card px-3 py-1.5 text-center text-xs font-medium text-danger">
          연결이 끊겼습니다 · 자동 재연결 중
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
                    {tpsHist.length >= 2 && (
                      <span
                        className={status && status.tps < 18 ? "text-danger" : "text-accent"}
                        aria-label="최근 TPS 추세"
                      >
                        <Sparkline points={tpsHist} />
                      </span>
                    )}
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
              aria-expanded={playersOpen}
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
                      <button
                        key={p.uuid || p.name}
                        onClick={() => setProfile(p)}
                        aria-label={`${p.name} 프로필 보기`}
                        className="flex w-full items-center gap-2.5 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-card2"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={avatarUrl(p.uuid, p.name)} alt="" width={24} height={24} className="rounded" />
                        <span className="text-sm">{p.name}</span>
                        <span className="ml-auto text-xs tabular-nums text-muted">
                          {p.ping >= 0 ? `${p.ping}ms` : "—"}
                        </span>
                      </button>
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
      <div role="tablist" aria-label="패널 탭" className="flex shrink-0 gap-1 px-4 pt-1">
        {(["chat", "perf", "timeline"] as const).map((tb) => (
          <button
            key={tb}
            role="tab"
            aria-selected={tab === tb}
            onClick={() => setTab(tb)}
            className={[
              "flex-1 rounded-lg py-2 text-sm font-medium transition-colors",
              tab === tb ? "bg-card text-fg shadow-card" : "text-muted hover:text-fg",
            ].join(" ")}
          >
            {tb === "chat" ? "채팅" : tb === "perf" ? "성능" : "타임라인"}
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
        className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 py-2 [-webkit-overflow-scrolling:touch]"
      >
        {loadingOlder && (
          <div className="py-1 text-center text-[11px] text-muted">이전 메시지 불러오는 중…</div>
        )}
        {msgs.length === 0 && localMsgs.length === 0 ? (
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
        {/* 전송 중/실패한 내 메시지 — 확정 전까지 피드 맨 아래에 표시 */}
        {localMsgs.map((m) => (
          <motion.div
            key={`local-${m.key}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className={["flex items-start gap-2.5", m.status === "pending" ? "opacity-60" : ""].join(" ")}
          >
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded bg-card2 text-sm font-bold text-muted">
              {(nick || "나").charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-semibold">{nick || "나"}</span>
                <span className="rounded bg-card2 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">웹</span>
                <span className="ml-auto shrink-0 text-[10px] text-muted">
                  {m.status === "pending" ? "전송 중…" : ""}
                </span>
              </div>
              <div className="whitespace-pre-wrap break-words text-sm text-fg">{m.text}</div>
              {m.status === "failed" && (
                <button
                  onClick={() => send(m)}
                  className="mt-0.5 flex items-center gap-1 text-xs font-medium text-danger"
                >
                  <RetryIcon />
                  전송 실패 · 재시도
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
          aria-label="새 메시지로 이동"
          className="absolute bottom-16 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-card px-3 py-1.5 text-xs font-semibold text-accent shadow-card active:scale-95"
        >
          <DownIcon />
          새 메시지 <span className="tabular-nums">{unread > 99 ? "99+" : unread}</span>
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
            aria-label="채팅 메시지 입력"
            placeholder="메시지를 입력하세요"
            className="min-w-0 flex-1 rounded-full border border-line bg-card px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
          <button
            onClick={() => send()}
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
