import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { LangProvider } from "../lib/i18n";
import SettingsSheet from "./SettingsSheet";

// 로그아웃 시 이 기기의 푸시 구독이 해지되는지 확인한다.
// 구독은 endpoint가 키라 세션과 묶여 있지 않고 발송부는 세션 유효성을 보지 않는다.
// 해지하지 않으면 로그아웃한 기기가 계속 알림을 받고 앱에서 끌 방법이 없다.
const unsubscribePush = vi.fn(async (_endpoint: string) => {});
const logout = vi.fn(async () => {});

vi.mock("../lib/api", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../lib/api")>();
  return {
    ...orig,
    fetchPushConfig: async () => ({ key: "", events: [] }),
    setNickname: async () => {},
    subscribePush: async () => {},
    logout: () => logout(),
    unsubscribePush: (e: string) => unsubscribePush(e),
  };
});

const ENDPOINT = "https://push.example.com/sub/abc";
let swUnsubscribe: ReturnType<typeof vi.fn>;

function installServiceWorker(hasSubscription: boolean) {
  swUnsubscribe = vi.fn(async () => true);
  const sub = hasSubscription ? { endpoint: ENDPOINT, unsubscribe: swUnsubscribe } : null;
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => sub } }) },
  });
  // 컴포넌트는 "PushManager" in window 로 지원 여부를 판단한다.
  (window as unknown as { PushManager: unknown }).PushManager = class {};
}

beforeEach(() => {
  localStorage.setItem("panel-lang", "ko");
  unsubscribePush.mockClear();
  logout.mockClear();
});

afterEach(() => {
  Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, "serviceWorker");
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, "PushManager");
});

async function draw() {
  const r = render(
    <LangProvider>
      <SettingsSheet
        nick="tester"
        onNickChanged={() => {}}
        tabPrefs={{ perf: true, timeline: true }}
        onTabPrefs={() => {}}
        onLogout={() => {}}
        onClose={() => {}}
      />
    </LangProvider>,
  );
  await act(async () => {});
  return r;
}

describe("SettingsSheet 로그아웃", () => {
  it("구독이 있으면 로그아웃 전에 서버·브라우저 양쪽에서 해지한다", async () => {
    installServiceWorker(true);
    await draw();
    await act(async () => {
      screen.getByRole("button", { name: "로그아웃" }).click();
    });
    expect(unsubscribePush).toHaveBeenCalledWith(ENDPOINT);
    expect(swUnsubscribe).toHaveBeenCalled();
    expect(logout).toHaveBeenCalled();
  });

  it("구독이 없으면 해지를 시도하지 않고 그대로 로그아웃한다", async () => {
    installServiceWorker(false);
    await draw();
    await act(async () => {
      screen.getByRole("button", { name: "로그아웃" }).click();
    });
    expect(unsubscribePush).not.toHaveBeenCalled();
    expect(logout).toHaveBeenCalled();
  });
});
