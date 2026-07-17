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

// 직렬화 결과가 정확히 target 바이트가 되도록 ko 문구를 ASCII로 패딩한 레이아웃.
function layoutOfBytes(target: number): Layout {
  const shell: Layout = { version: 1, screen: { type: "text", props: { ko: "" } } };
  const shellBytes = new TextEncoder().encode(JSON.stringify(shell)).length;
  return {
    version: 1,
    screen: { type: "text", props: { ko: "a".repeat(target - shellBytes) } },
  };
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

  it("accepts exactly 256KiB and rejects one byte over", () => {
    const limit = 256 * 1024;
    expect(validateForPublish(layoutOfBytes(limit)).ok).toBe(true);
    expect(validateForPublish(layoutOfBytes(limit + 1))).toEqual({
      ok: false,
      reasonKey: "studio.check.bytes",
    });
  });

  it("counts UTF-8 bytes, not UTF-16 code units", () => {
    // "가" = UTF-8 3바이트·UTF-16 1유닛 — 문자 수로는 한도 미만이어도 바이트로는 초과.
    // 서버(maxLayoutBytes)가 바이트 기준이므로 사전검사도 바이트로 세는지 고정한다.
    const l: Layout = {
      version: 1,
      screen: { type: "text", props: { ko: "가".repeat(90_000) } },
    };
    expect(JSON.stringify(l).length).toBeLessThan(256 * 1024);
    expect(validateForPublish(l)).toEqual({ ok: false, reasonKey: "studio.check.bytes" });
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
