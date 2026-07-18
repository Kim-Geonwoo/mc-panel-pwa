"use client";

// settings-button 블록 — 헤더 기어 버튼과 설정 시트(알림·탭 표시·언어·닉네임·로그아웃).
// 열림 상태는 블록 로컬, 닉네임·탭 설정은 usePanel() 공유값을 쓴다.
// props.sections(계획 T5.2)로 시트에 표시할 섹션 부분집합을 고른다 — 부재 시 전체.
import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useI18n } from "../../i18n";
import { usePanel } from "../context";
import SettingsSheet, {
  SETTINGS_SECTION_IDS,
  type SettingsSectionId,
} from "../../../components/SettingsSheet";
import { cx, type BlockComponentProps } from "../registry";

export default function SettingsButton({ node, styleClassName, styleInline }: BlockComponentProps) {
  const { t } = useI18n();
  const { nick, setNick, tabPrefs, updateTabPrefs, onLogout } = usePanel();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // props.sections 관대 해석 — propsSchema는 .catch로 무효값도 통과시키므로(설정 진입점
  // 생존 우선, registry 주석) 여기서 아는 섹션 id만 원소 단위로 걸러 시트에 넘긴다.
  // 유효 원소가 하나도 없으면(비배열·빈 배열 포함) undefined = 전체 표시(부재=기본).
  const rawSections = node.props?.sections;
  const sections = Array.isArray(rawSections)
    ? rawSections.filter((s): s is SettingsSectionId =>
        (SETTINGS_SECTION_IDS as readonly unknown[]).includes(s),
      )
    : [];

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

      {/* 설정 시트 — 알림·탭 표시·언어·닉네임·로그아웃(sections로 부분집합 선택 가능) */}
      <AnimatePresence>
        {settingsOpen && (
          <SettingsSheet
            nick={nick}
            onNickChanged={setNick}
            tabPrefs={tabPrefs}
            onTabPrefs={updateTabPrefs}
            onLogout={onLogout}
            onClose={() => setSettingsOpen(false)}
            sections={sections.length ? sections : undefined}
          />
        )}
      </AnimatePresence>
    </>
  );
}
