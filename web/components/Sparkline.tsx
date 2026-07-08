"use client";

// 상태 카드용 초소형 추세선 — 축·범례 없는 인라인 SVG. 색은 부모의 currentColor를
// 따르므로 토큰(text-accent 등)으로 제어한다. uPlot을 쓰기엔 과한 크기(64×18px).
export default function Sparkline({
  points,
  width = 64,
  height = 18,
}: {
  points: number[];
  width?: number;
  height?: number;
}) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const pts = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * width;
      const y = height - 2 - ((v - min) / span) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="shrink-0">
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
