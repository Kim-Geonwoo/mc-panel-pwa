package main

// 게임 인박스 큐: 웹 메시지를 KubeJS가 소비할 파일로 내보내는 라이터를 고정합니다.
// id는 DB 메시지 id를 그대로 사용(단조 증가) — KubeJS 커서가 이를 신뢰합니다.

import (
	"os"
	"path/filepath"
	"sort"
	"sync"
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
	var wrap gameInboxFile
	var got []gameInboxEntry
	if err := readJSON(s.cfg.gameInbox, &wrap); err != nil {
		t.Fatal(err)
	}
	got = wrap.Messages
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
	wrap = gameInboxFile{}
	_ = readJSON(s.cfg.gameInbox, &wrap)
	got = wrap.Messages
	if len(got) != 50 || got[0].ID != 110 || got[49].ID != 159 {
		t.Fatalf("rolling cap: len=%d first=%d last=%d", len(got), got[0].ID, got[len(got)-1].ID)
	}
	// 파일이 깨져 있어도 에러 없이 새로 시작 (게임 전달은 best-effort)
	_ = os.WriteFile(s.cfg.gameInbox, []byte("{broken"), 0o600)
	if err := s.appendGameInbox(200, "u", "m"); err != nil {
		t.Fatal(err)
	}
	wrap = gameInboxFile{}
	_ = readJSON(s.cfg.gameInbox, &wrap)
	got = wrap.Messages
	if len(got) != 1 || got[0].ID != 200 {
		t.Fatalf("recovery: %+v", got)
	}
}

// TestAppendGameInboxConcurrent은 동시 웹 포스트가 RMW 경쟁으로 엔트리를 잃지 않음을
// 고정합니다. 뮤텍스가 없으면 last-writer-wins로 일부 id가 유실됩니다.
func TestAppendGameInboxConcurrent(t *testing.T) {
	s, dir := newTestServer(t)
	s.cfg.gameInbox = filepath.Join(dir, "web_to_game.json")
	const n = 30 // < gameInboxCap(50)이므로 전부 살아남아야 함
	var wg sync.WaitGroup
	for i := int64(0); i < n; i++ {
		wg.Add(1)
		go func(id int64) {
			defer wg.Done()
			if err := s.appendGameInbox(id, "u", "m"); err != nil {
				t.Errorf("append %d: %v", id, err)
			}
		}(i)
	}
	wg.Wait()
	var wrap gameInboxFile
	if err := readJSON(s.cfg.gameInbox, &wrap); err != nil {
		t.Fatal(err)
	}
	got := wrap.Messages
	want := n
	if want > gameInboxCap {
		want = gameInboxCap
	}
	if len(got) != want {
		t.Fatalf("동시 append로 엔트리 유실: len=%d, want %d", len(got), want)
	}
	// 살아남은 id는 전부 [0,n) 범위 안이며 중복이 없어야 함(정렬 후 순증가로 검증).
	ids := make([]int64, len(got))
	for i, e := range got {
		ids[i] = e.ID
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	for i, id := range ids {
		if id < 0 || id >= n {
			t.Fatalf("id 범위 벗어남: %d", id)
		}
		if i > 0 && ids[i-1] >= id {
			t.Fatalf("중복/역순 id: %d 다음 %d", ids[i-1], id)
		}
	}
}
