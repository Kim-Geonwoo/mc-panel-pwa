package main

// SQLite 저장소: 채팅·타임라인을 JSON 파일 대신 DB로 관리합니다. (README '패치 예정' §2)
//
//   - modernc.org/sqlite — CGO 없는 순수 Go 드라이버라 빌드 환경이 단순하게 유지됩니다.
//   - 단일 프로세스·단일 라이터 전제. WAL 모드로 읽기와 쓰기가 서로를 막지 않습니다.
//   - id는 봇이 부여한 값을 그대로 보존합니다(INSERT 시 명시). 프런트의 since=last_id
//     커서와 봇 재시작 시 id 연속성(파일 max 스캔)이 모두 깨지지 않습니다.
//   - 커서는 ts가 아니라 id 기준입니다 — 같은 ms에 여러 메시지가 오면 ts 커서는
//     메시지를 건너뛸 수 있습니다.

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"strconv"

	_ "modernc.org/sqlite"
)

type store struct {
	db *sql.DB
}

func openStore(path string) (*store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	// 커넥션을 1개로 제한해 단일 라이터 전제를 풀 수준에서 강제합니다.
	// (요청량이 적은 패널 특성상 병목이 아니며, SQLITE_BUSY 충돌을 원천 차단)
	db.SetMaxOpenConns(1)
	for _, p := range []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA synchronous=NORMAL",
		"PRAGMA busy_timeout=5000",
	} {
		if _, err := db.Exec(p); err != nil {
			_ = db.Close()
			return nil, fmt.Errorf("pragma %q: %w", p, err)
		}
	}
	const schema = `
CREATE TABLE IF NOT EXISTS messages (
	id     INTEGER PRIMARY KEY AUTOINCREMENT,
	ts     INTEGER NOT NULL,
	source TEXT    NOT NULL,
	uuid   TEXT    NOT NULL DEFAULT '',
	user   TEXT    NOT NULL,
	text   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(ts);
CREATE TABLE IF NOT EXISTS timeline (
	id       INTEGER PRIMARY KEY AUTOINCREMENT,
	ts       INTEGER NOT NULL,
	ts_kst   TEXT    NOT NULL,
	uuid     TEXT    NOT NULL DEFAULT '',
	name     TEXT    NOT NULL,
	event    TEXT    NOT NULL,
	is_first INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_timeline_ts ON timeline(ts);
CREATE TABLE IF NOT EXISTS meta (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL
);`
	if _, err := db.Exec(schema); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("schema: %w", err)
	}
	// 채팅 내용이 담기므로 DB 파일을 0600으로 — 봇의 런타임 파일 정책과 동일.
	// (database/sql이 만드는 기본 권한은 0644라 다른 로컬 계정이 읽을 수 있음.
	// 스키마 실행 후에 조정해야 WAL 부속 파일까지 존재함)
	for _, suffix := range []string{"", "-wal", "-shm"} {
		if err := os.Chmod(path+suffix, 0o600); err != nil && !os.IsNotExist(err) {
			log.Printf("db chmod failed (%s%s): %v", path, suffix, err)
		}
	}
	return &store{db: db}, nil
}

func (st *store) close() error { return st.db.Close() }

// metaInt는 meta 테이블의 정수 값을 읽습니다. 없으면 0입니다.
func (st *store) metaInt(key string) int64 {
	var v string
	if err := st.db.QueryRow(`SELECT value FROM meta WHERE key = ?`, key).Scan(&v); err != nil {
		return 0
	}
	n, _ := strconv.ParseInt(v, 10, 64)
	return n
}

func (st *store) setMetaInt(key string, v int64) error {
	_, err := st.db.Exec(`INSERT INTO meta(key, value) VALUES(?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, strconv.FormatInt(v, 10))
	return err
}

// insertChat은 id를 지정해 메시지를 저장합니다. 같은 id는 무시합니다. (테스트·특수 상황용)
func (st *store) insertChat(m chatMsg) error {
	_, err := st.db.Exec(`INSERT OR IGNORE INTO messages(id, ts, source, uuid, user, text)
		VALUES(?, ?, ?, ?, ?, ?)`, m.ID, m.TS, m.Source, m.UUID, m.User, m.Text)
	return err
}

// insertChatAuto는 DB가 id를 부여해 메시지를 저장하고 새 id를 돌려줍니다.
// 웹 중심 전환 이후 id 권위는 DB 하나입니다 — 봇 파일 id와 API 직접 저장이
// 섞여도 충돌하지 않습니다.
func (st *store) insertChatAuto(ts int64, source, uuid, user, text string) (int64, error) {
	res, err := st.db.Exec(`INSERT INTO messages(ts, source, uuid, user, text)
		VALUES(?, ?, ?, ?, ?)`, ts, source, uuid, user, text)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// chatSince는 id > since인 메시지 중 최신 limit개를 오름차순으로 돌려줍니다.
// last_id는 조건에 맞는 메시지가 없으면 since 그대로입니다(기존 파일 기반 응답과 동일).
// limit로 창을 자르는 것은 기존 chat.json 롤링 버퍼(200개)와 같은 계약입니다 —
// 오래 자리를 비운 클라이언트는 전체 히스토리가 아니라 최근 분량만 받습니다.
func (st *store) chatSince(since int64, limit int) ([]chatMsg, int64, error) {
	rows, err := st.db.Query(`SELECT id, ts, source, uuid, user, text FROM messages
		WHERE id > ? ORDER BY id DESC LIMIT ?`, since, limit)
	if err != nil {
		return nil, since, err
	}
	defer rows.Close()
	var desc []chatMsg
	for rows.Next() {
		var m chatMsg
		if err := rows.Scan(&m.ID, &m.TS, &m.Source, &m.UUID, &m.User, &m.Text); err != nil {
			return nil, since, err
		}
		desc = append(desc, m)
	}
	if err := rows.Err(); err != nil {
		return nil, since, err
	}
	out := make([]chatMsg, len(desc))
	for i, m := range desc {
		out[len(desc)-1-i] = m
	}
	last := since
	if len(out) > 0 {
		last = out[len(out)-1].ID
	}
	return out, last, nil
}

// chatBefore는 id < before인 과거 메시지 중 최신 limit개를 오름차순으로 돌려줍니다.
// 무한 스크롤(과거 로딩)용 커서입니다.
func (st *store) chatBefore(before int64, limit int) ([]chatMsg, error) {
	rows, err := st.db.Query(`SELECT id, ts, source, uuid, user, text FROM messages
		WHERE id < ? ORDER BY id DESC LIMIT ?`, before, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var desc []chatMsg
	for rows.Next() {
		var m chatMsg
		if err := rows.Scan(&m.ID, &m.TS, &m.Source, &m.UUID, &m.User, &m.Text); err != nil {
			return nil, err
		}
		desc = append(desc, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]chatMsg, len(desc))
	for i, m := range desc {
		out[len(desc)-1-i] = m
	}
	return out, nil
}

// insertTimeline은 봇이 부여한 id를 보존한 채 접속 이벤트를 저장합니다.
func (st *store) insertTimeline(e timelineEntry) error {
	first := 0
	if e.IsFirst {
		first = 1
	}
	_, err := st.db.Exec(`INSERT OR IGNORE INTO timeline(id, ts, ts_kst, uuid, name, event, is_first)
		VALUES(?, ?, ?, ?, ?, ?, ?)`, e.ID, e.Ts, e.TsKst, e.UUID, e.Name, e.Event, first)
	return err
}

// insertTimelineAuto는 DB가 id를 부여해 접속 이벤트를 저장하고 새 id를 돌려줍니다.
func (st *store) insertTimelineAuto(ts int64, tsKst, uuid, name, event string, isFirst bool) (int64, error) {
	first := 0
	if isFirst {
		first = 1
	}
	res, err := st.db.Exec(`INSERT INTO timeline(ts, ts_kst, uuid, name, event, is_first)
		VALUES(?, ?, ?, ?, ?, ?)`, ts, tsKst, uuid, name, event, first)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// timelineEvents는 전체 이벤트를 id 오름차순으로 돌려줍니다. 크기는 retention 정리가 관리합니다.
func (st *store) timelineEvents() ([]timelineEntry, error) {
	rows, err := st.db.Query(`SELECT id, ts, ts_kst, uuid, name, event, is_first FROM timeline ORDER BY id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []timelineEntry{}
	for rows.Next() {
		var e timelineEntry
		var first int
		if err := rows.Scan(&e.ID, &e.Ts, &e.TsKst, &e.UUID, &e.Name, &e.Event, &first); err != nil {
			return nil, err
		}
		e.IsFirst = first != 0
		out = append(out, e)
	}
	return out, rows.Err()
}

// pruneTimeline은 beforeTs(epoch ms)보다 오래된 접속 이벤트를 지웁니다.
// join/leave는 무한히 쌓이는 데이터라 보존 기간으로 크기를 관리합니다.
func (st *store) pruneTimeline(beforeTs int64) (int64, error) {
	res, err := st.db.Exec(`DELETE FROM timeline WHERE ts < ?`, beforeTs)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}
