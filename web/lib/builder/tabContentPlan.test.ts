import { describe, it, expect } from "vitest";
import { planTabContent } from "./tabContentPlan";

const keep = (ty: string) => ty === "chat-feed"; // 레지스트리 대신 주입하는 keepMounted 판정
const lbl = { ko: "", en: "" };

describe("planTabContent", () => {
  it("maps known tabs to their default content", () => {
    const plan = planTabContent(["chat", "perf", "timeline"], "chat", undefined, keep);
    expect(plan.map((e) => e.tabId)).toEqual(["chat", "perf", "timeline"]);
    expect(plan[0]).toMatchObject({ active: true, mounted: true, blocks: [{ type: "chat-feed" }] });
    // 비활성 탭은 keepMounted 블록만 남는다(스스로 숨지 못하는 블록 노출 방지)
    expect(plan[1]).toMatchObject({ active: false, mounted: false, blocks: [] });
    expect(plan[2]).toMatchObject({ active: false, mounted: false, blocks: [] });
  });

  it("keeps only keepMounted blocks for an inactive tab with mixed content", () => {
    const tabs = [
      { id: "chat", label: lbl, content: [{ type: "chat-feed" }, { type: "text", props: { ko: "공지" } }] },
      { id: "perf", label: lbl },
    ];
    const plan = planTabContent(["chat", "perf"], "perf", tabs, keep);
    // 비활성 chat: text는 스스로 숨지 못하므로 제외, chat-feed만 마운트 유지
    expect(plan.find((e) => e.tabId === "chat")).toMatchObject({
      active: false,
      mounted: true,
      blocks: [{ type: "chat-feed" }],
    });
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
