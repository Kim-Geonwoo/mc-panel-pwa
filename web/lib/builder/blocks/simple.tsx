"use client";

// 단순 블록들 + 기존 컴포넌트의 얇은 래퍼. 클래스 문자열은 현행 Panel UI와 동일하게 유지한다.
// 스타일 토큰(T4.2): 각 블록은 자기 "루트 요소"에 cx(BASE, styleClassName)·styleInline을
// 병합한다 — style 미지정이면 cx가 BASE를 문자 그대로 반환해 기존 출력과 완전 동일(회귀 0).
import { useI18n } from "../../i18n";
import { usePanel } from "../context";
import Logo from "../../../components/Logo";
import ThemeToggle from "../../../components/ThemeToggle";
import PerfView from "../../../components/PerfView";
import TimelineView from "../../../components/TimelineView";
import { cx, type BlockComponentProps } from "../registry";

// 스타일 적용 지점: 루트 div(유일 요소).
export function VStack({ children, styleClassName, styleInline }: BlockComponentProps) {
  return (
    <div className={cx("flex min-h-0 flex-1 flex-col", styleClassName)} style={styleInline}>
      {children}
    </div>
  );
}

// 스타일 적용 지점: 루트 div(유일 요소).
export function HStack({ children, styleClassName, styleInline }: BlockComponentProps) {
  return (
    <div className={cx("flex items-center gap-2", styleClassName)} style={styleInline}>
      {children}
    </div>
  );
}

// 스타일 적용 지점: 루트 div. 병합 순서는 기본 flex-1 뒤에 사용자 클래스 — grow:false는
// resolveStyle이 아무 클래스도 배출하지 않으므로(부재와 동일) 기본 flex-1이 그대로 남고,
// grow:true는 flex-1이 중복돼도 무해하다(계획 T4.2 "grow 기본과 충돌 없는 병합 순서").
export function Spacer({ styleClassName, styleInline }: BlockComponentProps) {
  return <div className={cx("flex-1", styleClassName)} style={styleInline} />;
}

// 스타일 적용 지점: variant별 단일 루트 요소(h1 또는 div) — 각 분기가 곧 루트다.
export function TextBlock({ node, styleClassName, styleInline }: BlockComponentProps) {
  const { t, lang } = useI18n();
  const p = (node.props ?? {}) as { i18n?: string; ko?: string; en?: string; variant?: string };
  // i18n 키(화이트리스트, 레지스트리 스키마가 강제)가 있으면 사전을, 없으면 인라인 문구를 쓴다.
  const s = p.i18n ? t(p.i18n) : ((lang === "en" ? p.en ?? p.ko : p.ko ?? p.en) ?? "");
  if (p.variant === "title")
    return (
      <h1 className={cx("text-lg font-bold tracking-tight", styleClassName)} style={styleInline}>
        {s}
      </h1>
    );
  if (p.variant === "caption")
    return (
      <div className={cx("text-[11px] text-muted", styleClassName)} style={styleInline}>
        {s}
      </div>
    );
  return (
    <div className={cx("text-sm text-fg", styleClassName)} style={styleInline}>
      {s}
    </div>
  );
}

// 스타일 적용 지점 없음 — 루트(svg)를 외부 컴포넌트(Logo)가 소유하고 className/style을
// 받지 않는다. 래퍼 요소 추가는 기각(계획 T4.2 — flex 체인 파괴)이므로 Logo가 className을
// 관통시키기 전까지 style은 의도적으로 미적용(후속 증분). 회귀 0 유지.
export function LogoBlock({ node }: BlockComponentProps) {
  const p = (node.props ?? {}) as { size?: number };
  return <Logo size={p.size ?? 44} />;
}

// 스타일 적용 지점: 루트 header(유일 요소).
export function Header({ children, styleClassName, styleInline }: BlockComponentProps) {
  return (
    <header
      className={cx("pt-safe flex shrink-0 items-center justify-between px-5 pb-3", styleClassName)}
      style={styleInline}
    >
      {children}
    </header>
  );
}

// 연결 끊김 배너 — 오프라인·서버 무응답 공통
// 스타일 적용 지점: 배너 div(표시될 때의 유일 루트 — 미표시 시 null이라 스타일 무의미).
export function ConnBanner({ styleClassName, styleInline }: BlockComponentProps) {
  const { t } = useI18n();
  const { connLost } = usePanel();
  if (!connLost) return null;
  return (
    <div
      className={cx(
        "mx-5 mb-2 shrink-0 rounded-xl border border-line bg-card px-3 py-1.5 text-center text-xs font-medium text-danger",
        styleClassName,
      )}
      style={styleInline}
    >
      {t("panel.connLost")}
    </div>
  );
}

// 스타일 적용 지점 없음 — 루트(button)를 외부 컴포넌트(ThemeToggle)가 소유한다.
// LogoBlock과 같은 이유로 미적용(래퍼 기각 — 계획 T4.2), 후속에서 className 관통 필요.
export function ThemeToggleBlock() {
  return <ThemeToggle />;
}

// 스타일 적용 지점 없음 — 루트를 외부 뷰 컴포넌트(PerfView)가 소유한다(위와 동일 사유).
export function PerfViewBlock() {
  const { up, onLogout } = usePanel();
  return <PerfView serverUp={up} onLogout={onLogout} />;
}

// 스타일 적용 지점 없음 — 루트를 외부 뷰 컴포넌트(TimelineView)가 소유한다(위와 동일 사유).
export function TimelineViewBlock() {
  const { onLogout } = usePanel();
  return <TimelineView onLogout={onLogout} />;
}
