package main

// 보안 불변식 테스트: 새니타이즈·상수시간 비교·레이트 리밋·클라이언트 IP 판별·
// 세션 취소·미들웨어 체인·로그인 흐름·경로 순회 차단이 회귀하지 않도록 고정합니다.

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
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

// viaUnixSocket은 요청이 unix 소켓 리스너로 들어온 것처럼 표시합니다(proxyConnContext와 같은 효과).
func viaUnixSocket(r *http.Request) *http.Request {
	return r.WithContext(proxyConnContext(r.Context(), &net.UnixConn{}))
}

func TestClientIP(t *testing.T) {
	s := &server{}
	// 외부에서 직접 들어온 요청은 포워딩 헤더를 신뢰하지 않아야 합니다
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "203.0.113.5:1234"
	r.Header.Set("CF-Connecting-IP", "8.8.8.8")
	r.Header.Set("X-Forwarded-For", "9.9.9.9")
	if got := s.clientIP(r); got != "203.0.113.5" {
		t.Errorf("external request trusted forwarded header: %q", got)
	}
	// 루프백 TCP라는 사실만으로는 믿지 않습니다. 같은 호스트의 다른 계정이나 루프백으로
	// 연결을 넘겨 주는 프로세스(userspace tailscaled 등)도 127.0.0.1에서 들어옵니다.
	r.RemoteAddr = "127.0.0.1:9999"
	if got := s.clientIP(r); got != "127.0.0.1" {
		t.Errorf("loopback TCP must not trust forwarded headers: %q", got)
	}
	// unix 소켓 리스너(cloudflared 전용)로 들어온 요청은 CF-Connecting-IP를 신뢰합니다
	u := viaUnixSocket(r)
	u.RemoteAddr = "@"
	if got := s.clientIP(u); got != "8.8.8.8" {
		t.Errorf("unix socket should trust CF-Connecting-IP: %q", got)
	}
	// CF 헤더가 없으면 X-Forwarded-For의 마지막 값(바로 앞 프록시가 붙인 값). 앞쪽 값은
	// 클라이언트가 보낸 그대로 남으므로 믿지 않습니다.
	u.Header.Del("CF-Connecting-IP")
	u.Header.Set("X-Forwarded-For", "1.2.3.4, 9.9.9.9, 5.6.7.8")
	if got := s.clientIP(u); got != "5.6.7.8" {
		t.Errorf("XFF last value expected: %q", got)
	}
	// 헤더가 없으면 unix 소켓 요청은 고정 키로 묶입니다
	u.Header.Del("X-Forwarded-For")
	if got := s.clientIP(u); got != "unix" {
		t.Errorf("unix socket without headers: %q", got)
	}
	// IPv6 괄호 제거
	r2 := httptest.NewRequest(http.MethodGet, "/", nil)
	r2.RemoteAddr = "[2001:db8::1]:443"
	if got := s.clientIP(r2); got != "2001:db8::1" {
		t.Errorf("ipv6 host expected: %q", got)
	}
}

// TestClientIPTrustedProxies는 PANEL_TRUSTED_PROXIES에 든 TCP 피어만 포워딩 헤더를
// 믿는지 확인합니다. TCP 프록시(nginx 등) 뒤에서 쓰는 배치를 위한 명시적 선택입니다.
func TestClientIPTrustedProxies(t *testing.T) {
	s := &server{cfg: config{trustedProxies: parseTrustedProxies("127.0.0.1, 10.0.0.0/8")}}
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.Header.Set("CF-Connecting-IP", "198.51.100.7")
	for peer, want := range map[string]string{
		"127.0.0.1:1":    "198.51.100.7",
		"10.1.2.3:1":     "198.51.100.7",
		"127.0.0.2:1":    "127.0.0.2", // 목록에 없는 루프백 주소
		"[::1]:1":        "::1",
		"203.0.113.5:80": "203.0.113.5",
	} {
		r.RemoteAddr = peer
		if got := s.clientIP(r); got != want {
			t.Errorf("peer %s: got %q, want %q", peer, got, want)
		}
	}
}

func TestParseTrustedProxies(t *testing.T) {
	got := parseTrustedProxies(" 127.0.0.1 , 10.0.0.0/8,::1, bogus, 300.1.1.1, ")
	want := []string{"127.0.0.1/32", "10.0.0.0/8", "::1/128"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i].String() != want[i] {
			t.Errorf("[%d] got %s, want %s", i, got[i], want[i])
		}
	}
	if p := parseTrustedProxies(""); len(p) != 0 {
		t.Fatalf("빈값은 빈 목록이어야 함: %v", p)
	}
}

// TestListenUnixTrustsForwardedHeaders는 실제 unix 소켓 리스너로 들어온 요청만 포워딩
// 헤더를 믿고, 같은 핸들러라도 루프백 TCP로 들어오면 믿지 않는지 끝에서 끝까지 확인합니다.
func TestListenUnixTrustsForwardedHeaders(t *testing.T) {
	s := &server{}
	echo := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, s.clientIP(r))
	})
	sock := filepath.Join(t.TempDir(), "panel.sock")
	uln, err := listen("unix:" + sock)
	if err != nil {
		t.Fatal(err)
	}
	tln, err := listen("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	for _, ln := range []net.Listener{uln, tln} {
		srv := &http.Server{Handler: echo, ConnContext: proxyConnContext, ReadHeaderTimeout: 5 * time.Second}
		go func() { _ = srv.Serve(ln) }()
		t.Cleanup(func() { _ = srv.Close() })
	}
	if runtime.GOOS != "windows" {
		fi, err := os.Stat(sock)
		if err != nil {
			t.Fatal(err)
		}
		if fi.Mode().Perm() != 0o600 {
			t.Errorf("socket perm = %v, want 0600", fi.Mode().Perm())
		}
	}

	get := func(c *http.Client, url string) string {
		t.Helper()
		req, _ := http.NewRequest(http.MethodGet, url, nil)
		req.Header.Set("CF-Connecting-IP", "198.51.100.7")
		resp, err := c.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return string(b)
	}
	unixClient := &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			var d net.Dialer
			return d.DialContext(ctx, "unix", sock)
		},
	}}
	if got := get(unixClient, "http://panel/"); got != "198.51.100.7" {
		t.Errorf("unix socket: got %q, want 198.51.100.7", got)
	}
	tcpClient := &http.Client{Timeout: 5 * time.Second}
	if got := get(tcpClient, "http://"+tln.Addr().String()+"/"); got != "127.0.0.1" {
		t.Errorf("loopback TCP: got %q, want 127.0.0.1", got)
	}
}

// TestListenUnixSocketFile은 소켓 경로 처리 규칙을 고정합니다. 비정상 종료로 남은 소켓
// 파일은 지우고 다시 열지만, 소켓이 아닌 파일은 지우지 않고 거부합니다.
func TestListenUnixSocketFile(t *testing.T) {
	if _, err := listen("unix:relative.sock"); err == nil {
		t.Error("상대 경로는 거부해야 함")
	}
	dir := t.TempDir()
	regular := filepath.Join(dir, "not-a-socket")
	if err := os.WriteFile(regular, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	if ln, err := listen("unix:" + regular); err == nil {
		_ = ln.Close()
		t.Error("일반 파일 경로는 거부해야 함")
	}
	if b, _ := os.ReadFile(regular); string(b) != "keep" {
		t.Error("일반 파일이 지워지거나 바뀜")
	}

	if runtime.GOOS == "windows" { // 윈도우 AF_UNIX 파일은 소켓 모드 비트로 구분되지 않습니다
		return
	}
	sock := filepath.Join(dir, "stale.sock")
	ln, err := listen("unix:" + sock)
	if err != nil {
		t.Fatal(err)
	}
	ln.(*net.UnixListener).SetUnlinkOnClose(false) // 비정상 종료 흉내: 소켓 파일을 남긴다
	_ = ln.Close()
	ln2, err := listen("unix:" + sock)
	if err != nil {
		t.Fatalf("남은 소켓 파일을 정리하지 못함: %v", err)
	}
	_ = ln2.Close()
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

// TestClientIPRejectsNonIPHeader는 포워딩 헤더에 IP가 아닌 값이 오면 무시하는지 확인합니다.
// 이 값은 레이트 리밋 맵의 키와 경보 메시지에 그대로 쓰이므로, 검증이 없으면 요청마다
// 키를 바꿔 IP별 리미터를 무력화하거나 임의 문자열을 웹훅 본문에 밀어 넣을 수 있습니다.
func TestClientIPRejectsNonIPHeader(t *testing.T) {
	// 헤더를 믿는 경로(신뢰 프록시로 지정한 루프백)에서 값 검증만 따로 확인합니다.
	s := &server{cfg: config{trustedProxies: parseTrustedProxies("127.0.0.1")}}
	cases := []struct{ name, header, value string }{
		{"cf 임의 문자열", "CF-Connecting-IP", "@everyone"},
		{"cf 빈 값에 가까운 공백", "CF-Connecting-IP", "   "},
		{"cf 호스트명", "CF-Connecting-IP", "evil.example.com"},
		{"cf 과다 길이", "CF-Connecting-IP", strings.Repeat("A", 4096)},
		{"xff 임의 문자열", "X-Forwarded-For", "not-an-ip"},
		{"xff 마지막 값이 비정상", "X-Forwarded-For", "8.8.8.8, bogus"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/", nil)
			r.RemoteAddr = "127.0.0.1:9999"
			r.Header.Set(c.header, c.value)
			if got := s.clientIP(r); got != "127.0.0.1" {
				t.Errorf("검증되지 않은 헤더 값이 채택됨: %q", got)
			}
		})
	}
	// 정상 IP는 그대로 채택되어야 합니다(회귀 방지).
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "127.0.0.1:9999"
	r.Header.Set("CF-Connecting-IP", " 203.0.113.9 ")
	if got := s.clientIP(r); got != "203.0.113.9" {
		t.Errorf("정상 IP가 채택되지 않음: %q", got)
	}
}

// TestIsLoopbackAddr는 헬스 리스너 주소가 루프백인지 판단하는 로직을 고정합니다.
// 이 판단이 무인증 내부 API(/internal/*, PUT /api/layout)의 등록 여부를 가릅니다.
func TestIsLoopbackAddr(t *testing.T) {
	loopback := []string{"127.0.0.1:8099", "localhost:8099", "[::1]:8099", "127.5.5.5:1"}
	for _, a := range loopback {
		if !isLoopbackAddr(a) {
			t.Errorf("루프백으로 판단해야 함: %q", a)
		}
	}
	// 호스트가 비면 Go는 모든 인터페이스에 바인드하므로 루프백이 아닙니다.
	notLoopback := []string{":8099", "0.0.0.0:8099", "[::]:8099", "192.168.0.10:8099", "example.com:8099", "", "8099"}
	for _, a := range notLoopback {
		if isLoopbackAddr(a) {
			t.Errorf("루프백이 아니라고 판단해야 함: %q", a)
		}
	}
}
