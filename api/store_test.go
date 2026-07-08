package main

// SQLite 저장소·임포터 테스트: id 커서 시맨틱(since 필터·창 크기·last_id)과
// 파일 → DB 1회 마이그레이션·증분 임포트·중복 방지·retention 정리를 고정합니다.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func newTestStore(t *testing.T) *store {
	t.Helper()
	st, err := openStore(filepath.Join(t.TempDir(), "panel.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.close() })
	return st
}

func TestStoreChatCursor(t *testing.T) {
	st := newTestStore(t)
	for i := int64(1); i <= 10; i++ {
		if err := st.insertChat(chatMsg{ID: i, TS: 1000 + i, Source: "game", User: "u", Text: "m"}); err != nil {
			t.Fatal(err)
		}
	}
	// since=0 → 전체, 오름차순
	out, last, err := st.chatSince(0, 200)
	if err != nil || len(out) != 10 || last != 10 || out[0].ID != 1 {
		t.Fatalf("full read: len=%d last=%d err=%v", len(out), last, err)
	}
	// since=8 → id 9,10만
	out, last, _ = st.chatSince(8, 200)
	if len(out) != 2 || out[0].ID != 9 || last != 10 {
		t.Fatalf("since filter: %+v last=%d", out, last)
	}
	// 새 메시지가 없으면 last_id는 since 그대로 (커서 유지)
	out, last, _ = st.chatSince(10, 200)
	if len(out) != 0 || last != 10 {
		t.Fatalf("no-new: len=%d last=%d", len(out), last)
	}
	// 창 크기: 최근 limit개만, 그래도 오름차순
	out, last, _ = st.chatSince(0, 5)
	if len(out) != 5 || out[0].ID != 6 || out[4].ID != 10 || last != 10 {
		t.Fatalf("window: %+v last=%d", out, last)
	}
	// 같은 id 재삽입은 무시 (봇 파일 재읽기 중복 방지)
	if err := st.insertChat(chatMsg{ID: 5, TS: 9999, Source: "web", User: "dup", Text: "dup"}); err != nil {
		t.Fatal(err)
	}
	out, _, _ = st.chatSince(4, 1)
	_ = out
	var cnt int
	if err := st.db.QueryRow(`SELECT COUNT(*) FROM messages`).Scan(&cnt); err != nil || cnt != 10 {
		t.Fatalf("duplicate id not ignored: count=%d err=%v", cnt, err)
	}
}

func TestStoreTimelinePrune(t *testing.T) {
	st := newTestStore(t)
	now := time.Now().UnixMilli()
	old := now - 100*24*3600*1000 // 100일 전
	events := []timelineEntry{
		{ID: 1, Ts: old, TsKst: "2026-01-01 00:00:00", UUID: "u1", Name: "Old", Event: "join", IsFirst: true},
		{ID: 2, Ts: now, TsKst: "2026-07-08 12:00:00", UUID: "u2", Name: "New", Event: "join", IsFirst: false},
	}
	for _, e := range events {
		if err := st.insertTimeline(e); err != nil {
			t.Fatal(err)
		}
	}
	n, err := st.pruneTimeline(now - 90*24*3600*1000)
	if err != nil || n != 1 {
		t.Fatalf("prune: n=%d err=%v", n, err)
	}
	got, err := st.timelineEvents()
	if err != nil || len(got) != 1 || got[0].Name != "New" || got[0].IsFirst {
		t.Fatalf("after prune: %+v err=%v", got, err)
	}
}

func writeJSONFile(t *testing.T, path string, v any, mtime time.Time) {
	t.Helper()
	b, _ := json.Marshal(v)
	if err := os.WriteFile(path, b, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, mtime, mtime); err != nil {
		t.Fatal(err)
	}
}

func TestImporterChatMigrationAndIncrement(t *testing.T) {
	s, _ := newTestServer(t)
	base := time.Now()
	msgs := []chatMsg{
		{ID: 143, TS: 1, Source: "discord", User: "a", Text: "one"},
		{ID: 144, TS: 2, Source: "game", User: "b", UUID: "x", Text: "two"},
	}
	writeJSONFile(t, s.cfg.chatJSON, msgs, base)

	// 1회차: 파일 전체가 들어와야 함 (마이그레이션 겸용)
	mt := s.importChat(0)
	if mt == 0 {
		t.Fatal("importChat did not advance mtime")
	}
	out, last, _ := s.store.chatSince(0, 200)
	if len(out) != 2 || last != 144 || s.store.metaInt(metaChatImportID) != 144 {
		t.Fatalf("initial import: len=%d last=%d cursor=%d", len(out), last, s.store.metaInt(metaChatImportID))
	}
	// 같은 mtime이면 재처리하지 않음
	if got := s.importChat(mt); got != mt {
		t.Fatal("unchanged file re-imported")
	}
	// 2회차: 새 메시지 1건 추가 (봇 롤링 버퍼처럼 기존 것 포함 전체 재기록)
	msgs = append(msgs, chatMsg{ID: 145, TS: 3, Source: "web", User: "c", Text: "three"})
	writeJSONFile(t, s.cfg.chatJSON, msgs, base.Add(2*time.Second))
	s.importChat(mt)
	out, last, _ = s.store.chatSince(0, 200)
	if len(out) != 3 || last != 145 {
		t.Fatalf("incremental import: len=%d last=%d", len(out), last)
	}
	// 커서 리셋 감지: 파일 max(1) < 커서(145) → 되감고 계속 (기존 행 유지)
	writeJSONFile(t, s.cfg.chatJSON, []chatMsg{{ID: 1, TS: 9, Source: "game", User: "r", Text: "reset"}}, base.Add(4*time.Second))
	s.importChat(mt)
	var cnt int
	_ = s.store.db.QueryRow(`SELECT COUNT(*) FROM messages`).Scan(&cnt)
	if cnt != 4 {
		t.Fatalf("reset resync: count=%d, want 4", cnt)
	}
}

func TestImporterTimeline(t *testing.T) {
	s, _ := newTestServer(t)
	events := []timelineEntry{
		{ID: 1, Ts: 10, TsKst: "2026-07-08 10:00:00", UUID: "u", Name: "A", Event: "join", IsFirst: true},
		{ID: 2, Ts: 20, TsKst: "2026-07-08 11:00:00", UUID: "u", Name: "A", Event: "leave"},
	}
	writeJSONFile(t, s.cfg.timelineJSON, events, time.Now())
	s.importTimeline(0)
	got, err := s.store.timelineEvents()
	if err != nil || len(got) != 2 || !got[0].IsFirst || got[1].Event != "leave" {
		t.Fatalf("timeline import: %+v err=%v", got, err)
	}
	if s.store.metaInt(metaTimelineImportID) != 2 {
		t.Fatalf("cursor=%d", s.store.metaInt(metaTimelineImportID))
	}
}
