package main

// 웹 중심 전환(M3) 테스트: 로그인 코드 발급, 내부 ingest/세션 API, 웹 채팅 직접 저장.

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
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

// ------------------------------------------------------------------ 내부 API 공유 비밀

// testInternalToken은 시험용 공유 비밀입니다. 엔트로피가 높은 리터럴은 gitleaks가 비밀로
// 오탐하므로 한 글자를 반복해 만듭니다(길이만 최소 길이를 넘기면 됩니다).
var testInternalToken = strings.Repeat("t", 64)

// TestLoadInternalToken은 공유 비밀을 환경변수나 0600 파일에서 읽고, 잘못된 설정은
// 거부하는지 확인합니다. 거부되면 내부 API가 닫힙니다(실패 쪽으로 닫힘).
func TestLoadInternalToken(t *testing.T) {
	t.Setenv("PANEL_INTERNAL_TOKEN", "")
	t.Setenv("PANEL_INTERNAL_TOKEN_FILE", "")
	if tok, err := loadInternalToken(); tok != "" || err != nil {
		t.Fatalf("미설정: tok=%q err=%v, want 빈값·nil", tok, err)
	}

	t.Setenv("PANEL_INTERNAL_TOKEN", testInternalToken)
	if tok, err := loadInternalToken(); tok != testInternalToken || err != nil {
		t.Fatalf("환경변수: tok=%q err=%v", tok, err)
	}
	t.Setenv("PANEL_INTERNAL_TOKEN", "short")
	if tok, err := loadInternalToken(); tok != "" || err == nil {
		t.Fatalf("짧은 비밀은 거부해야 함: tok=%q err=%v", tok, err)
	}

	dir := t.TempDir()
	p := filepath.Join(dir, "internal_token")
	if err := os.WriteFile(p, []byte(testInternalToken+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PANEL_INTERNAL_TOKEN", "")
	t.Setenv("PANEL_INTERNAL_TOKEN_FILE", p)
	if tok, err := loadInternalToken(); tok != testInternalToken || err != nil {
		t.Fatalf("파일(끝 줄바꿈 제거): tok=%q err=%v", tok, err)
	}

	// 둘 다 설정하면 어느 쪽이 쓰이는지 모호하므로 거부합니다.
	t.Setenv("PANEL_INTERNAL_TOKEN", testInternalToken)
	if tok, err := loadInternalToken(); tok != "" || err == nil {
		t.Fatalf("둘 다 설정은 거부해야 함: tok=%q err=%v", tok, err)
	}
	t.Setenv("PANEL_INTERNAL_TOKEN", "")

	t.Setenv("PANEL_INTERNAL_TOKEN_FILE", filepath.Join(dir, "missing"))
	if tok, err := loadInternalToken(); tok != "" || err == nil {
		t.Fatalf("없는 파일은 거부해야 함: tok=%q err=%v", tok, err)
	}

	if runtime.GOOS != "windows" { // 윈도우는 유닉스 권한 비트를 쓰지 않습니다
		loose := filepath.Join(dir, "loose_token")
		if err := os.WriteFile(loose, []byte(testInternalToken), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(loose, 0o644); err != nil {
			t.Fatal(err)
		}
		t.Setenv("PANEL_INTERNAL_TOKEN_FILE", loose)
		if tok, err := loadInternalToken(); tok != "" || err == nil {
			t.Fatalf("다른 사용자가 읽을 수 있는 파일은 거부해야 함: tok=%q err=%v", tok, err)
		}
	}
}

// internalReq는 헬스 리스너 mux에 요청 하나를 보내고 응답을 돌려줍니다.
func internalReq(h http.Handler, method, path, auth, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if auth != "" {
		r.Header.Set("Authorization", auth)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	return rec
}

// TestHealthMuxRequiresInternalToken은 헬스 리스너의 내부 경로가 공유 비밀 없이는
// 열리지 않는지 확인합니다. 같은 호스트의 다른 계정이나 루프백을 넘겨 주는 프로세스도
// 127.0.0.1에서 들어오므로, 루프백이라는 사실만으로는 믿지 않습니다.
func TestHealthMuxRequiresInternalToken(t *testing.T) {
	s, dir := newTestServer(t)
	s.layout = newFileLayoutStore(filepath.Join(dir, "layout.json"))
	s.cfg.internalToken = testInternalToken
	h := s.healthMux("127.0.0.1:8099")
	good := "Bearer " + testInternalToken

	// /healthz는 계속 무인증입니다(컨테이너 HEALTHCHECK·외부 감시용).
	if rec := internalReq(h, "GET", "/healthz", "", ""); rec.Code != http.StatusOK {
		t.Fatalf("/healthz: %d", rec.Code)
	}

	routes := []struct{ method, path, body string }{
		{"GET", "/internal/sessions", ""},
		{"POST", "/internal/revoke", `{"nickname":"철수"}`},
		{"POST", "/internal/ingest", `{"kind":"chat","source":"game","user":"Steve","text":"hi"}`},
		{"PUT", "/api/layout", `{"version":1,"meta":{"title":"z"}}`},
	}
	for _, rt := range routes {
		for _, auth := range []string{
			"",                                 // 헤더 없음
			"Bearer wrong",                     // 틀린 값
			"Bearer " + testInternalToken[:63], // 한 글자 모자람
			testInternalToken,                  // Bearer 접두어 없음
			"Basic " + testInternalToken,
		} {
			rec := internalReq(h, rt.method, rt.path, auth, rt.body)
			if rec.Code != http.StatusUnauthorized {
				t.Errorf("%s %s auth=%q: got %d, want 401", rt.method, rt.path, auth, rec.Code)
			}
			if !strings.HasPrefix(rec.Header().Get("WWW-Authenticate"), "Bearer") {
				t.Errorf("%s %s: WWW-Authenticate 없음", rt.method, rt.path)
			}
		}
		if rec := internalReq(h, rt.method, rt.path, good, rt.body); rec.Code != http.StatusOK {
			t.Errorf("%s %s 올바른 토큰: got %d (%s)", rt.method, rt.path, rec.Code, rec.Body.String())
		}
	}
}

// TestHealthMuxInternalDisabledWithoutToken은 공유 비밀이 설정되지 않았을 때 내부 경로가
// 닫히는지(503) 확인합니다. 503이면 봇은 기존 파일 경로로 물러나 기록을 잃지 않습니다.
func TestHealthMuxInternalDisabledWithoutToken(t *testing.T) {
	s, dir := newTestServer(t)
	s.layout = newFileLayoutStore(filepath.Join(dir, "layout.json"))
	h := s.healthMux("127.0.0.1:8099")
	for _, auth := range []string{"", "Bearer ", "Bearer anything"} {
		rec := internalReq(h, "GET", "/internal/sessions", auth, "")
		if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "internal_disabled") {
			t.Fatalf("미설정 auth=%q: %d %s", auth, rec.Code, rec.Body.String())
		}
	}
	if rec := internalReq(h, "PUT", "/api/layout", "Bearer ", `{"version":1}`); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("미설정 PUT /api/layout: %d", rec.Code)
	}
	if _, err := os.Stat(filepath.Join(dir, "layout.json")); !os.IsNotExist(err) {
		t.Fatal("닫힌 상태에서 레이아웃이 저장됨")
	}
	if rec := internalReq(h, "GET", "/healthz", "", ""); rec.Code != http.StatusOK {
		t.Fatalf("/healthz: %d", rec.Code)
	}
}

// TestHealthMuxNonLoopbackOmitsInternal은 헬스 리스너가 루프백이 아니면 토큰이 있어도
// 내부 경로를 아예 등록하지 않는지(404) 확인합니다.
func TestHealthMuxNonLoopbackOmitsInternal(t *testing.T) {
	s, _ := newTestServer(t)
	s.cfg.internalToken = testInternalToken
	h := s.healthMux("0.0.0.0:8099")
	if rec := internalReq(h, "GET", "/internal/sessions", "Bearer "+testInternalToken, ""); rec.Code != http.StatusNotFound {
		t.Fatalf("루프백 아님: %d, want 404", rec.Code)
	}
	if rec := internalReq(h, "GET", "/healthz", "", ""); rec.Code != http.StatusOK {
		t.Fatalf("/healthz: %d", rec.Code)
	}
}
