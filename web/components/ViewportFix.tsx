"use client";

import { useEffect } from "react";

// 모바일 가상 키보드 대응. VisualViewport API로 앱 셸 높이를 *비주얼* 뷰포트(화면 키보드
// 위로 실제 보이는 영역)에 묶어 CSS 변수 --app-h로 노출한다. 셸은 상단에 고정되므로
// (PhoneFrame 참고) 상태 헤더는 고정된 채로 유지되고 채팅 입력창은 키보드 바로 위에 놓인다.
export default function ViewportFix() {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    let raf = 0;

    const apply = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const h = vv ? vv.height : window.innerHeight;
        root.style.setProperty("--app-h", `${Math.round(h)}px`);
        // 키보드 열림 감지 → 하단 safe-area 이중 계산 방지.
        // iOS는 키보드가 열리면 visualViewport.height만 줄어들고(레이아웃 뷰포트/innerHeight는
        // 고정) 그 줄어든 높이가 이미 홈 인디케이터 영역을 제외한다. 그런데
        // env(safe-area-inset-bottom)은 키보드가 열려도 34px를 유지하는 WebKit 버그가 있어,
        // 입력창의 pb-safe가 그 34px를 한 번 더 얹어 유령 공백을 만든다. 키보드가 열렸으면
        // --safe-b를 0으로 죽여 중복을 없앤다(닫히면 원래대로 env 적용).
        const kbOpen = !!vv && window.innerHeight - vv.height > 120;
        root.style.setProperty("--safe-b", kbOpen ? "0px" : "env(safe-area-inset-bottom, 0px)");
        // iOS는 포커스된 필드가 보이도록 페이지를 이동시키는데, 상단 고정 셸이 가시
        // 뷰포트 상단 가장자리에 맞춰지도록 다시 원위치로 끌어온다.
        if (vv && (vv.offsetTop > 0 || window.scrollY > 0)) window.scrollTo(0, 0);
      });
    };

    apply();
    if (vv) {
      vv.addEventListener("resize", apply);
      vv.addEventListener("scroll", apply);
    }
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    // iOS는 포커스 후 한 틱 늦게 키보드가 안정되기도 한다 — 잠시 뒤 다시 적용한다.
    const onFocus = () => {
      apply();
      setTimeout(apply, 250);
    };
    window.addEventListener("focusin", onFocus);
    window.addEventListener("focusout", onFocus);

    return () => {
      cancelAnimationFrame(raf);
      if (vv) {
        vv.removeEventListener("resize", apply);
        vv.removeEventListener("scroll", apply);
      }
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
      window.removeEventListener("focusin", onFocus);
      window.removeEventListener("focusout", onFocus);
    };
  }, []);
  return null;
}
