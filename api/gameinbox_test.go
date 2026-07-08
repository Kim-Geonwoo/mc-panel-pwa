package main

// 게임 인박스 큐: 웹 메시지를 KubeJS가 소비할 파일로 내보내는 라이터를 고정합니다.
// id는 DB 메시지 id를 그대로 사용(단조 증가) — KubeJS 커서가 이를 신뢰합니다.

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAppendGameInbox(t *testing.T) {
	s, dir := newTestServer(t)
	s.cfg.gameInbox = filepath.Join(dir, "web_to_game.json")
	if err := s.appendGameInbox(10, "철수", "안녕"); err != nil {
		t.Fatal(err)
	}
	if err := s.appendGameInbox(11, "영희", "반가워"); err != nil {
		t.Fatal(err)
	}
	var got []gameInboxEntry
	if err := readJSON(s.cfg.gameInbox, &got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].ID != 10 || got[1].User != "영희" || got[1].Text != "반가워" {
		t.Fatalf("inbox contents: %+v", got)
	}
	if got[0].Ts <= 0 {
		t.Fatalf("ts missing: %+v", got[0])
	}
	// 권한 0600 (채팅 내용 — 봇 런타임 파일 정책과 동일)
	if fi, err := os.Stat(s.cfg.gameInbox); err != nil || fi.Mode().Perm() != 0o600 {
		t.Fatalf("perm = %v, want 0600", fi.Mode().Perm())
	}
	// 롤링 캡 50: 60개 넣으면 최신 50개만, id 오름차순 유지
	for i := int64(100); i < 160; i++ {
		if err := s.appendGameInbox(i, "u", "m"); err != nil {
			t.Fatal(err)
		}
	}
	_ = readJSON(s.cfg.gameInbox, &got)
	if len(got) != 50 || got[0].ID != 110 || got[49].ID != 159 {
		t.Fatalf("rolling cap: len=%d first=%d last=%d", len(got), got[0].ID, got[len(got)-1].ID)
	}
	// 파일이 깨져 있어도 에러 없이 새로 시작 (게임 전달은 best-effort)
	_ = os.WriteFile(s.cfg.gameInbox, []byte("{broken"), 0o600)
	if err := s.appendGameInbox(200, "u", "m"); err != nil {
		t.Fatal(err)
	}
	_ = readJSON(s.cfg.gameInbox, &got)
	if len(got) != 1 || got[0].ID != 200 {
		t.Fatalf("recovery: %+v", got)
	}
}
