"use client";

import { useEffect, useState } from "react";
import { fetchPushKey, subscribePush, unsubscribePush } from "../lib/api";

// 헤더의 알림 벨 토글 — 서버 다운/복구·플레이어 접속 푸시를 구독한다.
// 미지원 브라우저(iOS 미설치 사파리 등)에서는 렌더하지 않는다.

function b64ToU8(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export default function PushToggle() {
  const [supported, setSupported] = useState(false);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    setSupported(true);
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setOn(!!sub))
      .catch(() => {});
  }, []);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const cur = await reg.pushManager.getSubscription();
      if (cur) {
        await unsubscribePush(cur.endpoint);
        await cur.unsubscribe();
        setOn(false);
      } else {
        if ((await Notification.requestPermission()) !== "granted") return;
        const key = await fetchPushKey();
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: b64ToU8(key),
        });
        await subscribePush(sub.toJSON());
        setOn(true);
      }
    } catch {
      /* 미지원·거부 — 조용히 유지 */
    } finally {
      setBusy(false);
    }
  }

  if (!supported) return null;
  return (
    <button
      onClick={toggle}
      aria-label={on ? "푸시 알림 끄기" : "푸시 알림 켜기"}
      aria-pressed={on}
      className={[
        "grid h-9 w-9 place-items-center rounded-full border border-line bg-card transition-colors active:scale-95",
        on ? "text-accent" : "text-muted hover:text-fg",
      ].join(" ")}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path
          d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8m-4.3 11a2 2 0 0 1-3.4 0"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {!on && <path d="M4 4l16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
      </svg>
    </button>
  );
}
