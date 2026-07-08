"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  fetchTimeline,
  fetchStatus,
  TimelineEvent,
  UnauthorizedError,
  avatarUrl,
} from "../lib/api";

const POLL_MS = 3000; // 데이터(이력 + 현재 접속자) 폴링
const CLOCK_MS = 30000; // 상대시간 갱신 전용 틱(폴링과 분리 → 라이브가 멈춰 보이지 않음)
const INITIAL_DAYS = 7; // 처음 보여줄 날짜 수("더 보기"로 확장)

// ── 시간 헬퍼 (표시 문자열은 ts_kst를 신뢰; 자체 시간대 변환 금지) ─────────────
const dayKey = (kst: string) => kst.slice(0, 10); // "YYYY-MM-DD"
const hm = (kst: string) => kst.slice(11, 16); // "HH:MM"
const md = (kst: string) => `${+kst.slice(5, 7)}/${+kst.slice(8, 10)}`; // "6/20"

function fmtDur(ms: number): string {
  if (ms < 60000) return "1분 미만";
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}시간 ${m % 60}분` : `${m}분`;
}

// now(epoch) 기준 KST 날짜키 — toISOString(UTC)에 +9h 더해 날짜만 취함(라이브러리 불필요)
const kstDayKey = (epoch: number) => new Date(epoch + 9 * 3600e3).toISOString().slice(0, 10);
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
function dayLabel(key: string, todayKey: string, yestKey: string): string {
  if (key === todayKey) return "오늘";
  if (key === yestKey) return "어제";
  const d = new Date(key + "T00:00:00Z");
  return `${+key.slice(5, 7)}월 ${+key.slice(8, 10)}일 (${WEEK[d.getUTCDay()]})`;
}

// ── 세션 모델 ───────────────────────────────────────────────────────────────
type Session = {
  key: string;
  uuid: string;
  name: string;
  start: TimelineEvent | null; // null = 시작 미상(고아 leave)
  end: TimelineEvent | null; // null = 진행중 또는 종료 미상
  inProgress: boolean; // 열린 세션 + 현재 접속 중
  isFirst: boolean;
};
type DayBucket = { key: string; sessions: Session[] };

// join/leave 이벤트를 uuid별로 페어링해 세션으로. (uuid,ts) 정렬 후 스택 매칭.
function buildSessions(events: TimelineEvent[], online: Set<string>): Session[] {
  const sorted = [...events].sort((a, b) =>
    a.uuid === b.uuid ? a.ts - b.ts : a.uuid < b.uuid ? -1 : 1,
  );
  const out: Session[] = [];
  let open: TimelineEvent | null = null;
  let cur = "";
  const emit = (s: TimelineEvent | null, e: TimelineEvent | null, trailing: boolean) => {
    const uuid = (s ?? e)!.uuid;
    const inProgress = trailing && !!s && online.has(uuid);
    out.push({
      key: `${(s ?? e)!.id}-${e ? e.id : "open"}`,
      uuid,
      name: (s ?? e)!.name,
      start: s,
      end: e,
      inProgress,
      isFirst: !!s && s.is_first,
    });
  };
  for (const ev of sorted) {
    if (ev.uuid !== cur) {
      if (open) emit(open, null, true); // 직전 uuid의 열린 세션 마감
      open = null;
      cur = ev.uuid;
    }
    if (ev.event === "join") {
      if (open) emit(open, null, false); // 연속 join → 앞 세션은 종료 미상
      open = ev;
    } else {
      if (open) {
        emit(open, ev, false);
        open = null;
      } else {
        emit(null, ev, false); // 고아 leave
      }
    }
  }
  if (open) emit(open, null, true);
  return out;
}

export default function TimelineView({ onLogout }: { onLogout: () => void }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [online, setOnline] = useState<{ uuid: string; name: string }[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [err, setErr] = useState(false);
  const [visibleDays, setVisibleDays] = useState(INITIAL_DAYS);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const seen = useRef<Set<number>>(new Set()); // 진입 애니를 신규 카드에만

  // 데이터 폴링: 이력 + 현재 접속자. id 기반 merge(prepend 효과 — 전체 리마운트 금지).
  useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const [tl, st] = await Promise.all([fetchTimeline(), fetchStatus()]);
        if (!alive) return;
        setEvents((prev) => {
          if (!prev) return tl.events;
          const byId = new Map(prev.map((e) => [e.id, e]));
          for (const e of tl.events) byId.set(e.id, e);
          return [...byId.values()];
        });
        setOnline(st.server_up ? st.players.map((p) => ({ uuid: p.uuid, name: p.name })) : []);
        setErr(false);
      } catch (e) {
        if (e instanceof UnauthorizedError) return onLogout();
        if (alive) setErr(true);
      }
      if (alive) t = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [onLogout]);

  // 상대시간/날짜경계 갱신 전용 30초 틱(폴링과 분리)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(id);
  }, []);

  const onlineSet = useMemo(() => new Set(online.map((o) => o.uuid)), [online]);

  // 날짜 → 유저별 세션 카드로 가공
  const days = useMemo<DayBucket[]>(() => {
    if (!events) return [];
    const sessions = buildSessions(events, onlineSet);
    const map = new Map<string, Session[]>();
    for (const s of sessions) {
      const anchor = s.start ?? s.end;
      if (!anchor) continue;
      const k = dayKey(anchor.ts_kst);
      (map.get(k) ?? map.set(k, []).get(k)!).push(s);
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, ss]) => ({ key, sessions: ss }));
  }, [events, onlineSet]);

  const todayKey = kstDayKey(now);
  const yestKey = kstDayKey(now - 86400e3);

  // 온라인 칩의 "N분째" — 진행중 세션의 시작시각 기준
  const onlineSince = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of days)
      for (const s of d.sessions)
        if (s.inProgress && s.start) m.set(s.uuid, s.start.ts);
    return m;
  }, [days]);

  if (!events) {
    return (
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-2xl border border-line bg-card2 p-3">
            <div className="h-9 w-9 animate-pulse rounded-xl bg-line" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-24 animate-pulse rounded bg-line" />
              <div className="h-2.5 w-32 animate-pulse rounded bg-line" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const visible = days.slice(0, visibleDays);

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-2">
      {/* 헤더: 시간대 1회만 명시 */}
      <div className="flex items-center justify-between px-1">
        <div className="text-sm font-semibold text-fg">접속 타임라인</div>
        <div className="text-xs font-medium text-muted">시간 KST</div>
      </div>

      {/* L0 지금 온라인 */}
      <div className="rounded-2xl border border-line bg-card p-3 shadow-card">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted">
          <span className={["relative inline-flex h-2 w-2 rounded-full", online.length ? "bg-accent" : "bg-line"].join(" ")}>
            {online.length > 0 && <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-60" />}
          </span>
          지금 온라인 · {online.length}명
        </div>
        {online.length === 0 ? (
          <div className="text-sm text-muted">접속 중인 플레이어가 없습니다.</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {online.map((o) => {
              const since = onlineSince.get(o.uuid);
              return (
                <div key={o.uuid} className="flex items-center gap-1.5 rounded-full border border-line bg-card2 py-1 pl-1 pr-2.5">
                  <img src={avatarUrl(o.uuid, o.name)} alt="" className="h-6 w-6 rounded-lg" />
                  <span className="text-xs font-medium text-fg">{o.name}</span>
                  {since != null && (
                    <span className="tabular-nums text-[11px] text-muted">{fmtDur(now - since)}째</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 본문 타임라인 */}
      {days.length === 0 ? (
        <div className="grid flex-1 place-items-center px-8 py-10 text-center text-sm leading-relaxed text-muted">
          <div>
            <ClockIcon />
            <div className="mt-3">아직 접속 기록이 없어요.</div>
            <div className="mt-0.5 text-xs">새 접속이 생기면 여기에 표시됩니다.</div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((day) => {
            const byUser = new Map<string, Session[]>();
            for (const s of day.sessions) (byUser.get(s.uuid) ?? byUser.set(s.uuid, []).get(s.uuid)!).push(s);
            const cards = [...byUser.entries()].sort((a, b) => {
              const ap = a[1].some((s) => s.inProgress) ? 1 : 0;
              const bp = b[1].some((s) => s.inProgress) ? 1 : 0;
              if (ap !== bp) return bp - ap; // 진행중 유저 위로
              const al = Math.max(...a[1].map((s) => s.start?.ts ?? s.end?.ts ?? 0));
              const bl = Math.max(...b[1].map((s) => s.start?.ts ?? s.end?.ts ?? 0));
              return bl - al;
            });
            const isPast = day.key !== todayKey && day.key !== yestKey;
            // 일별 요약: 유니크 유저 수 · 접속 횟수 · 총 플레이시간(진행중 세션 포함)
            const uniq = new Set(day.sessions.map((s) => s.uuid)).size;
            const joins = day.sessions.filter((s) => s.start).length;
            const totalMs = day.sessions.reduce((acc, s) => {
              if (s.start && s.end) return acc + (s.end.ts - s.start.ts);
              if (s.inProgress && s.start) return acc + (now - s.start.ts);
              return acc;
            }, 0);
            return (
              <div key={day.key} className="space-y-2">
                <div className="sticky top-0 z-10 flex items-center gap-2 bg-bg py-1 text-xs font-medium text-muted">
                  <span>{dayLabel(day.key, todayKey, yestKey)}</span>
                  <span className="h-px flex-1 bg-line" />
                  <span className="tabular-nums">
                    유저 {uniq} · 접속 {joins}
                    {totalMs > 0 ? ` · ${fmtDur(totalMs)}` : ""}
                  </span>
                </div>
                {cards.map(([uuid, ss]) => (
                  <UserDayCard
                    key={`${day.key}-${uuid}`}
                    uuid={uuid}
                    sessions={ss}
                    now={now}
                    defaultOpen={!isPast}
                    open={expanded[`${day.key}-${uuid}`]}
                    onToggle={() =>
                      setExpanded((m) => ({ ...m, [`${day.key}-${uuid}`]: !(m[`${day.key}-${uuid}`] ?? !isPast) }))
                    }
                    animate={!seen.current.has(ss[0].start?.id ?? ss[0].end?.id ?? 0)}
                    onSeen={() => ss.forEach((s) => seen.current.add(s.start?.id ?? s.end?.id ?? 0))}
                  />
                ))}
              </div>
            );
          })}
          {visibleDays < days.length && (
            <button
              onClick={() => setVisibleDays((d) => d + INITIAL_DAYS)}
              className="w-full rounded-xl border border-line bg-card py-2 text-xs font-medium text-muted shadow-card hover:text-fg"
            >
              더 보기
            </button>
          )}
          <div className="px-1 pb-2 text-[11px] text-muted">
            {err ? "연결 끊김 · 재시도 중" : "3초마다 갱신 · 신규 접속 시 환영과 함께 추적"}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 유저 일간 카드 ──────────────────────────────────────────────────────────
function UserDayCard({
  uuid,
  sessions,
  now,
  defaultOpen,
  open,
  onToggle,
  animate,
  onSeen,
}: {
  uuid: string;
  sessions: Session[];
  now: number;
  defaultOpen: boolean;
  open: boolean | undefined;
  onToggle: () => void;
  animate: boolean;
  onSeen: () => void;
}) {
  useEffect(() => {
    if (animate) onSeen();
  }, [animate, onSeen]);
  const isOpen = open ?? defaultOpen;
  const name = sessions[0].name;
  const isFirst = sessions.some((s) => s.isFirst);
  const liveProg = sessions.some((s) => s.inProgress);
  const count = sessions.filter((s) => s.start).length;
  const totalMs = sessions.reduce((acc, s) => {
    if (s.start && s.end) return acc + (s.end.ts - s.start.ts);
    if (s.inProgress && s.start) return acc + (now - s.start.ts);
    return acc;
  }, 0);

  return (
    <motion.div
      initial={animate ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="rounded-2xl border border-line bg-card shadow-card"
    >
      <button onClick={onToggle} aria-expanded={isOpen} className="flex w-full items-center gap-3 p-3 text-left">
        <img src={avatarUrl(uuid, name)} alt="" className="h-10 w-10 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium text-fg">{name}</span>
            {isFirst && (
              <span className="inline-flex items-center gap-0.5 rounded-full border border-line px-1.5 text-[10px] text-accent">
                <StarIcon />첫 접속
              </span>
            )}
            {liveProg && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
          </div>
          <div className="mt-0.5 text-xs text-muted">
            <span className="tabular-nums">{count}</span>회 · 총 <span className="tabular-nums">{fmtDur(totalMs)}</span>
          </div>
        </div>
        <Chevron open={isOpen} />
      </button>
      {isOpen && (
        <div className="ml-5 border-l border-line bg-card2 px-3 py-2">
          <div className="space-y-1.5">
            {[...sessions]
              .sort((a, b) => (b.start?.ts ?? b.end?.ts ?? 0) - (a.start?.ts ?? a.end?.ts ?? 0))
              .map((s) => (
                <SessionRow key={s.key} s={s} now={now} />
              ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

function SessionRow({ s, now }: { s: Session; now: number }) {
  const startTxt = s.start ? hm(s.start.ts_kst) : "?";
  let endTxt: string;
  let durTxt = "";
  let live = false;
  if (s.inProgress && s.start) {
    endTxt = "접속 중";
    durTxt = `${fmtDur(now - s.start.ts)}째`;
    live = true;
  } else if (s.end) {
    const crossDay = s.start && dayKey(s.start.ts_kst) !== dayKey(s.end.ts_kst);
    endTxt = crossDay ? `${md(s.end.ts_kst)} ${hm(s.end.ts_kst)}` : hm(s.end.ts_kst);
    durTxt = s.start ? fmtDur(s.end.ts - s.start.ts) : "";
  } else {
    endTxt = "종료 미상";
  }
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className={[
          "relative inline-flex h-2 w-2 shrink-0 rounded-full",
          live ? "bg-accent" : "bg-muted",
        ].join(" ")}
      >
        {live && <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-50" />}
      </span>
      <span className="tabular-nums text-fg">{startTxt}</span>
      <span className="text-muted">→</span>
      <span className={["tabular-nums", live ? "text-accent" : "text-fg"].join(" ")}>{endTxt}</span>
      {durTxt && <span className="ml-auto tabular-nums text-xs text-muted">{durTxt}</span>}
    </div>
  );
}

// ── 인라인 SVG 아이콘 (이모지 없음) ──────────────────────────────────────────
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      className={["shrink-0 text-muted transition-transform", open ? "rotate-180" : ""].join(" ")}
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function StarIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5.9 20.4l1.4-6.8L2.2 9l6.9-.7L12 2z" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="mx-auto text-line">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
