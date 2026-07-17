"use client";

// tabbar 블록 — 세그먼트 탭 컨트롤. 순서·표시는 visibleTabs(레이아웃∩개인설정),
// 라벨은 레이아웃 tabs의 i18n 맵을 우선하고 없으면 현행 사전 키로 폴백한다.
import { useI18n } from "../../i18n";
import { usePanel } from "../context";

export default function Tabbar() {
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
    <div role="tablist" aria-label={t("panel.tabsAria")} className="mx-4 mt-1 flex shrink-0 gap-1 rounded-2xl bg-card2 p-1">
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
