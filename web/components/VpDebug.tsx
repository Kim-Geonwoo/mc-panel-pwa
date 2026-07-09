"use client";

import { useEffect, useState } from "react";

// 옵트인 뷰포트 진단. URL에 ?vpdebug가 있을 때만 화면 하단에 실측치를 띄운다.
// 아이폰 하단 여백 원인(visualViewport.height 고착 vs 정상 safe-area)을 실기기에서
// 구분하기 위한 도구 — 일반 사용자에겐 절대 보이지 않는다.
// 판독: 최초 실행(키보드 무접촉)에서 Δ≈0·sab≈34면 정상 safe-area(공백이 34px 근처).
// 키보드 여닫은 뒤 Δ가 0이 아니고 --app-h < ih로 남으면 고착 버그(이 커밋이 해소).
export default function VpDebug() {
  const [line, setLine] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.location.search.includes("vpdebug")) return;

    // env(safe-area-inset-bottom) 실측용 숨김 프로브
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;left:0;bottom:0;width:0;padding-bottom:env(safe-area-inset-bottom);visibility:hidden;pointer-events:none";
    document.body.appendChild(probe);

    const read = () => {
      const ih = window.innerHeight;
      const vh = window.visualViewport?.height ?? -1;
      const sab = getComputedStyle(probe).paddingBottom;
      const appH = getComputedStyle(document.documentElement).getPropertyValue("--app-h").trim();
      setLine(`ih=${ih} vh=${vh.toFixed(1)} Δ=${(ih - vh).toFixed(1)} sab=${sab} app-h=${appH}`);
    };

    read();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", read);
    vv?.addEventListener("scroll", read);
    const id = window.setInterval(read, 500);
    return () => {
      vv?.removeEventListener("resize", read);
      vv?.removeEventListener("scroll", read);
      window.clearInterval(id);
      probe.remove();
    };
  }, []);

  if (!line) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[9999] bg-black/80 px-2 py-1 text-center font-mono text-[11px] text-accent"
    >
      {line}
    </div>
  );
}
