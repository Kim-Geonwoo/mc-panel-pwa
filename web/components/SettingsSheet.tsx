"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  fetchPushConfig,
  logout,
  setNickname,
  subscribePush,
  unsubscribePush,
} from "../lib/api";
import { useI18n } from "../lib/i18n";

// 설정 바텀시트 — 알림·탭 표시·닉네임 변경·로그아웃을 한곳에 모은다.
// ProfileSheet와 동일한 오버레이 패턴(모바일 하단 시트 / sm+ 중앙 카드).
// 알림 구성은 서버가 권위: 어떤 종류를 제공하는지는 fetchPushConfig가 알려주고,
// 사용자가 고른 종류(topics)는 서버에 저장하되 mc_sv_panel_push_topics로 UI만 미러.

const PUSH_TOPICS_KEY = "mc_sv_panel_push_topics";

// events에 담겨 오는 종류 코드 → 표시 라벨 i18n 키. events에 있는 것만 렌더한다.
const KIND_LABEL: Record<string, string> = {
  server: "settings.pushKindServer",
  join: "settings.pushKindJoin",
};

function b64ToU8(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export default function SettingsSheet({
  nick,
  onNickChanged,
  tabPrefs,
  onTabPrefs,
  onLogout,
  onClose,
}: {
  nick: string;
  onNickChanged: (n: string) => void;
  tabPrefs: { perf: boolean; timeline: boolean };
  onTabPrefs: (p: { perf: boolean; timeline: boolean }) => void;
  onLogout: () => void;
  onClose: () => void;
}) {
  const { lang, setLang, t } = useI18n();

  // ── 알림 ──────────────────────────────────────────────────────────────────
  const [pushSupported, setPushSupported] = useState(true);
  const [config, setConfig] = useState<{ key: string; events: string[] } | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [topics, setTopics] = useState<string[]>([]);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    const supported = "serviceWorker" in navigator && "PushManager" in window;
    setPushSupported(supported);
    // 선택 종류 UI 미러 복원(서버가 최종 권위 — 초기 체크 상태 힌트로만 사용)
    try {
      const raw = localStorage.getItem(PUSH_TOPICS_KEY);
      if (raw) setTopics(JSON.parse(raw) as string[]);
    } catch {
      /* 무시 */
    }
    let alive = true;
    fetchPushConfig()
      .then((c) => alive && setConfig(c))
      .catch(() => alive && setConfig({ key: "", events: [] })); // 불가 → 미제공 취급
    if (supported) {
      navigator.serviceWorker.ready
        .then((reg) => reg.pushManager.getSubscription())
        .then((s) => alive && setSubscribed(!!s))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, []);

  function persistTopics(next: string[]) {
    setTopics(next);
    try {
      localStorage.setItem(PUSH_TOPICS_KEY, JSON.stringify(next));
    } catch {
      /* 무시 */
    }
  }

  // 마스터 스위치 — 구독/해지. 권한 거부·미지원은 조용히 유지.
  async function toggleMaster() {
    if (pushBusy || !config) return;
    setPushBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const cur = await reg.pushManager.getSubscription();
      if (cur) {
        await unsubscribePush(cur.endpoint);
        await cur.unsubscribe();
        setSubscribed(false);
      } else {
        if ((await Notification.requestPermission()) !== "granted") return;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: b64ToU8(config.key),
        });
        // 아무 종류도 안 골랐으면 전체 종류로 기본
        const valid = topics.filter((t) => config.events.includes(t));
        const next = valid.length ? valid : [...config.events];
        persistTopics(next);
        await subscribePush(sub.toJSON(), next);
        setSubscribed(true);
      }
    } catch {
      /* 미지원·거부 — 조용히 */
    } finally {
      setPushBusy(false);
    }
  }

  // 종류 체크 변경 — 구독 중이면 새 topics로 재전송(upsert), 미구독이면 로컬만 저장.
  // 구독 중 전부 해제는 마스터 해지로 처리한다: 빈 topics를 서버에 보내면 백엔드
  // normalizeTopics가 "활성 전체"로 폴백해 UI(전부 해제)와 서버(전부 수신)가 어긋난다.
  async function toggleKind(kind: string) {
    if (!config) return;
    const raw = topics.includes(kind)
      ? topics.filter((t) => t !== kind)
      : [...topics, kind];
    // 서버 제공 종류와 교집합 — stale localStorage 항목이 서버로 가지 않게(마스터 경로와 대칭)
    const next = raw.filter((t) => config.events.includes(t));
    persistTopics(next);
    if (!subscribed) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const cur = await reg.pushManager.getSubscription();
      if (!cur) return;
      if (next.length === 0) {
        await unsubscribePush(cur.endpoint);
        await cur.unsubscribe();
        setSubscribed(false);
      } else {
        await subscribePush(cur.toJSON(), next);
      }
    } catch {
      /* 조용히 */
    }
  }

  // ── 닉네임 변경 ────────────────────────────────────────────────────────────
  const [nickInput, setNickInput] = useState(nick);
  const [nickBusy, setNickBusy] = useState(false);
  const [nickErr, setNickErr] = useState<string | null>(null);
  const [nickOk, setNickOk] = useState(false);
  const trimmed = nickInput.trim();
  const nickValid = trimmed.length >= 2 && trimmed.length <= 16;

  async function saveNick() {
    if (!nickValid || nickBusy || trimmed === nick) return;
    setNickBusy(true);
    setNickErr(null);
    setNickOk(false);
    try {
      await setNickname(trimmed);
      onNickChanged(trimmed); // 낙관적 전송 라벨 등 갱신. 토큰/세션은 그대로 — 재로그인 없음.
      setNickOk(true);
    } catch (e) {
      setNickErr(
        e instanceof Error && e.message === "taken"
          ? t("settings.nickErrTaken")
          : t("settings.nickErrLength"),
      );
    } finally {
      setNickBusy(false);
    }
  }

  const pushReady = config !== null;
  const pushOffered = pushSupported && pushReady && config.events.length > 0;

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 48, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 48, opacity: 0 }}
        transition={{ duration: 0.22 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t("settings.title")}
        className="pb-safe max-h-[85vh] w-full max-w-[420px] overflow-y-auto rounded-t-2xl border-t border-line bg-card p-5 shadow-card sm:rounded-2xl sm:border"
      >
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-line sm:hidden" />
        <div className="flex items-center">
          <h2 className="text-base font-bold text-fg">{t("settings.title")}</h2>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="ml-auto grid h-8 w-8 place-items-center rounded-full border border-line text-muted transition-colors hover:text-fg"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="mt-4 space-y-3">
        {/* ① 알림 */}
        <section className="rounded-2xl border border-line bg-card2 p-4">
          <h3 className="text-sm font-semibold text-fg">{t("settings.pushTitle")}</h3>
          {!pushSupported ? (
            <p className="mt-2 text-[11px] leading-relaxed text-muted">{t("settings.pushUnsupported")}</p>
          ) : !pushReady ? (
            <div className="mt-2 space-y-2.5">
              <div className="h-9 w-full rounded-xl bg-line motion-safe:animate-pulse" />
              <div className="h-6 w-2/3 rounded bg-line motion-safe:animate-pulse" />
              <div className="h-6 w-1/2 rounded bg-line motion-safe:animate-pulse" />
            </div>
          ) : !pushOffered ? (
            <p className="mt-2 text-[11px] leading-relaxed text-muted">{t("settings.pushNotOffered")}</p>
          ) : (
            <>
              <div className="mt-2 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-fg">{t("settings.pushLabel")}</div>
                  <div className="text-xs text-muted">
                    {subscribed ? t("settings.pushSubscribed") : t("settings.pushOff")}
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={subscribed}
                  aria-label={t("settings.pushToggleAria")}
                  onClick={toggleMaster}
                  disabled={pushBusy}
                  className={[
                    "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
                    subscribed ? "bg-accent" : "bg-line",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "inline-block h-5 w-5 transform rounded-full bg-card shadow-card transition-transform",
                      subscribed ? "translate-x-5" : "translate-x-0.5",
                    ].join(" ")}
                  />
                </button>
              </div>
              <div className="mt-2 space-y-0.5">
                {config.events
                  .filter((ev) => KIND_LABEL[ev])
                  .map((ev) => (
                    <CheckRow
                      key={ev}
                      checked={topics.includes(ev)}
                      onChange={() => toggleKind(ev)}
                      label={t(KIND_LABEL[ev])}
                    />
                  ))}
              </div>
            </>
          )}
        </section>

        {/* ② 탭 표시 */}
        <section className="rounded-2xl border border-line bg-card2 p-4">
          <h3 className="text-sm font-semibold text-fg">{t("settings.tabsTitle")}</h3>
          <div className="mt-1 space-y-0.5">
            <CheckRow
              checked={tabPrefs.perf}
              onChange={() => onTabPrefs({ ...tabPrefs, perf: !tabPrefs.perf })}
              label={t("settings.tabsPerf")}
            />
            <CheckRow
              checked={tabPrefs.timeline}
              onChange={() => onTabPrefs({ ...tabPrefs, timeline: !tabPrefs.timeline })}
              label={t("settings.tabsTimeline")}
            />
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">{t("settings.tabsNote")}</p>
        </section>

        {/* ③ 언어 — 테마 토글과 같은 표시 계열 설정 */}
        <section className="rounded-2xl border border-line bg-card2 p-4">
          <h3 className="text-sm font-semibold text-fg">{t("settings.langTitle")}</h3>
          <div className="mt-2 flex gap-1 rounded-xl bg-card p-1">
            {(["ko", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                aria-pressed={lang === l}
                className={[
                  "min-h-[40px] flex-1 rounded-lg text-sm font-medium transition-colors",
                  lang === l ? "bg-accent text-accent-fg shadow-card" : "text-muted hover:text-fg",
                ].join(" ")}
              >
                {l === "ko" ? "한국어" : "English"}
              </button>
            ))}
          </div>
        </section>

        {/* ④ 닉네임 변경 */}
        <section className="rounded-2xl border border-line bg-card2 p-4">
          <h3 className="text-sm font-semibold text-fg">{t("settings.nickTitle")}</h3>
          <div className="mt-2 flex items-center gap-2">
            <input
              value={nickInput}
              onChange={(e) => {
                setNickInput(e.target.value);
                setNickErr(null);
                setNickOk(false);
              }}
              onKeyDown={(e) => {
                // 한글 IME 조합 확정 Enter(keyCode 229)는 무시 — 마지막 글자 유실·이중 제출 방지
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === "Enter") saveNick();
              }}
              maxLength={16}
              aria-label={t("settings.nickAria")}
              placeholder={t("settings.nickPlaceholder")}
              className="min-w-0 flex-1 rounded-xl border border-line bg-card px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={saveNick}
              disabled={!nickValid || nickBusy || trimmed === nick}
              className="shrink-0 rounded-xl bg-accent px-4 py-2 text-sm font-bold text-accent-fg transition active:scale-[0.99] disabled:opacity-40"
            >
              {nickBusy ? t("settings.nickSaving") : t("common.save")}
            </button>
          </div>
          {nickErr && (
            <div className="mt-1.5 text-xs text-danger" role="alert">
              {nickErr}
            </div>
          )}
          {nickOk && <div className="mt-1.5 text-xs text-accent">{t("settings.nickChanged")}</div>}
        </section>

        {/* ⑤ 로그아웃 */}
        <section className="rounded-2xl border border-line bg-card2 p-4">
          <button
            type="button"
            onClick={async () => {
              await logout();
              onLogout();
            }}
            className="w-full rounded-xl border border-line py-2.5 text-sm font-semibold text-danger transition-colors hover:bg-card active:scale-[0.99]"
          >
            {t("common.logout")}
          </button>
        </section>
        </div>
      </motion.div>
    </motion.div>
  );
}

// 네이티브 체크박스(sr-only) + 커스텀 시각 박스. 행 전체가 클릭 가능.
function CheckRow({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 py-1.5">
      <input type="checkbox" checked={checked} onChange={onChange} className="sr-only" />
      <span
        className={[
          "grid h-[18px] w-[18px] shrink-0 place-items-center rounded border transition-colors",
          checked ? "border-accent bg-accent text-accent-fg" : "border-line text-transparent",
        ].join(" ")}
      >
        {checked && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 12l4 4L19 7"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <span className="text-sm text-fg">{label}</span>
    </label>
  );
}
