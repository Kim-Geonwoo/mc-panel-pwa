package main

// 관리자 세션·레이아웃 발행 테스트: 관리자 코드 로그인, /api/me의 admin 표시,
// 공개 mux PUT /api/layout의 인증·권한·데모 차단·레이트 리밋이 회귀하지 않도록 고정합니다.

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// doLogin은 handleLogin에 코드 하나를 보내고 응답을 돌려줍니다.
func doLogin(s *server, code, ip string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, "/api/login", strings.NewReader(`{"code":"`+code+`"}`))
	r.RemoteAddr = ip
	rec := httptest.NewRecorder()
	s.api("POST", s.handleLogin)(rec, r)
	return rec
}

// tokenOf는 로그인 응답에서 세션 토큰을 뽑아 냅니다.
func tokenOf(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var resp struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil || len(resp.Token) != 64 {
		t.Fatalf("token missing or wrong length: %s", rec.Body.String())
	}
	return resp.Token
}

func TestAdminLoginFlow(t *testing.T) {
	s, dir := newTestServer(t)
	s.cfg.adminCode = "ADMIN-999999"
	if err := os.WriteFile(filepath.Join(dir, "auth.json"), []byte(`{"code":"123456"}`), 0o600); err != nil {
		t.Fatal(err)
	}

	// 관리자 코드 로그인 → admin=true 세션
	rec := doLogin(s, "ADMIN-999999", "203.0.113.30:1")
	if rec.Code != http.StatusOK {
		t.Fatalf("admin login: got %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	adminSid := tokenOf(t, rec)
	sess, ok := s.sessions.get(adminSid)
	if !ok || !sess.Admin {
		t.Fatalf("admin session not marked: ok=%v admin=%v", ok, sess.Admin)
	}

	// /api/me에 admin:true가 실려야 합니다
	me := s.apiAuthed("GET", s.handleMe)
	r := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	r.Header.Set("Authorization", "Bearer "+adminSid)
	rec2 := httptest.NewRecorder()
	me(rec2, r)
	if rec2.Code != http.StatusOK || !strings.Contains(rec2.Body.String(), `"admin":true`) {
		t.Fatalf("me admin: %d %s", rec2.Code, rec2.Body.String())
	}

	// 기존 일반 코드 경로는 그대로 — admin=false 세션
	rec3 := doLogin(s, "123456", "203.0.113.31:1")
	if rec3.Code != http.StatusOK {
		t.Fatalf("normal login: got %d, want 200", rec3.Code)
	}
	normalSid := tokenOf(t, rec3)
	if sess, ok := s.sessions.get(normalSid); !ok || sess.Admin {
		t.Fatalf("normal session must not be admin: ok=%v admin=%v", ok, sess.Admin)
	}
	r = httptest.NewRequest(http.MethodGet, "/api/me", nil)
	r.Header.Set("Authorization", "Bearer "+normalSid)
	rec4 := httptest.NewRecorder()
	me(rec4, r)
	if rec4.Code != http.StatusOK || !strings.Contains(rec4.Body.String(), `"admin":false`) {
		t.Fatalf("me normal: %d %s", rec4.Code, rec4.Body.String())
	}
}

func TestAdminLoginDisabledOrWrongCode(t *testing.T) {
	s, dir := newTestServer(t)
	if err := os.WriteFile(filepath.Join(dir, "auth.json"), []byte(`{"code":"123456"}`), 0o600); err != nil {
		t.Fatal(err)
	}

	// PANEL_ADMIN_CODE 미설정 — 어떤 코드로도 관리자 로그인이 되지 않아야 합니다
	if rec := doLogin(s, "ADMIN-999999", "203.0.113.40:1"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("admin login with unset code: got %d, want 401", rec.Code)
	}
	// 빈 코드도 관리자로 통과하면 안 됩니다 (빈값이면 비교 자체를 건너뜀)
	if rec := doLogin(s, "", "203.0.113.40:1"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("empty code with unset admin code: got %d, want 401", rec.Code)
	}

	// 설정돼 있어도 오답(같은 길이)이면 일반 경로로 떨어져 401
	s.cfg.adminCode = "ADMIN-999999"
	if rec := doLogin(s, "ADMIN-000000", "203.0.113.41:1"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("wrong admin code: got %d, want 401", rec.Code)
	}
}

func TestDemoLoginGrantsAdmin(t *testing.T) {
	s := newDemoServer(t)
	s.layoutRL = newRateLimiter(60, 10)

	// 데모 코드 로그인 세션에도 admin:true가 붙어야 합니다 (스튜디오 체험용)
	rec := doLogin(s, demoLoginCode, "203.0.113.50:1")
	if rec.Code != http.StatusOK {
		t.Fatalf("demo login: got %d, want 200", rec.Code)
	}
	sid := tokenOf(t, rec)
	if sess, ok := s.sessions.get(sid); !ok || !sess.Admin {
		t.Fatalf("demo session must be admin: ok=%v", ok)
	}

	// 하지만 실제 발행은 데모 모드에서 차단 → 403 {"error":"demo"}
	h := s.api("GET,PUT", s.handleLayout)
	r := httptest.NewRequest(http.MethodPut, "/api/layout", bytes.NewReader([]byte(`{"version":1}`)))
	r.Header.Set("Authorization", "Bearer "+sid)
	rec2 := httptest.NewRecorder()
	h(rec2, r)
	if rec2.Code != http.StatusForbidden || !strings.Contains(rec2.Body.String(), `"demo"`) {
		t.Fatalf("demo publish: got %d %s, want 403 demo", rec2.Code, rec2.Body.String())
	}
}

func TestLayoutPublishChain(t *testing.T) {
	s, dir := newTestServer(t)
	p := filepath.Join(dir, "layout.json")
	s.layout = newFileLayoutStore(p)
	s.layoutRL = newRateLimiter(60, 10)
	h := s.api("GET,PUT", s.handleLayout)

	put := func(sid, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPut, "/api/layout", bytes.NewReader([]byte(body)))
		if sid != "" {
			r.Header.Set("Authorization", "Bearer "+sid)
		}
		rec := httptest.NewRecorder()
		h(rec, r)
		return rec
	}

	// GET은 공개·무인증 그대로 (기본 레이아웃 200)
	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodGet, "/api/layout", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("public get: got %d, want 200", rec.Code)
	}

	// 무인증 PUT → 401
	if rec := put("", `{"version":1}`); rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated put: got %d, want 401", rec.Code)
	}

	// 일반 세션 PUT → 403 {"error":"forbidden"}
	normalSid, _ := s.sessions.create()
	if rec := put(normalSid, `{"version":1}`); rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), `"forbidden"`) {
		t.Fatalf("non-admin put: got %d %s, want 403 forbidden", rec.Code, rec.Body.String())
	}

	// 관리자 세션 PUT → 200 + 파일 반영
	adminSid, _ := s.sessions.createWith(true)
	if rec := put(adminSid, `{"version":1,"meta":{"title":"published"}}`); rec.Code != http.StatusOK {
		t.Fatalf("admin put: got %d %s, want 200", rec.Code, rec.Body.String())
	}
	if got, _ := os.ReadFile(p); !bytes.Contains(got, []byte("published")) {
		t.Fatalf("layout not persisted: %s", got)
	}

	// 손상 본문 → 400
	if rec := put(adminSid, `{bad`); rec.Code != http.StatusBadRequest {
		t.Fatalf("corrupt body: got %d, want 400", rec.Code)
	}
}

func TestLayoutPublishRateLimit(t *testing.T) {
	s, dir := newTestServer(t)
	s.layout = newFileLayoutStore(filepath.Join(dir, "layout.json"))
	s.layoutRL = newRateLimiter(60, 10)
	h := s.api("GET,PUT", s.handleLayout)
	adminSid, _ := s.sessions.createWith(true)

	do := func() *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPut, "/api/layout", bytes.NewReader([]byte(`{"version":1}`)))
		r.Header.Set("Authorization", "Bearer "+adminSid)
		rec := httptest.NewRecorder()
		h(rec, r)
		return rec
	}
	// 분당 10회까지는 허용
	for i := 0; i < 10; i++ {
		if rec := do(); rec.Code != http.StatusOK {
			t.Fatalf("put %d: got %d, want 200", i+1, rec.Code)
		}
	}
	// 11번째 → 429 {"error":"slow_down"}
	if rec := do(); rec.Code != http.StatusTooManyRequests || !strings.Contains(rec.Body.String(), `"slow_down"`) {
		t.Fatalf("11th put: got %d %s, want 429 slow_down", rec.Code, rec.Body.String())
	}
	// 다른 세션은 독립적으로 허용
	otherSid, _ := s.sessions.createWith(true)
	r := httptest.NewRequest(http.MethodPut, "/api/layout", bytes.NewReader([]byte(`{"version":1}`)))
	r.Header.Set("Authorization", "Bearer "+otherSid)
	rec := httptest.NewRecorder()
	h(rec, r)
	if rec.Code != http.StatusOK {
		t.Fatalf("other session must be independent: got %d", rec.Code)
	}
}
