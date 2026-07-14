# 설계 기록 (Design Notes)

**한국어** | [English below](#english)

본 문서는 아키텍처의 주요 설계 결정과 그 배경을 기록한다. 현재 구조의 요약은
[README의 아키텍처 절](../README.md#아키텍처)을 참조.

## 1. 채팅 아키텍처 — 봇 중심에서 웹 중심으로

이전에는 디스코드 봇이 모든 채팅의 허브였고, 로그인 코드·세션 회수까지 봇 산출물이라 봇이 없으면 웹 패널이 사실상 동작하지 않았습니다. 이제 Go API가 허브입니다.

| | 이전 | 현재 |
| --- | --- | --- |
| 저장·조회 | 봇이 `chat.json` 기록 → API가 파일 읽기 | **API가 SQLite에 직접 저장·조회** |
| 웹 → 게임 | 웹 → `web_outbox/` → 봇 → 게임 | 웹 → **API 저장(피드 즉시 반영)** → 게임 인박스(`PANEL_GAME_INBOX`)+KubeJS 표시, `web_outbox/`는 디스코드 미러 전용 |
| 로그인 코드 | 봇이 생성·로테이션 | **API가 생성·로테이션** (`PANEL_CODE_ROTATE_SEC`, 기본 6시간) — 봇은 디스코드 표시만 |
| 세션 관리 | 봇이 `web_revoked.json` 기록 | **내부 API** (`/internal/sessions`·`/internal/revoke`, 루프백 전용) — 파일 방식은 구버전 호환용 유지 |
| 봇 없을 때 | 로그인·웹 메시지 전달 불가 | **로그인·웹 채팅 독립 동작** (게임·디스코드 전달만 대기) |

- 봇은 순수 브리지로 강등: 게임/디스코드 이벤트를 루프백 `POST /internal/ingest`로 API에 넘기고(실패 시 기존 파일 방식 폴백 → 임포터가 수습), 전달(웹훅·tellraw)과 표시만 담당합니다.
- id 권위는 DB 하나입니다 — 임포터는 파일 id를 커서로만 쓰고 DB id를 새로 부여합니다.
- 게임 방향 전달도 봇 없이 동작합니다: API가 큐 파일(`PANEL_GAME_INBOX`, 기본 `<mc>/web_to_game.json`)에 쓰고 서버 측 KubeJS 스크립트가 1초 폴링으로 tellraw 표시 — RCON 자격증명은 여전히 API에 없습니다. 봇의 outbox 소비는 디스코드 미러 전용으로 축소되었습니다.

## 2. 채팅 저장소 — JSON 파일에서 SQLite로

`chat.json`을 통째로 읽는 방식은 메시지가 쌓일수록 성능이 선형으로 나빠져 SQLite로 전환했습니다.

- 드라이버: `modernc.org/sqlite` — CGO가 필요 없는 순수 Go 의존성 1개 (빌드 환경은 그대로 단순)
- 커서는 `ts`가 아니라 **`id` 기준**입니다 — 같은 ms에 메시지가 몰리면 ts 커서는 메시지를 건너뛸 수 있고, id 커서는 기존 프런트(`since=last_id`)와 그대로 호환됩니다
- 타임라인(join/leave)도 같은 DB로 통합하고 보존 기간(`PANEL_TIMELINE_RETENTION_DAYS`, 기본 90일)으로 크기를 관리합니다
- 전환기에는 봇이 쓰는 `chat.json`/`timeline.json`을 임포터가 2초 주기로 DB에 반영합니다(첫 실행 시 전체 마이그레이션 겸용). 임포터는 레거시 파일 채널의 폴백으로 남아 있으며, 그 채널과 함께 제거됩니다(로드맵 참고)
- DB 경로: `PANEL_DB` (기본 `<bridge>/panel.db`), WAL 모드·단일 라이터

```sql
-- 적용된 스키마
CREATE TABLE messages (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ts      INTEGER NOT NULL,
    source  TEXT NOT NULL,  -- 'game' | 'discord' | 'web'
    uuid    TEXT NOT NULL DEFAULT '',
    user    TEXT NOT NULL,
    text    TEXT NOT NULL
);
CREATE INDEX idx_messages_ts ON messages(ts);
-- timeline(id, ts, ts_kst, uuid, name, event, is_first) + idx_timeline_ts
```

- `GET /api/chat?since=<id>` → `SELECT ... WHERE id > ? ORDER BY id` (전체 파일 파싱 불필요)

---

## English

This document records major architecture decisions and their rationale. For a
summary of the current structure, see the [Architecture section of the README](../README.en.md#architecture).

## 1. Chat architecture — from bot-centric to web-centric

Previously the Discord bot was the hub for all chat, and even login codes and session revocation were bot artifacts — without the bot the web panel was effectively dead. The Go API is now the hub.

| | Before | Now |
| --- | --- | --- |
| Storage/reads | Bot writes `chat.json` → API reads the file | **API stores and serves from SQLite directly** |
| Web → Game | Web → `web_outbox/` → Bot → Game | Web → **API store (feed updates instantly)** → game inbox (`PANEL_GAME_INBOX`) + KubeJS display; `web_outbox/` is Discord-mirror only |
| Login codes | Bot generates & rotates | **API generates & rotates** (`PANEL_CODE_ROTATE_SEC`, default 6h) — the bot only displays them on Discord |
| Session admin | Bot writes `web_revoked.json` | **Internal API** (`/internal/sessions` · `/internal/revoke`, loopback-only) — the file path remains for legacy compatibility |
| Without bot | No login, no web message delivery | **Login and web chat work standalone** (only game/Discord delivery waits) |

- The bot is demoted to a pure bridge: it forwards game/Discord events to the API via loopback `POST /internal/ingest` (falling back to the legacy files on failure — the importer picks those up) and handles delivery/display only.
- There is a single id authority — the DB. The importer uses file ids only as a progress cursor and assigns fresh DB ids.
- Web → game delivery now works without the bot too: the API writes a queue file (`PANEL_GAME_INBOX`, default `<mc>/web_to_game.json`) and a server-side KubeJS script polls it every second and tellraws — RCON credentials still never touch the API. The bot's outbox consumption is reduced to Discord mirroring only.

## 2. Chat storage — from JSON file to SQLite

Reading the entire `chat.json` on every request became linearly slower as messages accumulated, so storage moved to SQLite.

- Driver: `modernc.org/sqlite` — a single pure-Go, CGO-free dependency (build environment stays simple)
- The cursor is **`id`-based**, not `ts`-based — a ts cursor can skip messages that land in the same millisecond, while the id cursor stays compatible with the existing frontend (`since=last_id`)
- Timeline (join/leave) events share the same DB, with size managed by a retention window (`PANEL_TIMELINE_RETENTION_DAYS`, default 90 days)
- During the transition an importer ingests the bot-written `chat.json`/`timeline.json` into the DB every 2s (the first run doubles as the one-time migration). The importer remains as a fallback for the legacy file channel and is removed together with it (see the roadmap)
- DB path: `PANEL_DB` (default `<bridge>/panel.db`), WAL mode, single writer

```sql
-- Implemented schema
CREATE TABLE messages (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ts      INTEGER NOT NULL,
    source  TEXT NOT NULL,  -- 'game' | 'discord' | 'web'
    uuid    TEXT NOT NULL DEFAULT '',
    user    TEXT NOT NULL,
    text    TEXT NOT NULL
);
CREATE INDEX idx_messages_ts ON messages(ts);
-- timeline(id, ts, ts_kst, uuid, name, event, is_first) + idx_timeline_ts
```

- `GET /api/chat?since=<id>` → `SELECT ... WHERE id > ? ORDER BY id` (no full-file parse)

