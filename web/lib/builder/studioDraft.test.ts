import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LAYOUT } from "../api";
import { clearDraft, DRAFT_KEY, loadDraft, saveDraft } from "./studioDraft";

// jsdom의 localStorage를 그대로 쓴다 — 각 테스트가 남긴 상태를 정리한다.
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("saveDraft / loadDraft", () => {
  it("roundtrips a valid layout", () => {
    const l = { ...DEFAULT_LAYOUT, meta: { title: "커스텀" } };
    saveDraft(l);
    expect(loadDraft()).toEqual(l);
  });

  it("returns null when nothing is stored", () => {
    expect(loadDraft()).toBeNull();
  });

  it("returns null for corrupted JSON", () => {
    localStorage.setItem(DRAFT_KEY, "{not json");
    expect(loadDraft()).toBeNull();
  });

  it("returns null for JSON that fails schema validation", () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ version: 999 }));
    expect(loadDraft()).toBeNull();
    localStorage.setItem(DRAFT_KEY, JSON.stringify("v1"));
    expect(loadDraft()).toBeNull();
  });

  it("strips unknown top-level keys on load (forward compat)", () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ version: 1, mystery: true }));
    expect(loadDraft()).toEqual({ version: 1 });
  });

  it("does not throw when storage writes fail", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => saveDraft(DEFAULT_LAYOUT)).not.toThrow();
  });
});

describe("clearDraft", () => {
  it("removes the stored draft", () => {
    saveDraft(DEFAULT_LAYOUT);
    clearDraft();
    expect(loadDraft()).toBeNull();
  });
});
