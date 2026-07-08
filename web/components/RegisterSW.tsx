"use client";

import { useEffect } from "react";

// 서비스 워커를 등록해 패널을 설치 가능("홈 화면에 추가")하게 하고 앱 셸이 오프라인에서도
// 동작하게 한다. 보안 컨텍스트(HTTPS 또는 localhost)가 필요하며, 프로덕션에서는
// Cloudflare 터널 HTTPS URL로 서빙된다.
export default function RegisterSW() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* 등록 오류 무시(예: 보안 컨텍스트 아님) */
      });
    };
    // 이 이펙트가 load 이후에 실행되면 load 리스너는 영영 발화하지 않는다 —
    // 이미 로드 완료 상태면 즉시 등록한다.
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);
  return null;
}
