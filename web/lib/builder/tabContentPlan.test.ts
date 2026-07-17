import { describe, it, expect } from "vitest";
import { planTabContent } from "./tabContentPlan";

const keep = (ty: string) => ty === "chat-feed"; // 레지스트리 대신 주입하는 keepMounted 판정
const lbl = { ko: "", en: "" };

describe("planTabContent", () => {
  it("maps known tabs to their default content", () => {
    const plan = planTabContent(["chat", "perf", "timeline"], "chat", undefined, keep);
    expect(plan.map((e) => e.tabId)).toEqual(["chat", "perf", "timeline"]);
    expect(plan[0]).toMatchObject({ active: true, mounted: true, blocks: [{ type: "chat-feed" }] });
    expect(plan[1]).toMatchObject({ active: false, mounted: false, blocks: [{ type: "perf-view" }] });
    expect(plan[2]).toMatchObject({ active: false, mounted: false });
  });

  it("keeps chat mounted while another tab is active", () => {
    const plan = planTabContent(["chat", "perf"], "perf", undefined, keep);
    expect(plan.find((e) => e.tabId === "chat")).toMatchObject({ active: false, mounted: true });
    expect(plan.find((e) => e.tabId === "perf")).toMatchObject({ active: true, mounted: true });
  });

  it("uses layout tab content when provided", () => {
    const tabs = [{ id: "chat", label: lbl, content: [{ type: "text", props: { ko: "공지" } }] }];
    const plan = planTabContent(["chat"], "chat", tabs, keep);
    expect(plan[0].blocks).toEqual([{ type: "text", props: { ko: "공지" } }]);
  });

  it("omits tabs that are not visible", () => {
    const plan = planTabContent(["chat"], "chat", undefined, keep);
    expect(plan.map((e) => e.tabId)).toEqual(["chat"]);
  });

  it("unknown visible tab without content yields no blocks (renders nothing)", () => {
    const plan = planTabContent(["chat", "shop"], "shop", undefined, keep);
    expect(plan.find((e) => e.tabId === "shop")).toMatchObject({ active: true, blocks: [] });
  });
});
