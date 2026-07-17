import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { LangProvider } from "../i18n";
import BlockRenderer from "./BlockRenderer";
import type { Block } from "./schema";

// jsdom의 브라우저 언어는 en-US — 저장된 선택을 ko로 고정해 현행 기본과 동일하게 검증.
beforeEach(() => localStorage.setItem("panel-lang", "ko"));

function draw(node: Block) {
  return render(
    <LangProvider>
      <BlockRenderer node={node} />
    </LangProvider>,
  );
}

describe("BlockRenderer", () => {
  it("renders a nested layout tree", () => {
    draw({
      type: "vstack",
      children: [
        { type: "text", props: { ko: "안녕", en: "Hello" } },
        { type: "hstack", children: [{ type: "text", props: { ko: "중첩", en: "Nested" } }] },
      ],
    });
    expect(screen.getByText("안녕")).toBeInTheDocument();
    expect(screen.getByText("중첩")).toBeInTheDocument();
  });

  it("falls back on an unknown type without throwing (siblings still render)", () => {
    draw({
      type: "vstack",
      children: [{ type: "no-such-block" }, { type: "text", props: { ko: "생존" } }],
    });
    expect(screen.getByText(/unknown block/)).toBeInTheDocument(); // dev 표기
    expect(screen.getByText("생존")).toBeInTheDocument();
  });

  it("falls back when props fail schema validation (distinct dev message)", () => {
    draw({ type: "text", props: { variant: "huge" } });
    expect(screen.getByText(/invalid props: text/)).toBeInTheDocument();
  });

  it("uses props.key or type-scoped index as stable child keys (no crash on reorder)", () => {
    const { rerender } = render(
      <LangProvider>
        <BlockRenderer
          node={{
            type: "vstack",
            children: [
              { type: "text", props: { key: "a", ko: "첫" } },
              { type: "text", props: { key: "b", ko: "둘" } },
            ],
          }}
        />
      </LangProvider>,
    );
    rerender(
      <LangProvider>
        <BlockRenderer
          node={{
            type: "vstack",
            children: [
              { type: "text", props: { key: "b", ko: "둘" } },
              { type: "text", props: { key: "a", ko: "첫" } },
            ],
          }}
        />
      </LangProvider>,
    );
    expect(screen.getByText("첫")).toBeInTheDocument();
    expect(screen.getByText("둘")).toBeInTheDocument();
  });

  it("is safe against prototype-polluting type names", () => {
    expect(() => draw({ type: "__proto__" })).not.toThrow();
    expect(() => draw({ type: "constructor" })).not.toThrow();
  });

  it("renders the title text via the i18n whitelist key", () => {
    draw({ type: "text", props: { i18n: "panel.title", variant: "title" } });
    expect(screen.getByRole("heading")).toHaveTextContent("마크서버");
  });

  it("never throws on random trees (seeded, known+unknown mix)", () => {
    // 시드 고정 의사난수(mulberry32) — 재현 가능한 무작위 트리 30개.
    let s = 20260717;
    const rnd = () => {
      s |= 0; s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const types = ["vstack", "hstack", "spacer", "text", "logo", "bogus", "__proto__"];
    const junkProps = () =>
      [undefined, {}, { ko: "x" }, { variant: "huge" }, { size: -1 }, { i18n: "evil.key" }][
        Math.floor(rnd() * 6)
      ];
    const tree = (depth: number): Block => ({
      type: types[Math.floor(rnd() * types.length)],
      props: junkProps() as Block["props"],
      children:
        depth > 0 && rnd() < 0.7
          ? Array.from({ length: Math.floor(rnd() * 3) }, () => tree(depth - 1))
          : undefined,
    });
    for (let i = 0; i < 30; i++) {
      expect(() => draw(tree(5)).unmount()).not.toThrow();
    }
  });
});
