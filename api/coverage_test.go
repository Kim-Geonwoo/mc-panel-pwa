package main

// M16: 커버리지 보강 테스트. 데모 모드 핸들러(status/perf/timeline/chat), 인증 핸들러
// (login/logout/me/nickname), 세션 스토어(purge/remove), CORS, 정적 파일 서빙, 환경변수
// 파서·loadConfig, 레이트 리밋 경보, 내부 API 메서드 검증, 푸시 구독 해지 오류 경로를
// 실제 동작(상태 코드·응답 본문·상태 변화) 기준으로 고정합니다.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// newDemoServer는 데모 모드(store 없음) 서버를 만듭니다. 브리지 파일 없이 샘플 데이터로
// 핸들러 경로를 검증하기 위한 것입니다.
func newDemoServer(t *testing.T) *server {
	t.Helper()
	dir := t.TempDir()
	cfg := config{
		sessionsJSON: filepath.Join(dir, "sessions.json"),
		revokedJSON:  filepath.Join(dir, "web_revoked.json"),
		outboxDir:    filepath.Join(dir, "web_outbox"),
		gameInbox:    filepath.Join(dir, "web_to_game.json"),
		staticDir:    filepath.Join(dir, "static"),
		maxPlayers:   20,
		freshSec:     21,
		sessionSec:   3600,
		demo:         true,
		pushEvents:   []string{"server", "join"},
	}
	return &server{
		cfg:           cfg,
		sessions:      newSessionStore(cfg.sessionsJSON, cfg.revokedJSON, cfg.sessionSec),
		loginRL:       newRateLimiter(600, 10),
		loginGlobalRL: newRateLimiter(600, 120),
		chatRL:        newRateLimiter(5, 3),
		alert:         newAlerter(""),
		// store는 nil (데모 모드)
	}
}

// ------------------------------------------------------------------ 환경변수 파서

func TestGetenvParsers(t *testing.T) {
	// 미설정 → 기본값
	if got := getenvInt("PANEL_TEST_INT_UNSET", 7); got != 7 {
		t.Fatalf("getenvInt unset: got %d, want 7", got)
	}
	if got := getenvFloat("PANEL_TEST_FLT_UNSET", 3.5); got != 3.5 {
		t.Fatalf("getenvFloat unset: got %v, want 3.5", got)
	}
	if got := getenvBool("PANEL_TEST_BOOL_UNSET", true); got != true {
		t.Fatalf("getenvBool unset: got %v, want true", got)
	}
	// 유효 값 파싱
	t.Setenv("PANEL_TEST_INT", "42")
	if got := getenvInt("PANEL_TEST_INT", 7); got != 42 {
		t.Fatalf("getenvInt: got %d, want 42", got)
	}
	// 무효 값 → 기본값
	t.Setenv("PANEL_TEST_INT_BAD", "notanumber")
	if got := getenvInt("PANEL_TEST_INT_BAD", 7); got != 7 {
		t.Fatalf("getenvInt bad: got %d, want 7 (default)", got)
	}
	t.Setenv("PANEL_TEST_FLT", "2.75")
	if got := getenvFloat("PANEL_TEST_FLT", 1.0); got != 2.75 {
		t.Fatalf("getenvFloat: got %v, want 2.75", got)
	}
	t.Setenv("PANEL_TEST_FLT_BAD", "x")
	if got := getenvFloat("PANEL_TEST_FLT_BAD", 1.0); got != 1.0 {
		t.Fatalf("getenvFloat bad: got %v, want 1.0", got)
	}
	for _, tc := range []struct {
		v    string
		want bool
	}{
		{"1", true}, {"true", true}, {"YES", true}, {"on", true},
		{"0", false}, {"false", false}, {"no", false}, {"OFF", false},
	} {
		t.Setenv("PANEL_TEST_BOOL", tc.v)
		if got := getenvBool("PANEL_TEST_BOOL", !tc.want); got != tc.want {
			t.Fatalf("getenvBool(%q): got %v, want %v", tc.v, got, tc.want)
		}
	}
	// 인식 불가한 불리언 값 → 기본값 유지
	t.Setenv("PANEL_TEST_BOOL2", "maybe")
	if got := getenvBool("PANEL_TEST_BOOL2", true); got != true {
		t.Fatalf("getenvBool unknown: got %v, want true (default)", got)
	}
}

func TestLoadConfigDefaultsAndOverride(t *testing.T) {
	// 기본값 확인 (관련 env 미설정 시)
	cfg := loadConfig()
	if cfg.listen != "127.0.0.1:8080" {
		t.Fatalf("default listen = %q", cfg.listen)
	}
	if cfg.maxPlayers != 20 {
		t.Fatalf("default maxPlayers = %d", cfg.maxPlayers)
	}
	if cfg.demo {
		t.Fatal("demo should default false")
	}
	if len(cfg.pushEvents) != 2 {
		t.Fatalf("default pushEvents = %v", cfg.pushEvents)
	}
	if cfg.sessionSec != int64(2*24*3600) {
		t.Fatalf("default sessionSec = %d", cfg.sessionSec)
	}
	// override
	t.Setenv("PANEL_LISTEN", "0.0.0.0:9000")
	t.Setenv("PANEL_MAX_PLAYERS", "99")
	t.Setenv("PANEL_DEMO", "true")
	t.Setenv("PANEL_ALLOW_ORIGIN", "https://panel.example")
	cfg = loadConfig()
	if cfg.listen != "0.0.0.0:9000" || cfg.maxPlayers != 99 || !cfg.demo || cfg.allowOrigin != "https://panel.example" {
		t.Fatalf("override failed: %+v", cfg)
	}
}

// ------------------------------------------------------------------ 세션 스토어

func TestSessionRemoveAndPurge(t *testing.T) {
	s, _ := newTestServer(t)
	// remove: 로그아웃 시 세션이 사라져야 함
	sid, _ := s.sessions.create()
	if _, ok := s.sessions.get(sid); !ok {
		t.Fatal("fresh session should exist")
	}
	s.sessions.remove(sid)
	if _, ok := s.sessions.get(sid); ok {
		t.Fatal("removed session still valid")
	}
	// 존재하지 않는 sid 제거는 무해해야 함 (no-op)
	s.sessions.remove("does-not-exist")

	// PurgeExpired: 만료된 세션만 정리
	live, _ := s.sessions.create()
	dead, _ := s.sessions.create()
	s.sessions.mu.Lock()
	s.sessions.data[dead].Exp = time.Now().Unix() - 1 // 강제 만료
	s.sessions.mu.Unlock()
	s.sessions.PurgeExpired()
	s.sessions.mu.Lock()
	_, deadExists := s.sessions.data[dead]
	_, liveExists := s.sessions.data[live]
	s.sessions.mu.Unlock()
	if deadExists {
		t.Fatal("expired session survived PurgeExpired")
	}
	if !liveExists {
		t.Fatal("PurgeExpired removed a live session")
	}
}

func TestSetNicknameNoSession(t *testing.T) {
	s, _ := newTestServer(t)
	if err := s.sessions.setNickname("unknown-sid", "nick"); err == nil || err.Error() != "no_session" {
		t.Fatalf("setNickname unknown sid: err=%v, want no_session", err)
	}
}

// ------------------------------------------------------------------ 데모 데이터

func TestDemoDataShape(t *testing.T) {
	st := demoStatus()
	if st.Count != 2 || st.TPS != 20 || len(st.Players) != 2 || st.TS <= 0 {
		t.Fatalf("demoStatus wrong: %+v", st)
	}
	if demoRecords().MaxConcurrent != 7 {
		t.Fatalf("demoRecords wrong: %+v", demoRecords())
	}
	perf := demoPerfCurrent()
	for _, k := range []string{"ts", "tps", "mspt", "mspt_p95", "count", "players", "dims"} {
		if _, ok := perf[k]; !ok {
			t.Fatalf("demoPerfCurrent missing key %q", k)
		}
	}
	if perf["tps"].(float64) != 20.0 {
		t.Fatalf("demoPerfCurrent tps = %v", perf["tps"])
	}
	tl := demoTimeline()
	if len(tl) != 10 {
		t.Fatalf("demoTimeline len = %d, want 10", len(tl))
	}
	var joins, leaves, firsts int
	for _, e := range tl {
		switch e.Event {
		case "join":
			joins++
		case "leave":
			leaves++
		default:
			t.Fatalf("unexpected event %q", e.Event)
		}
		if e.IsFirst {
			firsts++
		}
		if len(e.TsKst) != 19 {
			t.Fatalf("ts_kst format wrong: %q", e.TsKst)
		}
	}
	if joins == 0 || leaves == 0 || firsts == 0 {
		t.Fatalf("demoTimeline should contain joins/leaves/first visits: j=%d l=%d f=%d", joins, leaves, firsts)
	}
}

// ------------------------------------------------------------------ 데모 모드 핸들러

func TestDemoHandlers(t *testing.T) {
	s := newDemoServer(t)

	// status: 데모는 서버 온라인 + 플레이어 2명
	rec := httptest.NewRecorder()
	s.handleStatus(rec, httptest.NewRequest(http.MethodGet, "/api/status", nil), "", session{})
	if rec.Code != http.StatusOK {
		t.Fatalf("demo status: %d", rec.Code)
	}
	var status map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &status); err != nil {
		t.Fatal(err)
	}
	if status["server_up"] != true || status["count"].(float64) != 2 {
		t.Fatalf("demo status body: %v", status)
	}
	if status["max_concurrent"].(float64) != 7 {
		t.Fatalf("demo status max_concurrent: %v", status["max_concurrent"])
	}

	// perf: 데모는 tracking true + current 존재
	rec = httptest.NewRecorder()
	s.handlePerf(rec, httptest.NewRequest(http.MethodGet, "/api/perf", nil), "", session{})
	var perf map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &perf)
	if rec.Code != http.StatusOK || perf["tracking"] != true || perf["current"] == nil {
		t.Fatalf("demo perf: %d %v", rec.Code, perf)
	}

	// timeline: 데모 이벤트 10개
	rec = httptest.NewRecorder()
	s.handleTimeline(rec, httptest.NewRequest(http.MethodGet, "/api/timeline", nil), "", session{})
	var tl struct {
		Events []timelineEntry `json:"events"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &tl)
	if rec.Code != http.StatusOK || len(tl.Events) != 10 {
		t.Fatalf("demo timeline: %d len=%d", rec.Code, len(tl.Events))
	}
}

func TestDemoChatHandler(t *testing.T) {
	s := newDemoServer(t)

	// GET since=0 → 시드 메시지 전체
	rec := httptest.NewRecorder()
	s.handleChat(rec, httptest.NewRequest(http.MethodGet, "/api/chat?since=0", nil), "", session{})
	var got struct {
		Messages []chatMsg `json:"messages"`
		LastID   int64     `json:"last_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if rec.Code != http.StatusOK || len(got.Messages) == 0 || got.LastID <= 0 {
		t.Fatalf("demo chat since: %d len=%d last=%d", rec.Code, len(got.Messages), got.LastID)
	}

	// GET before → 과거 메시지 로딩
	future := time.Now().UnixMilli() + 1_000_000
	rec = httptest.NewRecorder()
	s.handleChat(rec, httptest.NewRequest(http.MethodGet, "/api/chat?before="+strconv.FormatInt(future, 10), nil), "", session{})
	var before struct {
		Messages []chatMsg `json:"messages"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &before)
	if rec.Code != http.StatusOK || len(before.Messages) == 0 {
		t.Fatalf("demo chat before: %d len=%d", rec.Code, len(before.Messages))
	}

	// POST 데모 → in-memory 스토어에 추가, 200
	rec = httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/chat", strings.NewReader(`{"text":"데모전송_유니크"}`))
	s.handleChat(rec, r, "sid-demo", session{Nickname: "데모유저"})
	if rec.Code != http.StatusOK {
		t.Fatalf("demo chat post: %d %s", rec.Code, rec.Body.String())
	}
	// 방금 보낸 메시지가 피드에 보여야 함
	found := false
	for _, m := range demoChat() {
		if m.Text == "데모전송_유니크" && m.User == "데모유저" {
			found = true
		}
	}
	if !found {
		t.Fatal("demo posted message not visible in feed")
	}
}

// ------------------------------------------------------------------ 비데모 핸들러 상태 분기

func TestHandleStatusNonDemo(t *testing.T) {
	s, dir := newTestServer(t)
	// 서버 온라인: 신선한 status.json + records.json
	now := float64(time.Now().UnixMilli())
	writeFile(t, filepath.Join(dir, "status.json"),
		`{"ts":`+ftoa(now)+`,"count":3,"tps":19.5,"mspt":9.1,"players":[{"name":"Steve","uuid":"u1","ping":30}]}`)
	writeFile(t, filepath.Join(dir, "records.json"), `{"max_concurrent":12}`)
	rec := httptest.NewRecorder()
	s.handleStatus(rec, httptest.NewRequest(http.MethodGet, "/api/status", nil), "", session{})
	var up map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &up)
	if up["server_up"] != true || up["count"].(float64) != 3 || up["max_concurrent"].(float64) != 12 {
		t.Fatalf("status online: %v", up)
	}
	if players, ok := up["players"].([]any); !ok || len(players) != 1 {
		t.Fatalf("status players: %v", up["players"])
	}

	// 서버 오프라인: 오래된 ts → count 0, tps -1
	writeFile(t, filepath.Join(dir, "status.json"), `{"ts":1000,"count":5,"tps":20}`)
	rec = httptest.NewRecorder()
	s.handleStatus(rec, httptest.NewRequest(http.MethodGet, "/api/status", nil), "", session{})
	var down map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &down)
	if down["server_up"] != false || down["count"].(float64) != 0 || down["tps"].(float64) != -1 {
		t.Fatalf("status offline: %v", down)
	}
}

func TestHandlePerfNonDemo(t *testing.T) {
	s, dir := newTestServer(t)
	// perf.json 없음 → tracking false, current null
	rec := httptest.NewRecorder()
	s.handlePerf(rec, httptest.NewRequest(http.MethodGet, "/api/perf", nil), "", session{})
	var noperf map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &noperf)
	if noperf["tracking"] != false || noperf["current"] != nil {
		t.Fatalf("perf missing file: %v", noperf)
	}
	// 신선한 perf.json → tracking true, current 존재
	now := float64(time.Now().UnixMilli())
	writeFile(t, filepath.Join(dir, "perf.json"), `{"ts":`+ftoa(now)+`,"tps":20,"mspt":8.4,"count":2}`)
	rec = httptest.NewRecorder()
	s.handlePerf(rec, httptest.NewRequest(http.MethodGet, "/api/perf", nil), "", session{})
	var perf map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &perf)
	if perf["tracking"] != true || perf["current"] == nil {
		t.Fatalf("perf fresh: %v", perf)
	}
}

func TestHandleTimelineNonDemo(t *testing.T) {
	s, _ := newTestServer(t)
	// 이벤트 없음 → 빈 배열
	rec := httptest.NewRecorder()
	s.handleTimeline(rec, httptest.NewRequest(http.MethodGet, "/api/timeline", nil), "", session{})
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"events":[]`) {
		t.Fatalf("empty timeline: %d %s", rec.Code, rec.Body.String())
	}
	// 이벤트 삽입 후 반환 확인
	if _, err := s.store.insertTimelineAuto(time.Now().UnixMilli(), "2026-07-10 00:00:00", "u1", "Steve", "join", true); err != nil {
		t.Fatal(err)
	}
	rec = httptest.NewRecorder()
	s.handleTimeline(rec, httptest.NewRequest(http.MethodGet, "/api/timeline", nil), "", session{})
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "Steve") {
		t.Fatalf("timeline with event: %d %s", rec.Code, rec.Body.String())
	}
}

// TestHandlersStoreError는 DB가 닫힌 상태에서 조회 핸들러가 500을 돌려주는지 확인합니다.
func TestHandlersStoreError(t *testing.T) {
	s, _ := newTestServer(t)
	_ = s.store.close() // 강제로 DB 닫기 → 이후 쿼리는 오류

	for _, target := range []string{"/api/chat?since=0", "/api/chat?before=5", "/api/timeline"} {
		rec := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodGet, target, nil)
		if strings.HasPrefix(target, "/api/timeline") {
			s.handleTimeline(rec, r, "", session{})
		} else {
			s.handleChat(rec, r, "", session{})
		}
		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("%s on closed store: got %d, want 500", target, rec.Code)
		}
	}
}

// ------------------------------------------------------------------ 채팅 POST 오류·경계

func TestHandleChatPostBranches(t *testing.T) {
	s, _ := newTestServer(t)
	call := func(sess session, body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodPost, "/api/chat", strings.NewReader(body))
		s.handleChat(rec, r, "sid-x", sess)
		return rec
	}
	// 닉네임 없음 → 409
	if rec := call(session{}, `{"text":"hi"}`); rec.Code != http.StatusConflict {
		t.Fatalf("no nickname: %d", rec.Code)
	}
	// 잘못된 JSON → 400
	if rec := call(session{Nickname: "N"}, `{bad`); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad json: %d", rec.Code)
	}
	// 빈 텍스트(공백만) → 400
	if rec := call(session{Nickname: "N"}, `{"text":"   "}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("empty text: %d", rec.Code)
	}
	// 256자 초과 텍스트는 잘려 저장 (200)
	long := strings.Repeat("가", 300)
	if rec := call(session{Nickname: "N"}, `{"text":"`+long+`"}`); rec.Code != http.StatusOK {
		t.Fatalf("long text: %d %s", rec.Code, rec.Body.String())
	}
	out, _, _ := s.store.chatSince(0, 10)
	if len(out) == 0 || len([]rune(out[len(out)-1].Text)) != 256 {
		t.Fatalf("long text not truncated to 256: %+v", out)
	}
}

func TestHandleChatRateLimited(t *testing.T) {
	s, _ := newTestServer(t)
	s.chatRL = newRateLimiter(5, 2) // 5초에 2개
	send := func() int {
		rec := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodPost, "/api/chat", strings.NewReader(`{"text":"hi"}`))
		s.handleChat(rec, r, "sid-rl", session{Nickname: "N"})
		return rec.Code
	}
	if send() != http.StatusOK || send() != http.StatusOK {
		t.Fatal("first two messages should pass")
	}
	if code := send(); code != http.StatusTooManyRequests {
		t.Fatalf("third message should be rate limited: %d", code)
	}
}

// ------------------------------------------------------------------ 인증 핸들러

func TestHandleLogoutMeNickname(t *testing.T) {
	s, _ := newTestServer(t)

	// logout: Bearer 토큰의 세션을 제거
	sid, _ := s.sessions.create()
	rec := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/logout", nil)
	r.Header.Set("Authorization", "Bearer "+sid)
	s.handleLogout(rec, r)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"ok":true`) {
		t.Fatalf("logout: %d %s", rec.Code, rec.Body.String())
	}
	if _, ok := s.sessions.get(sid); ok {
		t.Fatal("session survived logout")
	}
	// 토큰 없는 로그아웃도 200 (no-op)
	rec = httptest.NewRecorder()
	s.handleLogout(rec, httptest.NewRequest(http.MethodPost, "/api/logout", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("logout without token: %d", rec.Code)
	}

	// me: 세션 닉네임 반환
	sid2, _ := s.sessions.create()
	_ = s.sessions.setNickname(sid2, "홍길동")
	sess, _ := s.sessions.get(sid2)
	rec = httptest.NewRecorder()
	s.handleMe(rec, httptest.NewRequest(http.MethodGet, "/api/me", nil), sid2, sess)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "홍길동") {
		t.Fatalf("me: %d %s", rec.Code, rec.Body.String())
	}
}

func TestHandleNicknameBranches(t *testing.T) {
	s, _ := newTestServer(t)
	sid, _ := s.sessions.create()
	call := func(usedSid, body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodPost, "/api/nickname", strings.NewReader(body))
		s.handleNickname(rec, r, usedSid, session{})
		return rec
	}
	// 정상 설정 → 200
	if rec := call(sid, `{"nickname":"길동"}`); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "길동") {
		t.Fatalf("set nickname: %d %s", rec.Code, rec.Body.String())
	}
	// 잘못된 JSON → 400
	if rec := call(sid, `{bad`); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad json: %d", rec.Code)
	}
	// 너무 짧음(1자) → 400
	if rec := call(sid, `{"nickname":"x"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("too short: %d", rec.Code)
	}
	// 너무 김(17자) → 400
	if rec := call(sid, `{"nickname":"`+strings.Repeat("a", 17)+`"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("too long: %d", rec.Code)
	}
	// 중복 닉네임 → 409
	sid2, _ := s.sessions.create()
	if rec := call(sid2, `{"nickname":"길동"}`); rec.Code != http.StatusConflict {
		t.Fatalf("duplicate nickname: %d %s", rec.Code, rec.Body.String())
	}
	// 존재하지 않는 세션(setNickname no_session) → 401
	if rec := call("nonexistent-sid", `{"nickname":"새이름"}`); rec.Code != http.StatusUnauthorized {
		t.Fatalf("no session: %d %s", rec.Code, rec.Body.String())
	}
}

func TestHandleLoginDemoAndUnavailable(t *testing.T) {
	// 데모 모드: 데모 코드로 로그인
	s := newDemoServer(t)
	login := func(code, ip string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodPost, "/api/login", strings.NewReader(`{"code":"`+code+`"}`))
		r.RemoteAddr = ip + ":1"
		s.handleLogin(rec, r)
		return rec
	}
	if rec := login(demoLoginCode, "203.0.113.20"); rec.Code != http.StatusOK {
		t.Fatalf("demo login: %d %s", rec.Code, rec.Body.String())
	}
	if rec := login("999999", "203.0.113.21"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("demo wrong code: %d", rec.Code)
	}
	// 잘못된 JSON → 400
	rec := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/login", strings.NewReader(`{bad`))
	r.RemoteAddr = "203.0.113.22:1"
	s.handleLogin(rec, r)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("login bad json: %d", rec.Code)
	}

	// 비데모: auth.json 없음 → 503 (no_active_code)
	s2, _ := newTestServer(t)
	rec = httptest.NewRecorder()
	r = httptest.NewRequest(http.MethodPost, "/api/login", strings.NewReader(`{"code":"123456"}`))
	r.RemoteAddr = "203.0.113.23:1"
	s2.handleLogin(rec, r)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("no auth code: %d %s", rec.Code, rec.Body.String())
	}
}

func TestHandleLoginGlobalRateLimit(t *testing.T) {
	s, dir := newTestServer(t)
	writeFile(t, filepath.Join(dir, "auth.json"), `{"code":"123456"}`)
	s.loginGlobalRL = newRateLimiter(600, 1) // 전역 상한 1
	// 캡처용 웹훅
	received := make(chan string, 1)
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b := make([]byte, r.ContentLength)
		_, _ = r.Body.Read(b)
		select {
		case received <- string(b):
		default:
		}
	}))
	defer ts.Close()
	s.alert = newAlerter(ts.URL)
	s.alert.cooldown = 0

	login := func(ip string) int {
		rec := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodPost, "/api/login", strings.NewReader(`{"code":"000000"}`))
		r.RemoteAddr = ip + ":1"
		s.handleLogin(rec, r)
		return rec.Code
	}
	// 첫 시도는 전역 상한을 소진(코드 틀려 401)
	login("198.51.100.1")
	// IP를 바꾼 두 번째 시도는 전역 리미터에 걸려 429
	if code := login("198.51.100.2"); code != http.StatusTooManyRequests {
		t.Fatalf("global rate limit: got %d, want 429", code)
	}
	select {
	case msg := <-received:
		if !strings.Contains(msg, "전역") {
			t.Fatalf("global alert payload: %s", msg)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("global rate-limit alert not delivered")
	}
}

// ------------------------------------------------------------------ CORS

func TestCORS(t *testing.T) {
	s, _ := newTestServer(t)
	// allowOrigin 미설정 → false, 헤더 없음
	rec := httptest.NewRecorder()
	if s.cors(rec, httptest.NewRequest(http.MethodGet, "/api/x", nil)) {
		t.Fatal("cors should return false when allowOrigin unset")
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("no CORS header expected when disabled")
	}
	// allowOrigin 설정 + OPTIONS → true(프리플라이트 종료), 204
	s.cfg.allowOrigin = "https://panel.example"
	rec = httptest.NewRecorder()
	if !s.cors(rec, httptest.NewRequest(http.MethodOptions, "/api/x", nil)) {
		t.Fatal("OPTIONS preflight should short-circuit")
	}
	if rec.Code != http.StatusNoContent || rec.Header().Get("Access-Control-Allow-Origin") != "https://panel.example" {
		t.Fatalf("preflight: code=%d origin=%q", rec.Code, rec.Header().Get("Access-Control-Allow-Origin"))
	}
	// 일반 GET → false지만 헤더는 붙음
	rec = httptest.NewRecorder()
	if s.cors(rec, httptest.NewRequest(http.MethodGet, "/api/x", nil)) {
		t.Fatal("GET should not short-circuit")
	}
	if rec.Header().Get("Access-Control-Allow-Methods") == "" {
		t.Fatal("CORS methods header missing on GET")
	}
	// api 체인을 통한 OPTIONS 프리플라이트 → 204 (핸들러 미실행)
	called := false
	h := s.api("GET", func(w http.ResponseWriter, r *http.Request) { called = true })
	rec = httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodOptions, "/api/x", nil))
	if rec.Code != http.StatusNoContent || called {
		t.Fatalf("api chain preflight: code=%d called=%v", rec.Code, called)
	}
}

// ------------------------------------------------------------------ 정적 파일

func TestStaticServing(t *testing.T) {
	s, _ := newTestServer(t)
	root := s.cfg.staticDir
	if err := os.MkdirAll(root, 0o700); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(root, "index.html"), "INDEX")
	writeFile(t, filepath.Join(root, "app.js"), "console.log(1)")
	writeFile(t, filepath.Join(root, "about.html"), "ABOUT")
	writeFile(t, filepath.Join(root, "site.webmanifest"), `{"name":"x"}`)

	req := func(p string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.URL.Path = p
		s.static(rec, r)
		return rec
	}
	// 실제 파일 서빙
	if rec := req("/app.js"); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "console.log") {
		t.Fatalf("serve file: %d %s", rec.Code, rec.Body.String())
	}
	// .webmanifest content-type
	if rec := req("/site.webmanifest"); !strings.Contains(rec.Header().Get("Content-Type"), "manifest+json") {
		t.Fatalf("webmanifest content-type: %q", rec.Header().Get("Content-Type"))
	}
	// 확장자 없는 경로 → .html 폴백
	if rec := req("/about"); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "ABOUT") {
		t.Fatalf("html fallback: %d %s", rec.Code, rec.Body.String())
	}
	// 알 수 없는 경로 → SPA index.html 폴백
	if rec := req("/no/such/route"); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "INDEX") {
		t.Fatalf("spa fallback: %d %s", rec.Code, rec.Body.String())
	}
}

func TestStaticNoIndex(t *testing.T) {
	s, _ := newTestServer(t)
	// staticDir가 없거나 index.html이 없으면 503
	rec := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.URL.Path = "/"
	s.static(rec, r)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("missing index: got %d, want 503", rec.Code)
	}
}

// ------------------------------------------------------------------ 경보·내부 API·푸시

func TestRateLimitedIPScope(t *testing.T) {
	a := newAlerter("")
	a.cooldown = 0
	// scope "ip"는 로그만 남기고 lastSent를 건드리지 않아야 함
	a.rateLimited("ip", "203.0.113.30")
	a.mu.Lock()
	last := a.lastSent
	a.mu.Unlock()
	if last != 0 {
		t.Fatalf("ip-scope rateLimited mutated lastSent: %d", last)
	}
	// scope "global"은 lastSent를 갱신
	a.rateLimited("global", "203.0.113.31")
	a.mu.Lock()
	last = a.lastSent
	a.mu.Unlock()
	if last == 0 {
		t.Fatal("global-scope rateLimited did not update lastSent")
	}
}

func TestInternalMethodGuards(t *testing.T) {
	s, _ := newTestServer(t)
	// sessions는 GET만 → POST 405
	rec := httptest.NewRecorder()
	s.handleInternalSessions(rec, httptest.NewRequest(http.MethodPost, "/internal/sessions", nil))
	if rec.Code != http.StatusMethodNotAllowed || rec.Header().Get("Allow") != "GET" {
		t.Fatalf("sessions POST: %d allow=%q", rec.Code, rec.Header().Get("Allow"))
	}
	// revoke는 POST만 → GET 405
	rec = httptest.NewRecorder()
	s.handleInternalRevoke(rec, httptest.NewRequest(http.MethodGet, "/internal/revoke", nil))
	if rec.Code != http.StatusMethodNotAllowed || rec.Header().Get("Allow") != "POST" {
		t.Fatalf("revoke GET: %d allow=%q", rec.Code, rec.Header().Get("Allow"))
	}
	// revoke 빈 닉네임 → 400
	rec = httptest.NewRecorder()
	s.handleInternalRevoke(rec, httptest.NewRequest(http.MethodPost, "/internal/revoke", strings.NewReader(`{"nickname":""}`)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("revoke empty nickname: %d", rec.Code)
	}
	// revoke 매칭 없는 닉네임 → 200 revoked:0
	rec = httptest.NewRecorder()
	s.handleInternalRevoke(rec, httptest.NewRequest(http.MethodPost, "/internal/revoke", strings.NewReader(`{"nickname":"없는사람"}`)))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"revoked":0`) {
		t.Fatalf("revoke no-match: %d %s", rec.Code, rec.Body.String())
	}
}

func TestPushUnsubscribeErrors(t *testing.T) {
	// store 없음(데모) → 503
	demo := newDemoServer(t)
	rec := httptest.NewRecorder()
	demo.handlePushUnsubscribe(rec, httptest.NewRequest(http.MethodPost, "/api/push/unsubscribe", strings.NewReader(`{"endpoint":"https://x/e"}`)))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("unsubscribe no store: %d", rec.Code)
	}
	// 빈 endpoint → 400
	s, _ := newTestServer(t)
	rec = httptest.NewRecorder()
	s.handlePushUnsubscribe(rec, httptest.NewRequest(http.MethodPost, "/api/push/unsubscribe", strings.NewReader(`{"endpoint":""}`)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("unsubscribe empty endpoint: %d", rec.Code)
	}
	// 잘못된 JSON → 400
	rec = httptest.NewRecorder()
	s.handlePushUnsubscribe(rec, httptest.NewRequest(http.MethodPost, "/api/push/unsubscribe", strings.NewReader(`{bad`)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("unsubscribe bad json: %d", rec.Code)
	}
}

func TestPushSubscribeNoStore(t *testing.T) {
	demo := newDemoServer(t)
	rec := httptest.NewRecorder()
	body := `{"endpoint":"https://push.example/e","keys":{"p256dh":"pk","auth":"ak"}}`
	demo.handlePushSubscribe(rec, httptest.NewRequest(http.MethodPost, "/api/push/subscribe", strings.NewReader(body)))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("subscribe no store: %d", rec.Code)
	}
}

// ------------------------------------------------------------------ 스토어 오류 경로

func TestOpenStoreError(t *testing.T) {
	// 디렉토리를 DB 경로로 주면 sqlite가 열지 못해 오류여야 함
	dir := t.TempDir()
	if _, err := openStore(dir); err == nil {
		t.Fatal("openStore on a directory path should fail")
	}
}

// ------------------------------------------------------------------ 테스트 헬퍼

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func ftoa(f float64) string {
	return strconv.FormatFloat(f, 'f', -1, 64)
}
