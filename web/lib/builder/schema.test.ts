import { describe, it, expect } from "vitest";
import { parseLayout, SCHEMA_VERSION } from "./schema";

describe("parseLayout", () => {
  it("accepts a minimal valid layout", () => {
    const l = parseLayout({ version: 1, tabs: [{ id: "chat", label: { ko: "채팅", en: "Chat" } }] });
    expect(l?.version).toBe(1);
  });

  it("ignores unknown top-level fields (additive-only)", () => {
    const l = parseLayout({ version: 1, futureField: { anything: true } });
    expect(l?.version).toBe(1);
  });

  it("returns null (no throw) on garbage or unsafe input", () => {
    const bad: unknown[] = [
      null,
      1,
      "x",
      {},
      { version: 99 },
      { version: 1, theme: { accent: "javascript:alert(1)" } },
      { version: 1, tabs: [{ id: "", label: { ko: "", en: "" } }] },
    ];
    for (const b of bad) expect(parseLayout(b)).toBeNull();
  });

  it("rejects an over-deep tree", () => {
    let node: unknown = { type: "leaf" };
    for (let i = 0; i < 30; i++) node = { type: "vstack", children: [node] };
    expect(parseLayout({ version: 1, screen: node })).toBeNull();
  });

  it("SCHEMA_VERSION is 1", () => expect(SCHEMA_VERSION).toBe(1));
});
