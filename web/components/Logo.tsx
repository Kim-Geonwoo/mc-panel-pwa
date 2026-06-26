// 브랜드 마크 — 액센트 타일 위의 아이소메트릭 큐브. 순수 SVG(이모지 없음).
export default function Logo({ size = 44 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      role="img"
      aria-label="MC Server Panel"
    >
      <rect width="48" height="48" rx="13" fill="var(--accent)" />
      <g fill="var(--accent-fg)">
        <path d="M24 9 38 16.5 24 24 10 16.5Z" opacity="0.95" />
        <path d="M10 17.5 24 25v15l-14-7.5Z" opacity="0.65" />
        <path d="M38 17.5 24 25v15l14-7.5Z" opacity="0.8" />
      </g>
    </svg>
  );
}
