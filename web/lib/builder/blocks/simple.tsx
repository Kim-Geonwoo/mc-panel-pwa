"use client";

// 컨텍스트가 필요 없는 단순 블록들. 클래스 문자열은 현행 Panel UI와 동일하게 유지한다.
import { useI18n } from "../../i18n";
import Logo from "../../../components/Logo";
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
