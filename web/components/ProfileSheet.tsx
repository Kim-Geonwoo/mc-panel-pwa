"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { fetchTimeline, UnauthorizedError } from "../lib/api";
import { useI18n } from "../lib/i18n";
import Avatar from "./Avatar";

// 접속자 목록에서 플레이어를 눌렀을 때 뜨는 프로필 바텀시트.
// 타임라인 이벤트(보존 기간 내)를 1회 조회해 접속 통계를 계산한다 — 폴링 없음.
// 모바일에서는 하단 시트, 넓은 화면에서는 중앙 카드(기존 모달 패턴과 동일 오버레이).

type Stats = {
  lastJoinKst: string | null;
  todayJoins: number;
  firstSeenKst: string | null;
  totalSessions: number;
};

export default function ProfileSheet({
  uuid,
  name,
  ping,
  onClose,
  onLogout,
}: {
  uuid: string;
  name: string;
  ping: number;
  onClose: () => void;
  onLogout: () => void;
}) {
  const { t } = useI18n();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let alive = true;
    fetchTimeline()
      .then((tl) => {
        if (!alive) return;
        const evs = tl.events.filter((e) => e.uuid === uuid);
        const joins = evs.filter((e) => e.event === "join");
        // KST 날짜키 — 표시 문자열(ts_kst)과 같은 기준으로 비교
        const todayKey = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
        const first = evs.find((e) => e.is_first);
        setStats({
          lastJoinKst: joins.length ? joins[joins.length - 1].ts_kst : null,
          todayJoins: joins.filter((e) => e.ts_kst.slice(0, 10) === todayKey).length,
          firstSeenKst: first ? first.ts_kst.slice(0, 10) : null,
          totalSessions: joins.length,
        });
      })
      .catch((e) => {
        if (e instanceof UnauthorizedError) return onLogout();
      });
    return () => {
      alive = false;
    };
  }, [uuid, onLogout]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 48, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 48, opacity: 0 }}
        transition={{ duration: 0.22 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t("profile.dialogAria", { name })}
        className="pb-safe w-full max-w-[380px] rounded-t-2xl border-t border-line bg-card p-5 shadow-card sm:rounded-2xl sm:border"
      >
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-line sm:hidden" />
        <div className="flex items-center gap-3">
          <Avatar uuid={uuid} name={name} px={48} className="rounded-xl" />
          <div>
            <div className="text-base font-bold text-fg">{name}</div>
            <div className="text-xs tabular-nums text-muted">{ping >= 0 ? t("profile.ping", { ping }) : t("profile.pingNone")}</div>
          </div>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="ml-auto grid h-8 w-8 place-items-center rounded-full border border-line text-muted transition-colors hover:text-fg"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <StatBox label={t("profile.statToday")} value={stats ? t("profile.times", { n: stats.todayJoins }) : "…"} />
          <StatBox label={t("profile.statSessions")} value={stats ? t("profile.times", { n: stats.totalSessions }) : "…"} />
          <StatBox label={t("profile.statLastJoin")} value={stats?.lastJoinKst ? stats.lastJoinKst.slice(5, 16) : "—"} />
          <StatBox label={t("profile.statFirstSeen")} value={stats?.firstSeenKst ?? "—"} />
        </div>
        <div className="mt-3 text-[11px] text-muted">{t("profile.footnote")}</div>
      </motion.div>
    </motion.div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-card2 p-3 text-center">
      <div className="text-sm font-bold tabular-nums text-fg">{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
}
