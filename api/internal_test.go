package main

// 웹 중심 전환(M3) 테스트: 로그인 코드 발급, 내부 ingest/세션 API, 웹 채팅 직접 저장.

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestWriteLoginCode(t *testing.T) {
	s, _ := newTestServer(t)
	s.cfg.codeRotateSec = 21600
	if err := s.writeLoginCode(); err != nil {
		t.Fatal(err)
	}
	var af authCodeFile
	if err := readJSON(s.cfg.authJSON, &af); err != nil {
		t.Fatal(err)
	}
	if len(af.Code) != 6 || af.IssuedTs <= 0 {
		t.Fatalf("bad code file: %+v", af)
	}
	for _, c := range af.Code {
		if c < '0' || c > '9' {
			t.Fatalf("code not numeric: %q", af.Code)
		}
	}
	fi, err := os.Stat(s.cfg.authJSON)
	if err != nil || fi.Mode().Perm() != 0o600 {
		t.Fatalf("auth.json perm = %v, want 0600", fi.Mode().Perm())
	}
	// 발급된 코드로 실제 로그인 성공해야 함 (handleLogin과의 형식 호환)
	login := s.api("POST", s.handleLogin)
	r := httptest.NewRequest(http.MethodPost, "/api/login", strings.NewReader(`{"code":"`+af.Code+`"}`))
	r.RemoteAddr = "203.0.113.10:1"
	rec := httptest.NewRecorder()
	login(rec, r)
	if rec.Code != http.StatusOK {
		t.Fatalf("login with generated code: got %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
}

func TestInternalIngest(t *testing.T) {
	s, _ := newTestServer(t)
	post := func(body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "/internal/ingest", strings.NewReader(body))
		rec := httptest.NewRecorder()
		s.handleInternalIngest(rec, r)
		return rec
	}
	// 채팅: id가 부여되고 새니타이즈가 적용되어야 함
	rec := post(`{"kind":"chat","source":"game","user":"Steve","uuid":"u1","text":"색§4깔"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("chat ingest: %d %s", rec.Code, rec.Body.String())
	}
	out, last, _ := s.store.chatSince(0, 10)
	if len(out) != 1 || out[0].Text != "색4깔" || out[0].Source != "game" || last != out[0].ID {
		t.Fatalf("ingested chat wrong: %+v", out)
	}
	// 잘못된 kind/source/event는 400
	for _, bad := range []string{
		`{"kind":"nope"}`,
		`{"kind":"chat","source":"admin","user":"x","text":"y"}`,
		`{"kind":"chat","source":"game","user":"","text":"y"}`,
		`{"kind":"timeline","name":"x","event":"crash"}`,
	} {
		if rec := post(bad); rec.Code != http.StatusBadRequest {
			t.Fatalf("bad payload accepted (%d): %s", rec.Code, bad)
		}
	}
	// 타임라인: ts_kst를 서버가 채움
	rec = post(`{"kind":"timeline","uuid":"u1","name":"Steve","event":"join","is_first":true}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("timeline ingest: %d %s", rec.Code, rec.Body.String())
	}
	evs, _ := s.store.timelineEvents()
	if len(evs) != 1 || !evs[0].IsFirst || len(evs[0].TsKst) != 19 {
		t.Fatalf("ingested timeline wrong: %+v", evs)
	}
	// GET은 405
	r := httptest.NewRequest(http.MethodGet, "/internal/ingest", nil)
	rec2 := httptest.NewRecorder()
	s.handleInternalIngest(rec2, r)
	if rec2.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET ingest: %d", rec2.Code)
	}
}

func TestInternalSessionsAndRevoke(t *testing.T) {
	s, _ := newTestServer(t)
	sidA, _ := s.sessions.create()
	_ = s.sessions.setNickname(sidA, "철수")
	sidB, _ := s.sessions.create()
	_ = s.sessions.setNickname(sidB, "영희")

	r := httptest.NewRequest(http.MethodGet, "/internal/sessions", nil)
	rec := httptest.NewRecorder()
	s.handleInternalSessions(rec, r)
	body := rec.Body.String()
	if rec.Code != http.StatusOK || !strings.Contains(body, "철수") || !strings.Contains(body, "영희") {
		t.Fatalf("sessions list: %d %s", rec.Code, body)
	}
	// 전체 sid(64자)가 응답에 노출되면 안 됨 — 그 자체가 로그인 토큰
	if strings.Contains(body, sidA) || strings.Contains(body, sidB) {
		t.Fatal("full sid leaked in sessions list")
	}

	rr := httptest.NewRequest(http.MethodPost, "/internal/revoke", strings.NewReader(`{"nickname":"철수"}`))
	rec = httptest.NewRecorder()
	s.handleInternalRevoke(rec, rr)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"revoked":1`) {
		t.Fatalf("revoke: %d %s", rec.Code, rec.Body.String())
	}
	if _, ok := s.sessions.get(sidA); ok {
		t.Fatal("revoked session still valid")
	}
	if _, ok := s.sessions.get(sidB); !ok {
		t.Fatal("unrelated session removed")
	}
}

func TestWebChatDirectInsert(t *testing.T) {
	s, _ := newTestServer(t)
	sid, _ := s.sessions.create()
	_ = s.sessions.setNickname(sid, "웹유저")
	h := s.apiAuthed("GET,POST", s.handleChat)
	r := httptest.NewRequest(http.MethodPost, "/api/chat", strings.NewReader(`{"text":"안녕"}`))
	r.Header.Set("Authorization", "Bearer "+sid)
	rec := httptest.NewRecorder()
	h(rec, r)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"id"`) {
		t.Fatalf("web chat post: %d %s", rec.Code, rec.Body.String())
	}
	// 저장 즉시 피드에서 보여야 함 (봇 왕복 불필요)
	out, _, _ := s.store.chatSince(0, 10)
	if len(out) != 1 || out[0].Source != "web" || out[0].User != "웹유저" || out[0].Text != "안녕" {
		t.Fatalf("direct insert missing: %+v", out)
	}
	// outbox에도 게임·디스코드 전달용 파일이 남아야 함
	entries, err := os.ReadDir(s.cfg.outboxDir)
	if err != nil || len(entries) != 1 {
		t.Fatalf("outbox: %v len=%d", err, len(entries))
	}
	// 게임 인박스에도 기록되어야 함 (KubeJS 전달용, 봇 불필요)
	var inboxFile gameInboxFile
	if err := readJSON(s.cfg.gameInbox, &inboxFile); err != nil || len(inboxFile.Messages) != 1 {
		t.Fatalf("game inbox: %v len=%d", err, len(inboxFile.Messages))
	}
	inbox := inboxFile.Messages
	if inbox[0].User != "웹유저" || inbox[0].Text != "안녕" || inbox[0].ID != out[0].ID {
		t.Fatalf("game inbox entry: %+v", inbox[0])
	}
}
