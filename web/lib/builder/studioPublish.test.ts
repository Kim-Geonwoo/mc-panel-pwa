import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, LayoutPutError, UnauthorizedError } from "../api";
import type { Block, Layout } from "./schema";
import { publishErrorKey, validateForPublish } from "./studioPublish";

// n개 노드의 사슬 트리(깊이 = n)를 만든다 — 한도 검사용.
function chain(n: number): Block {
  let b: Block = { type: "spacer" };
  for (let i = 1; i < n; i++) b = { type: "vstack", children: [b] };
  return b;
}

// 노드 n개의 평평한 트리(루트 + 자식 n-1)를 만든다.
function wide(n: number): Block {
  return { type: "vstack", children: Array.from({ length: n - 1 }, () => ({ type: "spacer" })) };
}

describe("validateForPublish", () => {
  it("accepts the default layout and a small screen", () => {
    expect(validateForPublish(DEFAULT_LAYOUT).ok).toBe(true);
    const l: Layout = { version: 1, screen: wide(10) };
    expect(validateForPublish(l).ok).toBe(true);
  });

  it("accepts exactly 500 nodes and rejects 501", () => {
    expect(validateForPublish({ version: 1, screen: wide(500) }).ok).toBe(true);
    const r = validateForPublish({ version: 1, screen: wide(501) });
    expect(r).toEqual({ ok: false, reasonKey: "studio.check.nodes" });
  });

  it("accepts depth 20 and rejects depth 21", () => {
    expect(validateForPublish({ version: 1, screen: chain(20) }).ok).toBe(true);
    const r = validateForPublish({ version: 1, screen: chain(21) });
    expect(r).toEqual({ ok: false, reasonKey: "studio.check.depth" });
  });

  it("checks each tab content tree as well", () => {
    const l: Layout = {
      version: 1,
      tabs: [{ id: "chat", label: { ko: "채팅", en: "Chat" }, content: [chain(21)] }],
    };
    expect(validateForPublish(l)).toEqual({ ok: false, reasonKey: "studio.check.depth" });
  });

  it("flags schema violations (e.g. overlong title)", () => {
    const l = { version: 1, meta: { title: "x".repeat(81) } } as Layout;
    expect(validateForPublish(l)).toEqual({ ok: false, reasonKey: "studio.check.schema" });
  });
});

describe("publishErrorKey", () => {
  it("maps auth, demo, forbidden, invalid and rate-limit errors", () => {
    expect(publishErrorKey(new UnauthorizedError())).toBe("studio.publish.errAuth");
    expect(publishErrorKey(new LayoutPutError(403, "demo"))).toBe("studio.publish.errDemo");
    expect(publishErrorKey(new LayoutPutError(403, "forbidden"))).toBe(
      "studio.publish.errForbidden",
    );
    expect(publishErrorKey(new LayoutPutError(400, ""))).toBe("studio.publish.errInvalid");
    expect(publishErrorKey(new LayoutPutError(429, "slow_down"))).toBe(
      "studio.publish.errSlowDown",
    );
  });

  it("maps everything else to the generic failure", () => {
    expect(publishErrorKey(new Error("network"))).toBe("studio.publish.errFailed");
    expect(publishErrorKey(new LayoutPutError(500, ""))).toBe("studio.publish.errFailed");
    expect(publishErrorKey(undefined)).toBe("studio.publish.errFailed");
  });
});
