"use client";

// 재귀 블록 렌더러 — Layout JSON 트리를 레지스트리 화이트리스트로만 그린다(스펙 §4).
// 불변식: 절대 throw하지 않는다. 미지 타입·손상 props·블록 내부 오류는 모두
// 해당 블록만 폴백/생략하고 나머지 트리는 정상 렌더한다(부분 실패 격리).
import { Component, type ReactNode } from "react";
import { REGISTRY } from "./registry";
import type { Block } from "./schema";

// 블록 하나의 렌더 오류를 격리하는 경계 — 죽은 블록은 조용히 사라진다.
class BlockBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    // 운영 콘솔 스팸 방지 — 죽은 블록은 조용히 사라지고, 경고는 개발에서만 남긴다.
    if (process.env.NODE_ENV !== "production") console.warn("block render failed:", err);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// 폴백 — 개발은 사유(미지 타입/props 검증 실패)를 표기, 운영은 조용히 생략(스펙 §2 규칙).
function UnknownBlock({ type, reason }: { type: string; reason: "unknown" | "props" }) {
  if (process.env.NODE_ENV === "production") return null;
  return (
    <div className="rounded-lg border border-dashed border-line px-3 py-2 text-xs text-muted">
      {reason === "props" ? "invalid props" : "unknown block"}: {type}
    </div>
  );
}

// 자식 블록의 React key — 레이아웃 편집·재정렬 시 상태가 다른 블록으로 옮겨붙지
// 않도록 선택적 props.key(문자열)를 우선하고, 없으면 타입 한정 인덱스로 폴백한다.
export function blockKey(node: Block, index: number): string {
  const k = node.props?.key;
  return typeof k === "string" ? k : `${node.type}:${index}`;
}

export default function BlockRenderer({ node }: { node: Block }) {
  // Object.hasOwn — "__proto__" 같은 타입명이 프로토타입 체인을 타는 것을 차단.
  const def = Object.hasOwn(REGISTRY, node.type) ? REGISTRY[node.type] : undefined;
  if (!def) return <UnknownBlock type={node.type} reason="unknown" />;
  if (def.propsSchema && !def.propsSchema.safeParse(node.props ?? {}).success) {
    return <UnknownBlock type={node.type} reason="props" />;
  }
  const kids =
    def.kind === "layout"
      ? node.children?.map((c, i) => <BlockRenderer key={blockKey(c, i)} node={c} />)
      : undefined;
  const C = def.component;
  return (
    <BlockBoundary>
      <C node={node}>{kids}</C>
    </BlockBoundary>
  );
}
