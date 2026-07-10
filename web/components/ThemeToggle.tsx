"use client";

import { useEffect, useState } from "react";
import { useI18n } from "../lib/i18n";

// 라이트/다크 토글. 초기값은 시스템 설정을 따른다(layout에서 페인트 전에 설정).
// 수동 선택은 localStorage에 저장되어 이후 우선한다. 수동 선택이 없는 동안에는
// OS 테마를 실시간으로 계속 추적한다.
export default function ThemeToggle() {
  const { t } = useI18n();
  const [dark, setDark] = useState(false);
  const [explicit, setExplicit] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    setExplicit(!!localStorage.getItem("theme"));
    // 첫 페인트 이후에만 색상 트랜지션 허용
    document.documentElement.classList.add("theme-ready");
  }, []);

  useEffect(() => {
    if (explicit) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      setDark(e.matches);
      document.documentElement.classList.toggle("dark", e.matches);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [explicit]);

  function toggle() {
    const next = !dark;
    setDark(next);
    setExplicit(true);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      /* 무시 */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? t("theme.toLight") : t("theme.toDark")}
      className="grid h-9 w-9 place-items-center rounded-full border border-line bg-card text-muted transition-colors hover:text-fg active:scale-95"
    >
      {dark ? (
        // 해
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
        </svg>
      ) : (
        // 달
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      )}
    </button>
  );
}
