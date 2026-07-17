"use client";

// 단순 블록들 + 기존 컴포넌트의 얇은 래퍼. 클래스 문자열은 현행 Panel UI와 동일하게 유지한다.
import { useI18n } from "../../i18n";
import { usePanel } from "../context";
import Logo from "../../../components/Logo";
import ThemeToggle from "../../../components/ThemeToggle";
import PerfView from "../../../components/PerfView";
import TimelineView from "../../../components/TimelineView";
import type { BlockComponentProps } from "../registry";

export function VStack({ children }: BlockComponentProps) {
  return <div className="flex min-h-0 flex-1 flex-col">{children}</div>;
}

export function HStack({ children }: BlockComponentProps) {
  return <div className="flex items-center gap-2">{children}</div>;
}

export function Spacer() {
  return <div className="flex-1" />;
}

export function TextBlock({ node }: BlockComponentProps) {
  const { t, lang } = useI18n();
  const p = (node.props ?? {}) as { i18n?: string; ko?: string; en?: string; variant?: string };
  // i18n 키(화이트리스트, 레지스트리 스키마가 강제)가 있으면 사전을, 없으면 인라인 문구를 쓴다.
  const s = p.i18n ? t(p.i18n) : ((lang === "en" ? p.en ?? p.ko : p.ko ?? p.en) ?? "");
  if (p.variant === "title") return <h1 className="text-lg font-bold tracking-tight">{s}</h1>;
  if (p.variant === "caption") return <div className="text-[11px] text-muted">{s}</div>;
  return <div className="text-sm text-fg">{s}</div>;
}

export function LogoBlock({ node }: BlockComponentProps) {
  const p = (node.props ?? {}) as { size?: number };
  return <Logo size={p.size ?? 44} />;
}

export function Header({ children }: BlockComponentProps) {
  return (
    <header className="pt-safe flex shrink-0 items-center justify-between px-5 pb-3">{children}</header>
  );
}

// 연결 끊김 배너 — 오프라인·서버 무응답 공통
export function ConnBanner() {
  const { t } = useI18n();
  const { connLost } = usePanel();
  if (!connLost) return null;
  return (
    <div className="mx-5 mb-2 shrink-0 rounded-xl border border-line bg-card px-3 py-1.5 text-center text-xs font-medium text-danger">
      {t("panel.connLost")}
    </div>
  );
}

export function ThemeToggleBlock() {
  return <ThemeToggle />;
}

export function PerfViewBlock() {
  const { up, onLogout } = usePanel();
  return <PerfView serverUp={up} onLogout={onLogout} />;
}

export function TimelineViewBlock() {
  const { onLogout } = usePanel();
  return <TimelineView onLogout={onLogout} />;
}
