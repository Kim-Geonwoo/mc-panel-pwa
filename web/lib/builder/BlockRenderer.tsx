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
    console.warn("block render failed:", err);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// 미지 타입 폴백 — 개발은 눈에 띄는 표기, 운영은 조용히 생략(스펙 §2 규칙).
function UnknownBlock({ type }: { type: string }) {
  if (process.env.NODE_ENV === "production") return null;
  return (
    <div className="rounded-lg border border-dashed border-line px-3 py-2 text-xs text-muted">
      unknown block: {type}
    </div>
  );
}

export default function BlockRenderer({ node }: { node: Block }) {
  // Object.hasOwn — "__proto__" 같은 타입명이 프로토타입 체인을 타는 것을 차단.
  const def = Object.hasOwn(REGISTRY, node.type) ? REGISTRY[node.type] : undefined;
  if (!def) return <UnknownBlock type={node.type} />;
  if (def.propsSchema && !def.propsSchema.safeParse(node.props ?? {}).success) {
    return <UnknownBlock type={node.type} />;
  }
  const kids =
    def.kind === "layout"
      ? node.children?.map((c, i) => <BlockRenderer key={i} node={c} />)
      : undefined;
  const C = def.component;
  return (
    <BlockBoundary>
      <C node={node}>{kids}</C>
    </BlockBoundary>
  );
}
