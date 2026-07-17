"use client";

// PanelProvider — 패널 셸의 공유 상태(탭·접속현황 폴링·닉네임·미확인·연결)를 블록들이
// usePanel()로 구독한다(스펙 §4의 dataCtx). 채팅 내부 상태는 keepMounted인 ChatFeed
// 블록이 소유한다 — 숨김 마운트가 유지되므로 상태를 끌어올릴 필요가 없다.
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
} from "react";
import { fetchStatus, Status, getMe, UnauthorizedError } from "../api";
import type { Layout } from "./schema";
import { resolveTabs, type KnownTab } from "./resolveTabs";

type Player = Status["players"][number];

const STATUS_MS = 60000; // 접속현황 갱신: 1분
const TABS_KEY = "mc_sv_panel_tabs";

export type PanelCtx = {
  layout: Layout;
  onLogout: () => void;
  tab: string;
  setTab: (t: string) => void;
  tabRef: MutableRefObject<string>; // 채팅 폴러의 미확인 집계용(리렌더 없이 현재 탭 참조)
  visibleTabs: KnownTab[];
  tabPrefs: { perf: boolean; timeline: boolean };
  updateTabPrefs: (p: { perf: boolean; timeline: boolean }) => void;
  status: Status | null;
  tpsHist: number[];
  up: boolean;
  players: Player[];
  nick: string;
  setNick: (n: string) => void;
  unread: number;
  setUnread: Dispatch<SetStateAction<number>>;
  connLost: boolean;
  setConnLost: (b: boolean) => void;
};

const Ctx = createContext<PanelCtx | null>(null);

export function PanelProvider({
  layout,
  onLogout,
  children,
}: {
  layout: Layout;
  onLogout: () => void;
  children: ReactNode;
}) {
  const [tab, setTab] = useState<string>("chat");
  const tabRef = useRef(tab);
  // 성능/타임라인 탭 표시 여부(채팅은 항상 표시). 정적 export 프리렌더에서 localStorage가
  // 없으므로 기본값으로 시작하고, 마운트 후 이펙트에서 복원한다.
  const [tabPrefs, setTabPrefs] = useState<{ perf: boolean; timeline: boolean }>({
    perf: true,
    timeline: true,
  });
  const [status, setStatus] = useState<Status | null>(null);
  const [tpsHist, setTpsHist] = useState<number[]>([]); // 상태 폴링(1분)마다 쌓는 TPS 추세
  const [nick, setNick] = useState("");
  const [unread, setUnread] = useState(0);
  const [connLost, setConnLost] = useState(false);

  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);

  // 브라우저 오프라인 신호 — 폴링 실패를 기다리지 않고 즉시 배너 반영
  useEffect(() => {
    const on = () => setConnLost(false);
    const off = () => setConnLost(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // 낙관적 전송 표시에 쓸 내 닉네임 (실패해도 무해 — 폴백 표기)
  useEffect(() => {
    getMe()
      .then((m) => setNick(m.nickname))
      .catch(() => {});
  }, []);

  // 탭 표시 설정 복원(둘 다 기본 true)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TABS_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { perf?: boolean; timeline?: boolean };
        setTabPrefs({ perf: p.perf !== false, timeline: p.timeline !== false });
      }
    } catch {
      /* 무시 */
    }
  }, []);

  function updateTabPrefs(p: { perf: boolean; timeline: boolean }) {
    setTabPrefs(p);
    try {
      localStorage.setItem(TABS_KEY, JSON.stringify(p));
    } catch {
      /* 무시 */
    }
  }

  // 현재 활성 탭이 (개인 설정이나 레이아웃으로) 숨겨졌으면 채팅으로 되돌린다.
  // resolveTabs는 항상 채팅을 포함하므로 폴백은 안전하다.
  useEffect(() => {
    if (!resolveTabs(layout, tabPrefs).includes(tab as KnownTab)) setTab("chat");
  }, [tab, tabPrefs, layout]);

  // 접속현황 폴링 — 1분에 한 번
  useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const s = await fetchStatus();
        if (alive) {
          setStatus(s);
          // 서버가 켜져 있을 때만 추세에 반영 (최근 30포인트 ≈ 30분)
          if (s.server_up && s.tps >= 0) setTpsHist((p) => [...p, s.tps].slice(-30));
        }
      } catch (e) {
        if (e instanceof UnauthorizedError) return onLogout();
      }
      if (alive) t = setTimeout(tick, STATUS_MS);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [onLogout]);

  const visibleTabs = resolveTabs(layout, tabPrefs);
  const up = status?.server_up ?? false;
  const players = status?.players ?? [];

  const value: PanelCtx = {
    layout,
    onLogout,
    tab,
    setTab,
    tabRef,
    visibleTabs,
    tabPrefs,
    updateTabPrefs,
    status,
    tpsHist,
    up,
    players,
    nick,
    setNick,
    unread,
    setUnread,
    connLost,
    setConnLost,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePanel(): PanelCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePanel must be used within PanelProvider");
  return ctx;
}
