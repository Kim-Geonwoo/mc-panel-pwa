"use client";

// server-status 블록 — 고정 상태 카드(온/오프·TPS·접속자 펼침·피크)와 그에 딸린
// 오버레이(플레이어 프로필 시트·TPS 설명 모달). 열림 상태는 전부 블록 로컬이다.
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Status } from "../../api";
import { useI18n } from "../../i18n";
import { usePanel } from "../context";
import Avatar from "../../../components/Avatar";
import ProfileSheet from "../../../components/ProfileSheet";
import Sparkline from "../../../components/Sparkline";

type Player = Status["players"][number];

export default function ServerStatus() {
  const { t } = useI18n();
  const { status, tpsHist, up, players, onLogout } = usePanel();
  const [tpsOpen, setTpsOpen] = useState(false);
  const [playersOpen, setPlayersOpen] = useState(false);
  const [profile, setProfile] = useState<Player | null>(null);

  return (
    <>
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
            className="absolute inset-0 z-50 grid place-items-center bg-black/50 p-6"
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
    </>
  );
}
