import { describe, it, expect } from "vitest";
import { countBlockType } from "./layoutQuery";
import type { Layout } from "./schema";

const lbl = { ko: "", en: "" };

describe("countBlockType", () => {
  it("counts implicit defaults: DEFAULT_SCREEN and known-tab default mapping", () => {
    const l: Layout = { version: 1 }; // screen·tabs 모두 부재
    expect(countBlockType(l, "tabbar")).toBe(1); // DEFAULT_SCREEN의 탭바
    expect(countBlockType(l, "tab-content")).toBe(1);
    expect(countBlockType(l, "conn-banner")).toBe(1);
    expect(countBlockType(l, "chat-feed")).toBe(1); // chat 탭 기본 매핑
    expect(countBlockType(l, "perf-view")).toBe(1); // perf 탭 기본 매핑
    expect(countBlockType(l, "timeline-view")).toBe(1);
  });

  it("counts the explicit screen tree recursively", () => {
    const l: Layout = {
      version: 1,
      screen: {
        type: "vstack",
        children: [
          { type: "chat-feed" },
          { type: "hstack", children: [{ type: "chat-feed" }, { type: "text" }] },
        ],
      },
      tabs: [{ id: "info", label: lbl, content: [{ type: "text" }] }],
    };
    // 화면 2개 + 강제 포함되는 chat 탭의 기본 매핑 1개
    expect(countBlockType(l, "chat-feed")).toBe(3);
    expect(countBlockType(l, "text")).toBe(2); // 화면 1 + info 탭 content 1
    expect(countBlockType(l, "tabbar")).toBe(0); // 명시 화면에 없으면 0
  });

  it("prefers explicit tab content over the default mapping", () => {
    const l: Layout = {
      version: 1,
      screen: { type: "vstack" },
      tabs: [
        { id: "chat", label: lbl, content: [{ type: "text" }] },
        { id: "perf", label: lbl },
      ],
    };
    expect(countBlockType(l, "chat-feed")).toBe(0); // 명시 content가 기본 매핑을 대체
    expect(countBlockType(l, "perf-view")).toBe(1); // content 없음 → 기본 매핑 계수
  });

  it("counts nested blocks inside tab content", () => {
    const l: Layout = {
      version: 1,
      screen: { type: "vstack" },
      tabs: [
        {
          id: "info",
          label: lbl,
          content: [{ type: "vstack", children: [{ type: "conn-banner" }] }],
        },
      ],
    };
    expect(countBlockType(l, "conn-banner")).toBe(1);
  });

  it("always counts the forced chat tab's default mapping", () => {
    const l: Layout = {
      version: 1,
      screen: { type: "vstack" },
      tabs: [{ id: "perf", label: lbl }],
    };
    // 탭 목록에 chat이 없어도 렌더러(resolveTabs)는 chat을 항상 포함한다
    expect(countBlockType(l, "chat-feed")).toBe(1);
  });

  it("falls back to default tabs when tabs is empty", () => {
    const l: Layout = { version: 1, screen: { type: "vstack" }, tabs: [] };
    expect(countBlockType(l, "timeline-view")).toBe(1); // resolveTabs와 동일 폴백
  });

  it("ignores duplicate tab ids beyond the first", () => {
    const l: Layout = {
      version: 1,
      screen: { type: "vstack" },
      tabs: [
        { id: "info", label: lbl, content: [{ type: "server-status" }] },
        { id: "info", label: lbl, content: [{ type: "server-status" }] },
      ],
    };
    expect(countBlockType(l, "server-status")).toBe(1); // 중복 id는 첫 항목만
  });
});
