"use client";

import { useEffect, useMemo, useState } from "react";

// 마인크래프트 두상 아바타 — 이 앱에서 유일한 외부 로딩 이미지.
// (1) 로딩 중 개별 스켈레톤, (2) onError 시 서비스 폴백 체인, (3) 최종적으로 인라인
// SVG 스티브 실루엣으로 떨어져 무한 onError 루프 없이 항상 무언가를 보여준다.
// 정적 익스포트라 next/image optimizer를 못 쓰므로 일반 <img> 기반. layout shift 0(고정 px).
//
// CDN 프록시 연동은 후속 작업으로 미룸 — 여기서는 공개 서비스만 폴백 체인으로 사용한다.
// mc-heads.net을 1순위로 유지(현행 동작 보존, CDN 선택은 나중 결정).

export default function Avatar({
  uuid,
  name,
  px,
  className,
}: {
  uuid: string;
  name: string;
  px: number;
  className?: string;
}) {
  const sources = useMemo(() => {
    // 이름은 사용자 입력에서 오므로 경로 구분자(/ ? #) 등이 URL을 망가뜨리지 않게 인코딩한다.
    const key = encodeURIComponent(uuid || name || "steve");
    return [
      `https://mc-heads.net/avatar/${key}/${px}`, // 1순위(uuid·이름 모두 지원)
      `https://crafthead.net/avatar/${key}/${px}`, // Cloudflare Workers(uuid·이름)
      `https://api.mineatar.io/face/${key}?scale=8`, // uuid 전용(이름은 실패 후 통과)
    ];
  }, [uuid, name, px]);

  const [idx, setIdx] = useState(0);
  const [loaded, setLoaded] = useState(false);

  // 대상 플레이어가 바뀌면 폴백 체인과 로딩 상태를 처음부터 다시 시작한다.
  useEffect(() => {
    setIdx(0);
    setLoaded(false);
  }, [uuid, name]);

  return (
    <span
      className={`relative inline-block shrink-0 overflow-hidden ${className ?? ""}`}
      style={{ width: px, height: px }}
    >
      {idx < sources.length ? (
        <>
          {/* 로딩 중 스켈레톤 — reduced-motion이면 pulse 없이 정적 placeholder */}
          {!loaded && (
            <span
              aria-hidden
              className="absolute inset-0 rounded-[inherit] bg-line motion-safe:animate-pulse"
            />
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={sources[idx]}
            alt=""
            width={px}
            height={px}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full rounded-[inherit] object-cover"
            onLoad={() => setLoaded(true)}
            onError={() => {
              setLoaded(false);
              setIdx((i) => i + 1);
            }}
          />
        </>
      ) : (
        // 최종 폴백 — 인라인 SVG 스티브 실루엣(추가 요청 없음 → onError 루프 없음)
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          className="h-full w-full rounded-[inherit] bg-card2 text-muted"
        >
          <circle cx="12" cy="8.5" r="3.8" fill="currentColor" />
          <path d="M5 21v-1c0-3.3 3.1-5 7-5s7 1.7 7 5v1z" fill="currentColor" />
        </svg>
      )}
    </span>
  );
}
