package main

// 보안 불변식 테스트: 새니타이즈·상수시간 비교·레이트 리밋·클라이언트 IP 판별·
// 세션 취소·미들웨어 체인·로그인 흐름·경로 순회 차단이 회귀하지 않도록 고정합니다.

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newTestServer(t *testing.T) (*server, string) {
	t.Helper()
	dir := t.TempDir()
	cfg := config{
		statusJSON:   filepath.Join(dir, "status.json"),
		recordsJSON:  filepath.Join(dir, "records.json"),
		authJSON:     filepath.Join(dir, "auth.json"),
		sessionsJSON: filepath.Join(dir, "sessions.json"),
		chatJSON:     filepath.Join(dir, "chat.json"),
		timelineJSON: filepath.Join(dir, "timeline.json"),
		revokedJSON:  filepath.Join(dir, "web_revoked.json"),
		outboxDir:    filepath.Join(dir, "web_outbox"),
		perfJSON:     filepath.Join(dir, "perf.json"),
		perfHistJSON: filepath.Join(dir, "perf_history.json"),
		staticDir:    filepath.Join(dir, "static"),
		gameInbox:    filepath.Join(dir, "web_to_game.json"),
		maxPlayers:   20,
		freshSec:     21,
		sessionSec:   3600,
	}
	st, err := openStore(filepath.Join(dir, "panel.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.close() })
	s := &server{
		cfg:           cfg,
		sessions:      newSessionStore(cfg.sessionsJSON, cfg.revokedJSON, cfg.sessionSec),
		loginRL:       newRateLimiter(600, 10),
		loginGlobalRL: newRateLimiter(600, 120),
		chatRL:        newRateLimiter(5, 3),
		alert:         newAlerter(""),
		store:         st,
	}
	return s, dir
}

func TestSanitizeText(t *testing.T) {
	cases := []struct{ in, want string }{
		{"hello", "hello"},
		{"  안녕하세요  ", "안녕하세요"},
		{"a\nb\tc\rd", "a b c d"},
		{"색상§4주입", "색상4주입"},
		{"\x01\x02abc\x7f", "abc"},
		{"x", "x"},
	}
	for _, c := range cases {
		if got := sanitizeText(c.in); got != c.want {
			t.Errorf("sanitizeText(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestSubtleNE(t *testing.T) {
	if subtleNE("123456", "123456") {
		t.Error("same strings reported different")
	}
	if !subtleNE("123456", "123457") {
		t.Error("different strings reported same")
	}
	if !subtleNE("12345", "123456") {
		t.Error("length mismatch reported same")
	}
}

func TestRateLimiter(t *testing.T) {
	rl := newRateLimiter(600, 3)
	for i := 0; i < 3; i++ {
		if !rl.allow("k") {
			t.Fatalf("attempt %d should be allowed", i+1)
		}
	}
	if rl.allow("k") {
		t.Fatal("attempt over max should be denied")
	}
	if !rl.allow("other") {
		t.Fatal("keys must be independent")
	}
	// sweep은 윈도우가 지나 비어 버린 키를 지워야 합니다
	rl.hits["stale"] = []int64{time.Now().Unix() - 10000}
	rl.sweep()
	if _, ok := rl.hits["stale"]; ok {
		t.Fatal("sweep kept an expired key")
	}
}

func TestClientIP(t *testing.T) {
	// 외부에서 직접 들어온 요청은 포워딩 헤더를 신뢰하지 않아야 합니다
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "203.0.113.5:1234"
	r.Header.Set("CF-Connecting-IP", "8.8.8.8")
	r.Header.Set("X-Forwarded-For", "9.9.9.9")
	if got := clientIP(r); got != "203.0.113.5" {
		t.Errorf("external request trusted forwarded header: %q", got)
	}
	// 루프백(cloudflared 경유)에서는 CF-Connecting-IP를 신뢰합니다
	r.RemoteAddr = "127.0.0.1:9999"
	if got := clientIP(r); got != "8.8.8.8" {
		t.Errorf("loopback should trust CF-Connecting-IP: %q", got)
	}
	// CF 헤더가 없으면 X-Forwarded-For의 첫 값
	r.Header.Del("CF-Connecting-IP")
	r.Header.Set("X-Forwarded-For", "1.2.3.4, 5.6.7.8")
	if got := clientIP(r); got != "1.2.3.4" {
		t.Errorf("XFF first value expected: %q", got)
	}
	// IPv6 괄호 제거
	r2 := httptest.NewRequest(http.MethodGet, "/", nil)
	r2.RemoteAddr = "[2001:db8::1]:443"
	if got := clientIP(r2); got != "2001:db8::1" {
		t.Errorf("ipv6 host expected: %q", got)
	}
}

func TestSessionRevocation(t *testing.T) {
	s, dir := newTestServer(t)
	sidA, err := s.sessions.create()
	if err != nil {
		t.Fatal(err)
	}
	sidB, _ := s.sessions.create()
	if _, ok := s.sessions.get(sidA); !ok {
		t.Fatal("fresh session should be valid")
	}
	// 취소 목록에 sidA를 올리면 즉시 거부되어야 합니다
	revoked := filepath.Join(dir, "web_revoked.json")
	if err := os.WriteFile(revoked, []byte(`["`+sidA+`"]`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, ok := s.sessions.get(sidA); ok {
		t.Fatal("revoked session accepted")
	}
	// 파일이 손상되어도 기존 취소 목록은 유지되어야 합니다 (전체 무효화 금지)
	if err := os.WriteFile(revoked, []byte("{broken"), 0o600); err != nil {
		t.Fatal(err)
	}
	later := time.Now().Add(2 * time.Second)
	_ = os.Chtimes(revoked, later, later) // mtime을 강제로 바꿔 다시 읽게 합니다
	if _, ok := s.sessions.get(sidB); !ok {
		t.Fatal("valid session rejected after parse failure")
	}
	s.sessions.mu.Lock()
	stillRevoked := s.sessions.revoked[sidA]
	s.sessions.mu.Unlock()
	if !stillRevoked {
		t.Fatal("parse failure cleared the revocation list")
	}
}

func TestAPIChainMethodAndAuth(t *testing.T) {
	s, _ := newTestServer(t)
	h := s.api("POST", func(w http.ResponseWriter, r *http.Request) {
		s.writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodGet, "/api/x", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("wrong method: got %d, want 405", rec.Code)
	}
	if allow := rec.Header().Get("Allow"); allow != "POST" {
		t.Fatalf("Allow header = %q", allow)
	}

	authed := s.apiAuthed("GET", func(w http.ResponseWriter, r *http.Request, sid string, sess session) {
		s.writeJSON(w, http.StatusOK, map[string]string{"nick": sess.Nickname})
	})
	rec = httptest.NewRecorder()
	authed(rec, httptest.NewRequest(http.MethodGet, "/api/x", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("no token: got %d, want 401", rec.Code)
	}
	sid, _ := s.sessions.create()
	r := httptest.NewRequest(http.MethodGet, "/api/x", nil)
	r.Header.Set("Authorization", "Bearer "+sid)
	rec = httptest.NewRecorder()
	authed(rec, r)
	if rec.Code != http.StatusOK {
		t.Fatalf("valid token: got %d, want 200", rec.Code)
	}
}

func TestLoginFlow(t *testing.T) {
	s, dir := newTestServer(t)
	if err := os.WriteFile(filepath.Join(dir, "auth.json"), []byte(`{"code":"123456"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	login := s.api("POST", s.handleLogin)
	do := func(code string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "/api/login", strings.NewReader(`{"code":"`+code+`"}`))
		r.RemoteAddr = "203.0.113.9:1"
		rec := httptest.NewRecorder()
		login(rec, r)
		return rec
	}
	if rec := do("000000"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("wrong code: got %d, want 401", rec.Code)
	}
	rec := do("123456")
	if rec.Code != http.StatusOK {
		t.Fatalf("valid code: got %d, want 200", rec.Code)
	}
	var resp struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil || len(resp.Token) != 64 {
		t.Fatalf("token missing or wrong length: %q", resp.Token)
	}
	// IP 리미터(10회/10분)를 소진하면 코드가 맞아도 429
	for i := 0; i < 10; i++ {
		do("000000")
	}
	if rec := do("123456"); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("rate limit: got %d, want 429", rec.Code)
	}
}

func TestStaticTraversalBlocked(t *testing.T) {
	s, dir := newTestServer(t)
	if err := os.MkdirAll(s.cfg.staticDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s.cfg.staticDir, "index.html"), []byte("INDEX"), 0o600); err != nil {
		t.Fatal(err)
	}
	secret := filepath.Join(dir, "secret.txt")
	if err := os.WriteFile(secret, []byte("SECRET"), 0o600); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodGet, "/x", nil)
	r.URL.Path = "/../secret.txt" // 정적 루트 밖으로 나가려는 시도
	rec := httptest.NewRecorder()
	s.static(rec, r)
	if strings.Contains(rec.Body.String(), "SECRET") {
		t.Fatal("path traversal escaped the static root")
	}
}

func TestSecurityHeaders(t *testing.T) {
	h := securityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/chat", nil))
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Error("API response must be no-store")
	}
	for _, k := range []string{"X-Content-Type-Options", "Content-Security-Policy", "Permissions-Policy"} {
		if rec.Header().Get(k) == "" {
			t.Errorf("missing header %s", k)
		}
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Header().Get("Cache-Control") == "no-store" {
		t.Error("static response should not be forced no-store")
	}
}

func TestDemoChatStoreStable(t *testing.T) {
	a := demoChat()
	b := demoChat()
	if len(a) == 0 || len(b) != len(a) || a[0].ID != b[0].ID {
		t.Fatal("demo seed must be generated once and stay stable")
	}
	demoChatAppend("Tester", "hi")
	c := demoChat()
	if len(c) != len(a)+1 {
		t.Fatalf("append not visible: %d -> %d", len(a), len(c))
	}
	last := c[len(c)-1]
	if last.Source != "web" || last.User != "Tester" || last.ID <= c[len(c)-2].ID {
		t.Fatalf("appended message malformed: %+v", last)
	}
}

func TestAlerterWebhook(t *testing.T) {
	received := make(chan string, 1)
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		select {
		case received <- string(b):
		default:
		}
	}))
	defer ts.Close()
	a := newAlerter(ts.URL)
	a.threshold = 3
	a.cooldown = 0
	for i := 0; i < 3; i++ {
		a.loginFail("203.0.113.1")
	}
	select {
	case msg := <-received:
		if !strings.Contains(msg, "로그인 실패") {
			t.Fatalf("unexpected alert payload: %s", msg)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("webhook alert not delivered")
	}
}

func TestRunHealthcheck(t *testing.T) {
	// 헬스 리스너가 없는 포트 → 실패(1)
	t.Setenv("PANEL_HEALTH_LISTEN", "127.0.0.1:1") // 예약 포트 — 리스너 없음
	if got := runHealthcheck(); got != 1 {
		t.Fatalf("down: got %d, want 1", got)
	}
	// 가짜 healthz 서버 → 성공(0)
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer ts.Close()
	t.Setenv("PANEL_HEALTH_LISTEN", strings.TrimPrefix(ts.URL, "http://"))
	if got := runHealthcheck(); got != 0 {
		t.Fatalf("up: got %d, want 0", got)
	}
}
