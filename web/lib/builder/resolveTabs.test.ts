import { describe, it, expect } from "vitest";
import { resolveTabs } from "./resolveTabs";

const ALL = { perf: true, timeline: true };
const lbl = { ko: "", en: "" };

describe("resolveTabs", () => {
  it("defaults to chat/perf/timeline when no layout (regression-0)", () => {
    expect(resolveTabs(undefined, ALL)).toEqual(["chat", "perf", "timeline"]);
    expect(resolveTabs({ tabs: [] }, ALL)).toEqual(["chat", "perf", "timeline"]);
  });

  it("follows the layout order", () => {
    const tabs = [
      { id: "timeline", label: lbl },
      { id: "chat", label: lbl },
      { id: "perf", label: lbl },
    ];
    expect(resolveTabs({ tabs }, ALL)).toEqual(["timeline", "chat", "perf"]);
  });

  it("drops layout tabs with enabled:false", () => {
    const tabs = [
      { id: "chat", label: lbl },
      { id: "perf", label: lbl, enabled: false },
      { id: "timeline", label: lbl },
    ];
    expect(resolveTabs({ tabs }, ALL)).toEqual(["chat", "timeline"]);
  });

  it("applies the personal prefs overlay", () => {
    expect(resolveTabs(undefined, { perf: false, timeline: true })).toEqual(["chat", "timeline"]);
    expect(resolveTabs(undefined, { perf: true, timeline: false })).toEqual(["chat", "perf"]);
  });

  it("passes unknown tab ids through in layout order (B1)", () => {
    const tabs = [
      { id: "info", label: lbl },
      { id: "chat", label: lbl },
      { id: "shop", label: lbl },
      { id: "perf", label: lbl },
    ];
    expect(resolveTabs({ tabs }, ALL)).toEqual(["info", "chat", "shop", "perf"]);
  });

  it("drops unknown tabs with enabled:false", () => {
    const tabs = [
      { id: "chat", label: lbl },
      { id: "shop", label: lbl, enabled: false },
    ];
    expect(resolveTabs({ tabs }, ALL)).toEqual(["chat"]);
  });

  it("keeps unknown tabs regardless of personal prefs", () => {
    const tabs = [
      { id: "chat", label: lbl },
      { id: "shop", label: lbl },
      { id: "perf", label: lbl },
    ];
    expect(resolveTabs({ tabs }, { perf: false, timeline: false })).toEqual(["chat", "shop"]);
  });

  it("prepends chat when the layout has only unknown tabs", () => {
    expect(resolveTabs({ tabs: [{ id: "shop", label: lbl }] }, ALL)).toEqual(["chat", "shop"]);
  });

  it("always includes chat even if the layout omits or disables it", () => {
    expect(resolveTabs({ tabs: [{ id: "perf", label: lbl }] }, ALL)).toEqual(["chat", "perf"]);
    expect(resolveTabs({ tabs: [{ id: "chat", label: lbl, enabled: false }] }, ALL)).toEqual(["chat"]);
  });

  it("dedupes repeated tab ids", () => {
    const tabs = [
      { id: "chat", label: lbl },
      { id: "chat", label: lbl },
      { id: "shop", label: lbl },
      { id: "shop", label: lbl },
      { id: "perf", label: lbl },
    ];
    expect(resolveTabs({ tabs }, ALL)).toEqual(["chat", "shop", "perf"]);
  });
});
