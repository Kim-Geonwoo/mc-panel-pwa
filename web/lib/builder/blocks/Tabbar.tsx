"use client";

// tabbar 블록 — 세그먼트 탭 컨트롤. 순서·표시는 visibleTabs(레이아웃∩개인설정),
// 라벨은 레이아웃 tabs의 i18n 맵을 우선하고 없으면 현행 사전 키로, 미지 id는
// id 그대로 폴백한다(visibleTabs는 string[] — 미지 탭도 통과, B1).
import { useI18n } from "../../i18n";
import { usePanel } from "../context";
import { cx, type BlockComponentProps } from "../registry";

export default function Tabbar({ styleClassName, styleInline }: BlockComponentProps) {
  const { t, lang } = useI18n();
  const { layout, tab, setTab, visibleTabs, unread } = usePanel();

  const labelFor = (tb: string) => {
    const lt = layout.tabs?.find((x) => x.id === tb);
    if (lt) return lt.label[lang] || lt.label.ko || lt.label.en;
    if (tb === "chat") return t("tab.chat");
    if (tb === "perf") return t("tab.perf");
    if (tb === "timeline") return t("tab.timeline");
    return tb;
  };

  return (
    // 스타일 적용 지점: 탭리스트 루트 div(유일 루트 — 개별 탭 버튼은 제외).
    <div
      role="tablist"
      aria-label={t("panel.tabsAria")}
      className={cx("mx-4 mt-1 flex shrink-0 gap-1 rounded-2xl bg-card2 p-1", styleClassName)}
      style={styleInline}
    >
      {visibleTabs.map((tb) => (
        <button
          key={tb}
          role="tab"
          aria-selected={tab === tb}
          onClick={() => setTab(tb)}
          className={[
            "flex-1 min-h-[44px] rounded-xl text-sm font-medium transition-colors",
            tab === tb ? "bg-card text-fg shadow-card" : "text-muted hover:text-fg",
          ].join(" ")}
        >
          {labelFor(tb)}
          {tb === "chat" && unread > 0 && tab !== "chat" && (
            <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold tabular-nums text-accent-fg">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
