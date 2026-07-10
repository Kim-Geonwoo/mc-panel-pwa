"use client";

// 경량 런타임 국제화 — 프레임워크 없이 flat-key 사전 + React 컨텍스트.
// 정적 익스포트(output: 'export')에서는 next-intl류의 로케일 라우팅이 어색하므로
// 직접 구현한다. SSG 프리렌더는 기본값 "ko"로 렌더되고(기존 한국어 사용자와 동일),
// 마운트 후 이펙트에서 저장된 선택 또는 브라우저 언어로 전환한다(하이드레이션 불일치 방지).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type Lang = "ko" | "en";

// t(key, vars?) — vars가 있으면 "{name}" 토큰을 치환한다.
export type TFunc = (key: string, vars?: Record<string, string | number>) => string;

const LS_KEY = "panel-lang";

// flat-key 사전. 값은 lang=ko일 때 현행과 동일하게 렌더되어야 한다(문자 그대로 보존).
const dict: Record<Lang, Record<string, string>> = {
  ko: {
    // ── 공통 ──
    "common.close": "닫기",
    "common.logout": "로그아웃",
    "common.save": "저장",
    "common.confirm": "확인",

    // ── 부팅 ──
    "boot.loading": "불러오는 중…",

    // ── 로그인 ──
    "login.subtitle": "디스코드에 게시된 6자리 코드를 입력하세요",
    "login.codeAria": "6자리 코드",
    "login.checking": "확인 중…",
    "login.submit": "입장하기",
    "login.errTooMany": "시도가 너무 많습니다. 잠시 후 다시 시도하세요.",
    "login.errInvalid": "코드가 올바르지 않습니다.",

    // ── 닉네임 설정 ──
    "nickname.title": "닉네임 설정",
    "nickname.subtitle": "채팅에 표시될 이름을 정해주세요 (2–16자)",
    "nickname.placeholder": "닉네임",
    "nickname.saving": "설정 중…",
    "nickname.start": "시작하기",
    "nickname.errTaken": "이미 사용 중인 닉네임입니다.",
    "nickname.errLength": "닉네임은 2–16자여야 합니다.",

    // ── 패널(상태 카드·헤더) ──
    "panel.title": "마크서버",
    "panel.serverOnline": "서버 온라인",
    "panel.serverOffline": "서버 오프라인",
    "panel.serverDown": "현재 서버가 꺼져 있습니다",
    "panel.connLost": "연결이 끊겼습니다 · 자동 재연결 중",
    "panel.tpsInfoAria": "TPS 설명",
    "panel.tpsTrendAria": "최근 TPS 추세",
    "panel.playersListAria": "접속자 목록",
    "panel.playersLabel": "접속자",
    "panel.viewProfileAria": "{name} 프로필 보기",
    "panel.noPlayers": "아무도 접속해 있지 않습니다",
    "panel.peak": "역대 최대 동시접속 {n}명 · 현황 1분마다 갱신",
    "panel.tabsAria": "패널 탭",

    // ── 탭 ──
    "tab.chat": "채팅",
    "tab.perf": "성능",
    "tab.timeline": "타임라인",

    // ── 채팅 ──
    "chat.sourceGame": "게임",
    "chat.sourceDiscord": "디스코드",
    "chat.sourceWeb": "웹",
    "chat.me": "나",
    "chat.loadingOlder": "이전 메시지 불러오는 중…",
    "chat.empty": "아직 채팅이 없습니다",
    "chat.pending": "전송 중…",
    "chat.retry": "전송 실패 · 재시도",
    "chat.jumpAria": "새 메시지로 이동",
    "chat.newMessages": "새 메시지",
    "chat.inputAria": "채팅 메시지 입력",
    "chat.placeholder": "메시지를 입력하세요",
    "chat.sendAria": "전송",
    "chat.errSlowDown": "너무 빨라요. 잠시 후 다시 보내세요.",
    "chat.errSendFailed": "전송 실패 — 메시지를 눌러 재시도하세요.",

    // ── TPS 설명 모달 ──
    "tps.title": "TPS란?",
    "tps.bodyBefore":
      "TPS(Ticks Per Second)는 서버가 1초에 처리하는 게임 틱 수입니다. 정상값은 ",
    "tps.bodyAfter": "이며, 값이 낮을수록 서버가 버거운 상태(렉)를 의미합니다.",

    // ── 설정 시트 ──
    "settings.title": "설정",
    "settings.pushTitle": "알림",
    "settings.pushUnsupported": "이 브라우저는 푸시 알림을 지원하지 않습니다.",
    "settings.pushNotOffered": "이 서버는 푸시 알림을 제공하지 않습니다.",
    "settings.pushLabel": "푸시 알림",
    "settings.pushSubscribed": "이 기기에서 구독 중",
    "settings.pushOff": "꺼짐",
    "settings.pushToggleAria": "푸시 알림 구독",
    "settings.pushKindServer": "서버 상태 (다운/복구)",
    "settings.pushKindJoin": "플레이어 접속",
    "settings.tabsTitle": "탭 표시",
    "settings.tabsPerf": "성능 탭",
    "settings.tabsTimeline": "타임라인 탭",
    "settings.tabsNote": "채팅 탭은 항상 표시됩니다.",
    "settings.nickTitle": "닉네임 변경",
    "settings.nickAria": "새 닉네임",
    "settings.nickPlaceholder": "닉네임 (2–16자)",
    "settings.nickSaving": "저장 중…",
    "settings.nickErrTaken": "이미 사용 중인 닉네임입니다",
    "settings.nickErrLength": "닉네임은 2–16자여야 합니다",
    "settings.nickChanged": "닉네임이 변경되었습니다.",
    "settings.langTitle": "언어",

    // ── 프로필 시트 ──
    "profile.dialogAria": "{name} 프로필",
    "profile.ping": "핑 {ping}ms",
    "profile.pingNone": "핑 —",
    "profile.statToday": "오늘 접속",
    "profile.statSessions": "기록된 세션",
    "profile.statLastJoin": "마지막 접속",
    "profile.statFirstSeen": "첫 방문",
    "profile.times": "{n}회",
    "profile.footnote": "타임라인 보존 기간 내 기록 기준 · 시간 KST",

    // ── 테마 토글 ──
    "theme.toLight": "라이트 모드로 전환",
    "theme.toDark": "다크 모드로 전환",

    // ── 성능 뷰 ──
    "perf.waiting":
      "성능 추적 대기 — 플레이어가 1명 이상 접속하면 실시간 추적이 시작됩니다.",
    "perf.serverDown": "서버가 꺼져 있습니다.",
    "perf.statMsptAvg": "MSPT 평균",
    "perf.statSpikes": "스파이크",
    "perf.statMaxTick": "최대 틱",
    "perf.statPlayers": "접속자",
    "perf.unitTimes": "회",
    "perf.unitPeople": "명",
    "perf.chartTps": "TPS · 최근 ~12분",
    "perf.chartMspt": "MSPT (ms) · 50ms 초과 시 렉",
    "perf.chartDims": "차원별 부하 (엔티티 · 로드청크)",
    "perf.dimEntities": "엔티티 {v}",
    "perf.dimChunks": "청크 {v}",
    "perf.collecting": "데이터 수집 중…",
    "perf.footerErr": "갱신 실패 · 재시도 중",
    "perf.footerLive": "2초마다 실시간 갱신 · 플레이어 접속 시에만 추적",

    // ── 차트(숨은 범례 라벨) ──
    "chart.threshold": "기준",

    // ── 시간 헬퍼 ──
    "time.lessThanMin": "1분 미만",
    "time.hourMin": "{h}시간 {m}분",
    "time.min": "{m}분",
    "time.today": "오늘",
    "time.yesterday": "어제",
    "time.dateFull": "{m}월 {d}일 ({wd})",
    "time.wd0": "일",
    "time.wd1": "월",
    "time.wd2": "화",
    "time.wd3": "수",
    "time.wd4": "목",
    "time.wd5": "금",
    "time.wd6": "토",

    // ── 타임라인 ──
    "timeline.title": "접속 타임라인",
    "timeline.tz": "시간 KST",
    "timeline.onlineNow": "지금 온라인 · {n}명",
    "timeline.noOnline": "접속 중인 플레이어가 없습니다.",
    "timeline.forDur": "{dur}째",
    "timeline.emptyTitle": "아직 접속 기록이 없어요.",
    "timeline.emptyBody": "새 접속이 생기면 여기에 표시됩니다.",
    "timeline.daySummary": "유저 {u} · 접속 {j}",
    "timeline.more": "더 보기",
    "timeline.footerErr": "연결 끊김 · 재시도 중",
    "timeline.footerLive": "3초마다 갱신 · 신규 접속 시 환영과 함께 추적",
    "timeline.firstJoin": "첫 접속",
    "timeline.userMid": "회 · 총 ",
    "timeline.online": "접속 중",
    "timeline.unknownEnd": "종료 미상",
  },
  en: {
    // ── Common ──
    "common.close": "Close",
    "common.logout": "Log out",
    "common.save": "Save",
    "common.confirm": "OK",

    // ── Boot ──
    "boot.loading": "Loading…",

    // ── Login ──
    "login.subtitle": "Enter the 6-digit code posted in Discord",
    "login.codeAria": "6-digit code",
    "login.checking": "Checking…",
    "login.submit": "Enter",
    "login.errTooMany": "Too many attempts. Please try again shortly.",
    "login.errInvalid": "Incorrect code.",

    // ── Nickname setup ──
    "nickname.title": "Set nickname",
    "nickname.subtitle": "Choose the name shown in chat (2–16 chars)",
    "nickname.placeholder": "Nickname",
    "nickname.saving": "Setting…",
    "nickname.start": "Get started",
    "nickname.errTaken": "That nickname is already taken.",
    "nickname.errLength": "Nickname must be 2–16 characters.",

    // ── Panel (status card / header) ──
    "panel.title": "MC Server",
    "panel.serverOnline": "Server online",
    "panel.serverOffline": "Server offline",
    "panel.serverDown": "The server is currently offline",
    "panel.connLost": "Connection lost · reconnecting automatically",
    "panel.tpsInfoAria": "About TPS",
    "panel.tpsTrendAria": "Recent TPS trend",
    "panel.playersListAria": "Player list",
    "panel.playersLabel": "Players",
    "panel.viewProfileAria": "View {name}'s profile",
    "panel.noPlayers": "No one is online",
    "panel.peak": "Peak concurrent {n} · status updates every minute",
    "panel.tabsAria": "Panel tabs",

    // ── Tabs ──
    "tab.chat": "Chat",
    "tab.perf": "Performance",
    "tab.timeline": "Timeline",

    // ── Chat ──
    "chat.sourceGame": "Game",
    "chat.sourceDiscord": "Discord",
    "chat.sourceWeb": "Web",
    "chat.me": "Me",
    "chat.loadingOlder": "Loading earlier messages…",
    "chat.empty": "No messages yet",
    "chat.pending": "Sending…",
    "chat.retry": "Send failed · retry",
    "chat.jumpAria": "Jump to new messages",
    "chat.newMessages": "New messages",
    "chat.inputAria": "Type a chat message",
    "chat.placeholder": "Type a message",
    "chat.sendAria": "Send",
    "chat.errSlowDown": "Too fast. Please wait a moment before sending again.",
    "chat.errSendFailed": "Send failed — tap the message to retry.",

    // ── TPS explainer modal ──
    "tps.title": "What is TPS?",
    "tps.bodyBefore":
      "TPS (Ticks Per Second) is the number of game ticks the server processes each second. The normal value is ",
    "tps.bodyAfter":
      ", and the lower it is, the more the server is struggling (lag).",

    // ── Settings sheet ──
    "settings.title": "Settings",
    "settings.pushTitle": "Notifications",
    "settings.pushUnsupported": "This browser does not support push notifications.",
    "settings.pushNotOffered": "This server does not offer push notifications.",
    "settings.pushLabel": "Push notifications",
    "settings.pushSubscribed": "Subscribed on this device",
    "settings.pushOff": "Off",
    "settings.pushToggleAria": "Subscribe to push notifications",
    "settings.pushKindServer": "Server status (down/recovery)",
    "settings.pushKindJoin": "Player joins",
    "settings.tabsTitle": "Tab visibility",
    "settings.tabsPerf": "Performance tab",
    "settings.tabsTimeline": "Timeline tab",
    "settings.tabsNote": "The chat tab is always shown.",
    "settings.nickTitle": "Change nickname",
    "settings.nickAria": "New nickname",
    "settings.nickPlaceholder": "Nickname (2–16 chars)",
    "settings.nickSaving": "Saving…",
    "settings.nickErrTaken": "That nickname is already taken",
    "settings.nickErrLength": "Nickname must be 2–16 characters",
    "settings.nickChanged": "Nickname changed.",
    "settings.langTitle": "Language",

    // ── Profile sheet ──
    "profile.dialogAria": "{name}'s profile",
    "profile.ping": "Ping {ping}ms",
    "profile.pingNone": "Ping —",
    "profile.statToday": "Today's joins",
    "profile.statSessions": "Recorded sessions",
    "profile.statLastJoin": "Last join",
    "profile.statFirstSeen": "First seen",
    "profile.times": "{n}",
    "profile.footnote":
      "Based on records within the timeline retention period · time in KST",

    // ── Theme toggle ──
    "theme.toLight": "Switch to light mode",
    "theme.toDark": "Switch to dark mode",

    // ── Performance view ──
    "perf.waiting":
      "Waiting for performance tracking — live tracking begins when at least one player is online.",
    "perf.serverDown": "The server is offline.",
    "perf.statMsptAvg": "MSPT avg",
    "perf.statSpikes": "Spikes",
    "perf.statMaxTick": "Max tick",
    "perf.statPlayers": "Players",
    "perf.unitTimes": "",
    "perf.unitPeople": "",
    "perf.chartTps": "TPS · last ~12 min",
    "perf.chartMspt": "MSPT (ms) · lag above 50ms",
    "perf.chartDims": "Load by dimension (entities · loaded chunks)",
    "perf.dimEntities": "Entities {v}",
    "perf.dimChunks": "Chunks {v}",
    "perf.collecting": "Collecting data…",
    "perf.footerErr": "Update failed · retrying",
    "perf.footerLive": "Live updates every 2s · tracked only while players are online",

    // ── Chart (hidden legend label) ──
    "chart.threshold": "Reference",

    // ── Time helpers ──
    "time.lessThanMin": "< 1 min",
    "time.hourMin": "{h}h {m}m",
    "time.min": "{m}m",
    "time.today": "Today",
    "time.yesterday": "Yesterday",
    "time.dateFull": "{m}/{d} ({wd})",
    "time.wd0": "Sun",
    "time.wd1": "Mon",
    "time.wd2": "Tue",
    "time.wd3": "Wed",
    "time.wd4": "Thu",
    "time.wd5": "Fri",
    "time.wd6": "Sat",

    // ── Timeline ──
    "timeline.title": "Activity timeline",
    "timeline.tz": "Time in KST",
    "timeline.onlineNow": "Online now · {n}",
    "timeline.noOnline": "No players are online.",
    "timeline.forDur": "for {dur}",
    "timeline.emptyTitle": "No activity yet.",
    "timeline.emptyBody": "New sessions will appear here.",
    "timeline.daySummary": "Users {u} · joins {j}",
    "timeline.more": "Show more",
    "timeline.footerErr": "Disconnected · retrying",
    "timeline.footerLive": "Updates every 3s · new joins tracked with a welcome",
    "timeline.firstJoin": "First join",
    "timeline.userMid": " · total ",
    "timeline.online": "Online",
    "timeline.unknownEnd": "End unknown",
  },
};

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: TFunc };

const I18nContext = createContext<Ctx | null>(null);

export function LangProvider({ children }: { children: React.ReactNode }) {
  // SSG 프리렌더/첫 하이드레이션은 항상 "ko"(현행 출력과 동일) → 불일치 없음.
  const [lang, setLangState] = useState<Lang>("ko");

  // 마운트 후 저장된 선택 또는 브라우저 언어로 전환한다.
  useEffect(() => {
    let next: Lang | null = null;
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved === "ko" || saved === "en") next = saved;
    } catch {
      /* 무시 */
    }
    if (!next) {
      try {
        next = navigator.language.startsWith("ko") ? "ko" : "en";
      } catch {
        next = "ko";
      }
    }
    setLangState(next);
  }, []);

  // <html lang>을 실제 선택 언어와 일치시킨다(접근성).
  useEffect(() => {
    try {
      document.documentElement.lang = lang;
    } catch {
      /* 무시 */
    }
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LS_KEY, l);
    } catch {
      /* 무시 */
    }
  }, []);

  const t = useCallback<TFunc>(
    (key, vars) => {
      let s = dict[lang][key] ?? dict.ko[key] ?? key;
      if (vars) {
        for (const k of Object.keys(vars)) {
          s = s.split(`{${k}}`).join(String(vars[k]));
        }
      }
      return s;
    },
    [lang],
  );

  const value = useMemo<Ctx>(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within LangProvider");
  return ctx;
}
