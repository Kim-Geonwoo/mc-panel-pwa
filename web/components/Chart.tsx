"use client";

import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

// 실시간 시계열용 경량 uPlot 라인 차트 래퍼(한 번만 생성하고 setData로 데이터를 명령형으로
// 갱신 — 약 2초 간격 스트리밍 갱신에 충분히 빠르다).
export default function Chart({
  data,
  label,
  color,
  min,
  max,
  height = 130,
  threshold,
}: {
  data: [number[], (number | null)[]]; // [unix 초, 값]
  label: string;
  color: string;
  min?: number;
  max?: number;
  height?: number;
  threshold?: number; // 수평 기준선 값(선택). 두 번째 시리즈로 그린다
}) {
  const ref = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const axisColor = "#8b93a7";
    const grid = { stroke: "rgba(128,128,128,0.15)", width: 1 };
    const series: uPlot.Series[] = [
      {},
      { label, stroke: color, width: 2, points: { show: false } },
    ];
    if (threshold != null) {
      series.push({ label: "기준", stroke: "rgba(237,66,69,0.5)", width: 1, dash: [4, 4], points: { show: false } });
    }
    const opts: uPlot.Options = {
      width: el.clientWidth || 320,
      height,
      padding: [8, 8, 0, 0],
      scales: { x: { time: true }, y: { range: (_u, dmin, dmax) => [min ?? Math.min(0, dmin), max ?? dmax] } },
      series,
      axes: [
        { stroke: axisColor, grid, ticks: { stroke: axisColor }, size: 30, font: "11px system-ui" },
        { stroke: axisColor, grid, ticks: { stroke: axisColor }, size: 38, font: "11px system-ui" },
      ],
      legend: { show: false },
      cursor: { points: { size: 5 } },
    };
    const u = new uPlot(opts, buildData(data, threshold), el);
    plot.current = u;
    const onResize = () => u.setSize({ width: el.clientWidth || 320, height });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      u.destroy();
      plot.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    plot.current?.setData(buildData(data, threshold));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return <div ref={ref} className="w-full" />;
}

function buildData(
  data: [number[], (number | null)[]],
  threshold?: number,
): uPlot.AlignedData {
  const [xs, ys] = data;
  if (threshold == null) return [xs, ys];
  return [xs, ys, xs.map(() => threshold)];
}
