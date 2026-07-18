"use client";

// settings-button 블록 — 헤더 기어 버튼과 설정 시트(알림·탭 표시·닉네임 변경·로그아웃).
// 열림 상태는 블록 로컬, 닉네임·탭 설정은 usePanel() 공유값을 쓴다.
import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useI18n } from "../../i18n";
import { usePanel } from "../context";
import SettingsSheet from "../../../components/SettingsSheet";
import { cx, type BlockComponentProps } from "../registry";

export default function SettingsButton({ styleClassName, styleInline }: BlockComponentProps) {
  const { t } = useI18n();
  const { nick, setNick, tabPrefs, updateTabPrefs, onLogout } = usePanel();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      {/* 스타일 적용 지점(고정): 기어 버튼 = 주 시각 요소. 다중 루트 블록이므로
          설정 시트에는 적용하지 않는다(계획 T4.2). */}
      <button
        onClick={() => setSettingsOpen(true)}
        aria-label={t("settings.title")}
        className={cx(
          "grid h-9 w-9 place-items-center rounded-full border border-line bg-card text-muted transition-colors hover:text-fg active:scale-95",
          styleClassName,
        )}
        style={styleInline}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {/* 설정 시트 — 알림·탭 표시·닉네임 변경·로그아웃 */}
      <AnimatePresence>
        {settingsOpen && (
          <SettingsSheet
            nick={nick}
            onNickChanged={setNick}
            tabPrefs={tabPrefs}
            onTabPrefs={updateTabPrefs}
            onLogout={onLogout}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
