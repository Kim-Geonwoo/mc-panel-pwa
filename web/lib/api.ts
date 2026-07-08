// mc_sv-panel Go 백엔드용 경량 API 클라이언트.
// 프로덕션에서는 동일 출처(Go가 정적 사이트와 /api를 함께 서빙). 로컬 `next dev`에서는
// NEXT_PUBLIC_API_BASE=http://localhost:8080으로 설정한다(PANEL_ALLOW_ORIGIN을 켠 Go).

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
const TOKEN_KEY = "mc_sv_panel_token";

export type Player = { name: string; uuid: string; ping: number };

export type Status = {
  server_up: boolean;
  count: number;
  max: number;
  tps: number;
  players: Player[];
  max_concurrent: number;
  updated_ts: number;
};

export type ChatMessage = {
  id: number;
  ts: number;
  source: "game" | "discord" | "web";
  user: string;
  uuid: string;
  text: string;
};

export class UnauthorizedError extends Error {}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(t: string) {
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch {
    /* 무시 */
  }
}
export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 무시 */
  }
}

async function authed(path: string, init?: RequestInit): Promise<Response> {
  const t = getToken();
  if (!t) throw new UnauthorizedError();
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${t}`,
    },
  });
  if (r.status === 401) {
    clearToken();
    throw new UnauthorizedError();
  }
  return r;
}

export async function login(code: string): Promise<void> {
  const r = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!r.ok) {
    if (r.status === 429) throw new Error("too_many");
    throw new Error("invalid");
  }
  const data = (await r.json()) as { token: string };
  setToken(data.token);
}

export async function logout(): Promise<void> {
  const t = getToken();
  clearToken();
  try {
    await fetch(`${BASE}/api/logout`, {
      method: "POST",
      headers: t ? { Authorization: `Bearer ${t}` } : undefined,
    });
  } catch {
    /* 무시 */
  }
}

// 세션 닉네임을 반환한다(아직 설정 안 됐으면 빈 문자열).
export async function getMe(): Promise<{ nickname: string }> {
  const r = await authed("/api/me");
  if (!r.ok) throw new Error("me_failed");
  return (await r.json()) as { nickname: string };
}

export async function setNickname(nickname: string): Promise<void> {
  const r = await authed("/api/nickname", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname }),
  });
  if (!r.ok) {
    if (r.status === 409) throw new Error("taken");
    throw new Error("invalid");
  }
}

export async function fetchStatus(): Promise<Status> {
  const r = await authed("/api/status");
  if (!r.ok) throw new Error("status_failed");
  return (await r.json()) as Status;
}

export async function fetchChat(
  since: number,
): Promise<{ messages: ChatMessage[]; last_id: number }> {
  const r = await authed(`/api/chat?since=${since}`);
  if (!r.ok) throw new Error("chat_failed");
  return (await r.json()) as { messages: ChatMessage[]; last_id: number };
}

// 전송 성공 시 서버가 부여한 id/ts를 돌려준다(웹 중심 저장 — 낙관적 전송 확정에 사용).
// 데모 모드 등 id가 없는 응답도 허용한다.
export async function sendChat(text: string): Promise<{ id?: number; ts?: number }> {
  const r = await authed("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!r.ok) {
    if (r.status === 429) throw new Error("slow_down");
    if (r.status === 409) throw new Error("no_nickname");
    throw new Error("send_failed");
  }
  try {
    return (await r.json()) as { id?: number; ts?: number };
  } catch {
    return {};
  }
}

// 과거 메시지 로딩(무한 스크롤) — before 미만 id의 최신 50개를 오름차순으로 받는다.
export async function fetchChatBefore(before: number): Promise<{ messages: ChatMessage[] }> {
  const r = await authed(`/api/chat?before=${before}`);
  if (!r.ok) throw new Error("chat_failed");
  return (await r.json()) as { messages: ChatMessage[] };
}

export type PerfDim = { name: string; chunks: number; entities: number };
export type PerfCurrent = {
  ts: number;
  count: number;
  tps: number;
  mspt: number;
  mspt_p95: number;
  mspt_p99: number;
  mspt_max: number;
  period_p95: number;
  period_max: number;
  spikes_50: number;
  spikes_100: number;
  players: Player[];
  dims: PerfDim[];
};
export type PerfHist = {
  ts: number;
  tps: number;
  mspt: number;
  p95: number;
  count: number;
  spikes: number;
};
export type Perf = {
  tracking: boolean;
  current: PerfCurrent | null;
  history: PerfHist[];
};

export async function fetchPerf(): Promise<Perf> {
  const r = await authed("/api/perf");
  if (!r.ok) throw new Error("perf_failed");
  return (await r.json()) as Perf;
}

// ── 웹 푸시 ──────────────────────────────────────────────────────────────────
export async function fetchPushKey(): Promise<string> {
  const r = await authed("/api/push/key");
  if (!r.ok) throw new Error("push_unavailable");
  return ((await r.json()) as { key: string }).key;
}

export async function subscribePush(sub: PushSubscriptionJSON): Promise<void> {
  const r = await authed("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub),
  });
  if (!r.ok) throw new Error("subscribe_failed");
}

export async function unsubscribePush(endpoint: string): Promise<void> {
  const r = await authed("/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
  if (!r.ok) throw new Error("unsubscribe_failed");
}

export type TimelineEvent = {
  id: number;
  ts: number; // epoch ms — for relative time / session duration only
  ts_kst: string; // "YYYY-MM-DD HH:MM:SS" — trust this for display (no tz conversion)
  uuid: string;
  name: string;
  event: "join" | "leave";
  is_first: boolean;
};
export type Timeline = { events: TimelineEvent[] };

export async function fetchTimeline(): Promise<Timeline> {
  const r = await authed("/api/timeline");
  if (!r.ok) throw new Error("timeline_failed");
  return (await r.json()) as Timeline;
}

export function avatarUrl(uuid: string, name: string): string {
  const key = uuid || name || "steve";
  return `https://mc-heads.net/avatar/${key}/64`;
}
