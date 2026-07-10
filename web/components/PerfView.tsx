"use client";

import { useEffect, useState } from "react";
import { fetchPerf, Perf, PerfDim, UnauthorizedError } from "../lib/api";
import { useI18n } from "../lib/i18n";
import Chart from "./Chart";

const PERF_MS = 2000;

export default function PerfView({
  serverUp,
  onLogout,
}: {
  serverUp: boolean;
  onLogout: () => void;
}) {
  const { t } = useI18n();
  const [perf, setPerf] = useState<Perf | null>(null);
  const [err, setErr] = useState(false);
  // 엔티티 수는 약 6초마다 샘플링(비용 절감). 깜빡임을 막기 위해 마지막 스냅샷을 유지한다
  const [dimsView, setDimsView] = useState<PerfDim[]>([]);

  useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const p = await fetchPerf();
        if (!alive) return;
        setPerf(p);
        setErr(false);
        if (p.current?.dims?.some((d) => d.entities >= 0)) setDimsView(p.current.dims);
      } catch (e) {
        if (e instanceof UnauthorizedError) return onLogout();
        if (alive) setErr(true);
      }
      if (alive) t = setTimeout(tick, PERF_MS);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [onLogout]);

  if (!perf) {
    return (
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-2">
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-line bg-card p-3 text-center shadow-card">
              <div className="mx-auto h-5 w-10 rounded bg-line motion-safe:animate-pulse" />
              <div className="mx-auto mt-1 h-2.5 w-12 rounded bg-line motion-safe:animate-pulse" />
            </div>
          ))}
        </div>
        {[0, 1].map((i) => (
          <div key={i} className="rounded-2xl border border-line bg-card p-4 shadow-card">
            <div className="mb-2 h-3 w-28 rounded bg-line motion-safe:animate-pulse" />
            <div className="h-[130px] w-full rounded bg-line motion-safe:animate-pulse" />
          </div>
        ))}
        <div className="rounded-2xl border border-line bg-card p-4 shadow-card">
          <div className="mb-2 h-3 w-32 rounded bg-line motion-safe:animate-pulse" />
          <div className="space-y-1.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-4 w-full rounded bg-line motion-safe:animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }
  const cur = perf.current;
  const hist = perf.history ?? [];
  if (!perf.tracking && hist.length === 0) {
    return (
      <div className="grid flex-1 place-items-center px-8 text-center text-sm leading-relaxed text-muted">
        {serverUp ? t("perf.waiting") : t("perf.serverDown")}
      </div>
    );
  }

  const xs = hist.map((h) => h.ts / 1000);
  const tpsData: [number[], (number | null)[]] = [xs, hist.map((h) => h.tps)];
  const msptData: [number[], (number | null)[]] = [xs, hist.map((h) => h.mspt)];
  const p95 = cur ? (cur.mspt_p95 >= 0 ? cur.mspt_p95 : cur.period_p95) : -1;
  const laggy = cur ? cur.mspt >= 50 || p95 >= 50 : false;
  const dims = [...dimsView].sort((a, b) => b.entities - a.entities);

  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-2">
      <div className="grid grid-cols-3 gap-2">
        <Stat label={t("perf.statMsptAvg")} value={cur ? cur.mspt.toFixed(1) : "—"} unit="ms" bad={!!cur && cur.mspt >= 50} />
        <Stat label="MSPT p95" value={p95 >= 0 ? p95.toFixed(1) : "—"} unit="ms" bad={p95 >= 50} />
        <Stat label="TPS" value={cur ? cur.tps.toFixed(1) : "—"} unit="" bad={!!cur && cur.tps < 18} />
        <Stat label={t("perf.statSpikes")} value={cur ? String(cur.spikes_100) : "—"} unit={t("perf.unitTimes")} bad={!!cur && cur.spikes_100 > 0} />
        <Stat label={t("perf.statMaxTick")} value={cur ? cur.period_max.toFixed(0) : "—"} unit="ms" bad={!!cur && cur.period_max >= 100} />
        <Stat label={t("perf.statPlayers")} value={cur ? String(cur.count) : "—"} unit={t("perf.unitPeople")} />
      </div>

      <div className="rounded-2xl border border-line bg-card p-4 shadow-card">
        <div className="mb-1 text-xs font-medium text-muted">{t("perf.chartTps")}</div>
        <Chart data={tpsData} label="TPS" color="#36d36c" min={0} max={20} />
      </div>
      <div className="rounded-2xl border border-line bg-card p-4 shadow-card">
        <div className="mb-1 text-xs font-medium text-muted">{t("perf.chartMspt")}</div>
        <Chart data={msptData} label="MSPT" color={laggy ? "#ef4444" : "#5b8def"} min={0} threshold={50} />
      </div>

      <div className="rounded-2xl border border-line bg-card p-4 shadow-card">
        <div className="mb-2 text-xs font-medium text-muted">{t("perf.chartDims")}</div>
        {dims.length ? (
          <div className="space-y-1.5">
            {dims.map((d) => (
              <div key={d.name} className="flex items-center gap-2 text-sm">
                <span className="truncate font-mono text-xs">{d.name}</span>
                <span className="ml-auto tabular-nums text-muted">{t("perf.dimEntities", { v: d.entities >= 0 ? d.entities : "—" })}</span>
                <span className="w-20 text-right tabular-nums text-muted">{t("perf.dimChunks", { v: d.chunks >= 0 ? d.chunks : "—" })}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted">{t("perf.collecting")}</div>
        )}
      </div>

      <div className="px-1 pb-2 text-[11px] text-muted">
        {err ? t("perf.footerErr") : t("perf.footerLive")}
      </div>
    </div>
  );
}

function Stat({ label, value, unit, bad }: { label: string; value: string; unit: string; bad?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-card p-3 text-center shadow-card">
      <div className={["text-lg font-bold tabular-nums", bad ? "text-danger" : "text-fg"].join(" ")}>
        {value}
        <span className="text-xs font-medium text-muted">{unit}</span>
      </div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
}
