package main

// 웹 푸시: VAPID 키 자동 생성·재사용과 구독 저장·정리를 고정합니다.

import (
	"crypto/ecdh"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// testPushKeys는 실제 P-256 구독 키 한 쌍(p256dh, auth)을 생성합니다.
// webpush-go가 전송 전에 키로 페이로드를 암호화하므로 HTTP 단계까지 도달하려면
// 유효한 키가 필요합니다.
func testPushKeys(t *testing.T) (p256dh, auth string) {
	t.Helper()
	priv, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	ab := make([]byte, 16)
	if _, err := rand.Read(ab); err != nil {
		t.Fatal(err)
	}
	return base64.RawURLEncoding.EncodeToString(priv.PublicKey().Bytes()),
		base64.RawURLEncoding.EncodeToString(ab)
}

func TestLoadOrCreateVAPID(t *testing.T) {
	path := filepath.Join(t.TempDir(), "vapid.json")
	k1, err := loadOrCreateVAPID(path)
	if err != nil || k1.Public == "" || k1.Private == "" {
		t.Fatalf("generate: %+v err=%v", k1, err)
	}
	if fi, err := os.Stat(path); err != nil || fi.Mode().Perm() != 0o600 {
		t.Fatalf("perm: %v err=%v", fi.Mode().Perm(), err)
	}
	// 재호출 시 같은 키를 재사용해야 함 (키가 바뀌면 기존 구독 전부 무효)
	k2, err := loadOrCreateVAPID(path)
	if err != nil || k2.Public != k1.Public || k2.Private != k1.Private {
		t.Fatalf("reuse: %+v vs %+v err=%v", k2, k1, err)
	}
}

// TestVapidRegenWarnsOnCorrupt은 키 파일이 손상(파싱 불가)됐을 때 재생성이
// 여전히 유효한 키를 만들고 파일을 다시 유효한 JSON으로 남기는지 고정합니다.
// (파일이 존재하는데 읽을 수 없으면 로그 경고를 남기고 회전 — 로그 검증은 선택)
func TestVapidRegenWarnsOnCorrupt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "vapid.json")
	if err := os.WriteFile(path, []byte("{garbage"), 0o600); err != nil {
		t.Fatal(err)
	}
	k, err := loadOrCreateVAPID(path)
	if err != nil || k.Public == "" || k.Private == "" {
		t.Fatalf("regen: %+v err=%v", k, err)
	}
	// 파일이 이제 유효한 JSON이어야 하고 방금 생성한 키와 일치해야 한다.
	var parsed vapidKeys
	if err := readJSON(path, &parsed); err != nil || parsed.Public != k.Public || parsed.Private != k.Private {
		t.Fatalf("file not valid after regen: %+v err=%v", parsed, err)
	}
}

// TestSubscribeRejectsNonHTTPS는 구독 엔드포인트가 https://로 시작하지 않으면 400을
// 반환하는지 고정합니다(서버가 나중에 POST하는 URL — 블라인드 SSRF 방어).
func TestSubscribeRejectsNonHTTPS(t *testing.T) {
	s, _ := newTestServer(t)
	s.cfg.pushEvents = []string{"server", "join"}
	sid, _ := s.sessions.create()
	post := func(endpoint string) int {
		body := `{"endpoint":"` + endpoint + `","keys":{"p256dh":"pk","auth":"ak"}}`
		r := httptest.NewRequest(http.MethodPost, "/api/push/subscribe", strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+sid)
		rec := httptest.NewRecorder()
		s.handlePushSubscribe(rec, r)
		return rec.Code
	}
	if code := post("http://push.example/e1"); code != http.StatusBadRequest {
		t.Fatalf("http endpoint accepted: %d", code)
	}
	if code := post("https://push.example/e1"); code != http.StatusOK {
		t.Fatalf("https endpoint rejected: %d", code)
	}
}

func TestPushSubscribeAPI(t *testing.T) {
	s, dir := newTestServer(t)
	s.cfg.pushEvents = []string{"server", "join"}
	k, err := loadOrCreateVAPID(filepath.Join(dir, "vapid.json"))
	if err != nil {
		t.Fatal(err)
	}
	s.vapid = k
	sid, _ := s.sessions.create()
	do := func(path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+sid)
		rec := httptest.NewRecorder()
		s.apiAuthed("POST", func(w http.ResponseWriter, rq *http.Request, _ string, _ session) {
			if path == "/api/push/subscribe" {
				s.handlePushSubscribe(w, rq)
			} else {
				s.handlePushUnsubscribe(w, rq)
			}
		})(rec, r)
		return rec
	}
	// 구독 등록 (같은 endpoint 재등록은 upsert)
	body := `{"endpoint":"https://push.example/e1","keys":{"p256dh":"pk","auth":"ak"}}`
	if rec := do("/api/push/subscribe", body); rec.Code != http.StatusOK {
		t.Fatalf("subscribe: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do("/api/push/subscribe", body); rec.Code != http.StatusOK {
		t.Fatalf("re-subscribe: %d", rec.Code)
	}
	subs, err := s.store.pushSubs()
	if err != nil || len(subs) != 1 || subs[0].Endpoint != "https://push.example/e1" {
		t.Fatalf("subs: %+v err=%v", subs, err)
	}
	// 필수 필드 누락 → 400
	if rec := do("/api/push/subscribe", `{"endpoint":"","keys":{}}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad subscribe accepted: %d", rec.Code)
	}
	// 해지
	if rec := do("/api/push/unsubscribe", `{"endpoint":"https://push.example/e1"}`); rec.Code != http.StatusOK {
		t.Fatalf("unsubscribe: %d", rec.Code)
	}
	if subs, _ := s.store.pushSubs(); len(subs) != 0 {
		t.Fatalf("sub not removed: %+v", subs)
	}
}

func TestSendPushPrunesGone(t *testing.T) {
	s, dir := newTestServer(t)
	s.cfg.pushEvents = []string{"server", "join"}
	k, _ := loadOrCreateVAPID(filepath.Join(dir, "vapid.json"))
	s.vapid = k
	// 410 Gone을 돌려주는 가짜 푸시 서비스 — 해당 구독은 삭제되어야 한다.
	// ⚠️ webpush-go는 전송 전에 p256dh/auth로 페이로드를 암호화하므로 키가 유효해야
	// HTTP 단계(410 프루닝 분기)까지 도달한다 — 실제 P-256 키를 생성해 쓴다.
	gone := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusGone)
	}))
	defer gone.Close()
	p256dh, auth := testPushKeys(t)
	if err := s.store.upsertPushSub(gone.URL+"/sub1", p256dh, auth, "server"); err != nil {
		t.Fatal(err)
	}
	s.sendPushAllSync("server", "제목", "본문") // 테스트용 동기 버전
	if subs, _ := s.store.pushSubs(); len(subs) != 0 {
		t.Fatalf("gone sub not pruned: %+v", subs)
	}
}

func TestStatusEdgeDetect(t *testing.T) {
	// 감시기의 에지 판정 로직만 순수 함수로 검증
	w := &statusEdge{}
	if ev := w.feed(false); ev != "" {
		t.Fatalf("initial down should not fire: %q", ev)
	}
	if ev := w.feed(true); ev != "" { // down→up 첫 전이는 부팅 — 알리지 않음(초기 상태 미확정)
		t.Fatalf("first up should not fire: %q", ev)
	}
	if ev := w.feed(true); ev != "" {
		t.Fatalf("steady up: %q", ev)
	}
	if ev := w.feed(false); ev != "" { // 1샘플 다운은 디바운스
		t.Fatalf("single down sample fired: %q", ev)
	}
	if ev := w.feed(false); ev != "down" { // 2연속 다운 → 발화
		t.Fatalf("want down, got %q", ev)
	}
	if ev := w.feed(true); ev != "" { // 1샘플 업 디바운스
		t.Fatalf("single up sample fired: %q", ev)
	}
	if ev := w.feed(true); ev != "up" {
		t.Fatalf("want up, got %q", ev)
	}
}

// TestMaintenanceActive는 점검 마커 판정을 고정합니다: 파일 없음·오래된 마커(30분 초과)는
// 점검 아님, 신선한 마커는 점검 중. stale-marker 가드가 알림을 영구 억제하지 않도록.
func TestMaintenanceActive(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	path := filepath.Join(t.TempDir(), ".maintenance")
	// 파일 없음 → 점검 아님
	if maintenanceActive(path, now) {
		t.Fatalf("missing marker should be inactive")
	}
	if err := os.WriteFile(path, []byte("1"), 0o600); err != nil {
		t.Fatal(err)
	}
	// 신선한 마커(now-1분) → 점검 중
	if err := os.Chtimes(path, now, now.Add(-1*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if !maintenanceActive(path, now) {
		t.Fatalf("fresh marker should be active")
	}
	// 경계 안(정확히 30분) → 점검 중
	if err := os.Chtimes(path, now, now.Add(-maintWindow)); err != nil {
		t.Fatal(err)
	}
	if !maintenanceActive(path, now) {
		t.Fatalf("marker at window edge should be active")
	}
	// 오래된 마커(31분) → 점검 아님(stale 가드)
	if err := os.Chtimes(path, now, now.Add(-31*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if maintenanceActive(path, now) {
		t.Fatalf("stale marker (>30min) should be inactive")
	}
}

// TestDownNotifier는 점검 인지 다운 알림 결정 로직을 주입된 시각으로 검증합니다(슬립 없음).
func TestDownNotifier(t *testing.T) {
	t0 := time.Unix(1_700_000_000, 0)

	// 1) 점검 아님: 다운 → 즉시 다운 알림, 복구 → 복구 알림.
	t.Run("normal down then up", func(t *testing.T) {
		n := &downNotifier{}
		if d := n.step("down", t0, false); d != pushDown {
			t.Fatalf("normal down: got %d want pushDown", d)
		}
		if d := n.step("up", t0.Add(30*time.Second), false); d != pushUp {
			t.Fatalf("up after normal down: got %d want pushUp", d)
		}
	})

	// 2) 점검 중 다운이 120초 안에 복구 → 전 구간 무발화(다운도 복구도 조용히).
	t.Run("maint short down then up silent", func(t *testing.T) {
		n := &downNotifier{}
		if d := n.step("down", t0, true); d != pushNone {
			t.Fatalf("maint down: got %d want pushNone", d)
		}
		if d := n.step("", t0.Add(60*time.Second), true); d != pushNone {
			t.Fatalf("maint pending <120s: got %d want pushNone", d)
		}
		if d := n.step("up", t0.Add(90*time.Second), true); d != pushNone {
			t.Fatalf("up after suppressed down: got %d want pushNone", d)
		}
	})

	// 3) 점검 중 다운이 120초 이상 지속 → 문제 알림 1회(이후 틱 중복 없음), 복구 → 복구 알림.
	t.Run("maint long down problem once then up", func(t *testing.T) {
		n := &downNotifier{}
		if d := n.step("down", t0, true); d != pushNone {
			t.Fatalf("maint down: got %d want pushNone", d)
		}
		if d := n.step("", t0.Add(119*time.Second), true); d != pushNone {
			t.Fatalf("maint pending just under 120s: got %d want pushNone", d)
		}
		if d := n.step("", t0.Add(120*time.Second), true); d != pushProblem {
			t.Fatalf("maint pending >=120s: got %d want pushProblem", d)
		}
		// 이후 틱은 중복 발화 금지.
		if d := n.step("", t0.Add(125*time.Second), true); d != pushNone {
			t.Fatalf("problem duplicate: got %d want pushNone", d)
		}
		if d := n.step("", t0.Add(600*time.Second), true); d != pushNone {
			t.Fatalf("problem duplicate later: got %d want pushNone", d)
		}
		// 문제 알림을 보낸 뒤이므로 복구 알림은 발송되어야 함.
		if d := n.step("up", t0.Add(605*time.Second), true); d != pushUp {
			t.Fatalf("up after problem: got %d want pushUp", d)
		}
	})

	// 4) 복구가 다운보다 먼저 관측되는 초기(부팅) 상황: 에지가 up만 오면 다운 미발송이므로 무발화.
	t.Run("up without prior down stays silent", func(t *testing.T) {
		n := &downNotifier{}
		if d := n.step("up", t0, false); d != pushNone {
			t.Fatalf("up without down: got %d want pushNone", d)
		}
	})
}

func TestParsePushEvents(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"server,join", []string{"server", "join"}},
		{"join,server", []string{"server", "join"}}, // 순서 고정: server 먼저
		{"server", []string{"server"}},
		{"join", []string{"join"}},
		{" server , join ", []string{"server", "join"}}, // 공백 허용
		{"server,foo,join", []string{"server", "join"}}, // 무효 토큰 무시
		{"foo,bar", []string{}},                         // 전부 무효 → 빈 목록(비활성)
		{"", []string{}},                                // 빈 값 → 비활성
		{"server,server", []string{"server"}},           // 중복 제거
	}
	for _, c := range cases {
		got := parsePushEvents(c.in)
		if len(got) != len(c.want) {
			t.Fatalf("parsePushEvents(%q) = %v, want %v", c.in, got, c.want)
		}
		for i := range got {
			if got[i] != c.want[i] {
				t.Fatalf("parsePushEvents(%q) = %v, want %v", c.in, got, c.want)
			}
		}
	}
	// config.pushEventEnabled 연동 확인
	cfg := config{pushEvents: parsePushEvents("server")}
	if !cfg.pushEventEnabled("server") || cfg.pushEventEnabled("join") {
		t.Fatalf("pushEventEnabled mismatch: %+v", cfg.pushEvents)
	}
}

func TestPushConfigEndpoint(t *testing.T) {
	get := func(s *server) (int, string, []string) {
		r := httptest.NewRequest(http.MethodGet, "/api/push/config", nil)
		rec := httptest.NewRecorder()
		s.handlePushConfig(rec, r, "", session{})
		var out struct {
			Key    string   `json:"key"`
			Events []string `json:"events"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return rec.Code, out.Key, out.Events
	}
	// 정상: vapid 로드 + 이벤트 활성 → key·events 반영
	s, dir := newTestServer(t)
	s.cfg.pushEvents = []string{"server", "join"}
	k, _ := loadOrCreateVAPID(filepath.Join(dir, "vapid.json"))
	s.vapid = k
	if code, key, events := get(s); code != http.StatusOK || key != k.Public || len(events) != 2 {
		t.Fatalf("config: code=%d key=%q events=%v", code, key, events)
	}
	// 이벤트 0개(비활성) → 빈 응답, 503 아님
	s.cfg.pushEvents = []string{}
	if code, key, events := get(s); code != http.StatusOK || key != "" || len(events) != 0 {
		t.Fatalf("disabled config: code=%d key=%q events=%v", code, key, events)
	}
	// vapid 미로드 → 빈 응답
	s.cfg.pushEvents = []string{"server", "join"}
	s.vapid = vapidKeys{}
	if code, key, events := get(s); code != http.StatusOK || key != "" || len(events) != 0 {
		t.Fatalf("no-vapid config: code=%d key=%q events=%v", code, key, events)
	}
	// 데모 모드 → 빈 응답
	s.vapid = k
	s.cfg.demo = true
	if code, key, events := get(s); code != http.StatusOK || key != "" || len(events) != 0 {
		t.Fatalf("demo config: code=%d key=%q events=%v", code, key, events)
	}
}

func TestSubscribeTopics(t *testing.T) {
	s, _ := newTestServer(t)
	s.cfg.pushEvents = []string{"server", "join"}
	sid, _ := s.sessions.create()
	sub := func(endpoint string, topics string) {
		body := `{"endpoint":"` + endpoint + `","keys":{"p256dh":"pk","auth":"ak"}` + topics + `}`
		r := httptest.NewRequest(http.MethodPost, "/api/push/subscribe", strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+sid)
		rec := httptest.NewRecorder()
		s.handlePushSubscribe(rec, r)
		if rec.Code != http.StatusOK {
			t.Fatalf("subscribe %s: %d %s", endpoint, rec.Code, rec.Body.String())
		}
	}
	sub("https://push.example/e1", `,"topics":["join"]`)          // 부분 구독
	sub("https://push.example/e2", ``)                            // topics 누락 → 전체
	sub("https://push.example/e3", `,"topics":["join","server"]`) // 순서 뒤섞임 → 고정
	sub("https://push.example/e4", `,"topics":["join","bogus"]`)  // 무효 토큰 무시
	subs, err := s.store.pushSubs()
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, p := range subs {
		got[p.Endpoint] = p.Topics
	}
	want := map[string]string{
		"https://push.example/e1": "join",
		"https://push.example/e2": "server,join",
		"https://push.example/e3": "server,join",
		"https://push.example/e4": "join",
	}
	for ep, w := range want {
		if got[ep] != w {
			t.Fatalf("topics for %s = %q, want %q (all=%+v)", ep, got[ep], w, got)
		}
	}
}

func TestSendPushTopicFilter(t *testing.T) {
	s, dir := newTestServer(t)
	s.cfg.pushEvents = []string{"server", "join"}
	k, _ := loadOrCreateVAPID(filepath.Join(dir, "vapid.json"))
	s.vapid = k
	var serverHits, joinHits int32
	mk := func(cnt *int32) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			atomic.AddInt32(cnt, 1)
			w.WriteHeader(http.StatusCreated)
		}))
	}
	srvSub := mk(&serverHits)
	defer srvSub.Close()
	joinSub := mk(&joinHits)
	defer joinSub.Close()
	pk, ak := testPushKeys(t)
	if err := s.store.upsertPushSub(srvSub.URL, pk, ak, "server"); err != nil {
		t.Fatal(err)
	}
	pk2, ak2 := testPushKeys(t)
	if err := s.store.upsertPushSub(joinSub.URL, pk2, ak2, "join"); err != nil {
		t.Fatal(err)
	}
	// join 발송 → join 구독만 수신
	s.sendPushAllSync("join", "제목", "본문")
	if atomic.LoadInt32(&joinHits) != 1 || atomic.LoadInt32(&serverHits) != 0 {
		t.Fatalf("join topic filter: joinHits=%d serverHits=%d", joinHits, serverHits)
	}
	// server 발송 → server 구독만 수신
	s.sendPushAllSync("server", "제목", "본문")
	if atomic.LoadInt32(&serverHits) != 1 || atomic.LoadInt32(&joinHits) != 1 {
		t.Fatalf("server topic filter: joinHits=%d serverHits=%d", joinHits, serverHits)
	}
}

func TestNotifyJoinDisabled(t *testing.T) {
	s, _ := newTestServer(t)
	// join 비활성(server만) → notifyJoin은 쿨다운 갱신 없이 즉시 반환
	s.cfg.pushEvents = []string{"server"}
	s.lastJoinPush = 0
	s.notifyJoin("player", false)
	if s.lastJoinPush != 0 {
		t.Fatalf("notifyJoin mutated cooldown while join disabled: %d", s.lastJoinPush)
	}
	// join 활성 → 쿨다운이 갱신되어야 함
	s.cfg.pushEvents = []string{"server", "join"}
	s.notifyJoin("player", false)
	if s.lastJoinPush == 0 {
		t.Fatalf("notifyJoin did not update cooldown while join enabled")
	}
}

func TestTopicsMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.db")
	// topics 컬럼이 없는 구 스키마 DB를 수동으로 만든다.
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE push_subs (
		endpoint TEXT PRIMARY KEY,
		p256dh   TEXT NOT NULL,
		auth     TEXT NOT NULL,
		created  INTEGER NOT NULL
	)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO push_subs(endpoint, p256dh, auth, created)
		VALUES('https://push.example/old', 'pk', 'ak', 0)`); err != nil {
		t.Fatal(err)
	}
	_ = db.Close()
	// openStore가 ALTER로 topics 컬럼을 추가하고 기존 행은 기본값을 얻어야 한다.
	st, err := openStore(path)
	if err != nil {
		t.Fatalf("openStore migrate: %v", err)
	}
	subs, err := st.pushSubs()
	if err != nil || len(subs) != 1 || subs[0].Topics != "server,join" {
		t.Fatalf("migrated topics: %+v err=%v", subs, err)
	}
	_ = st.close()
	// 재오픈 시 ALTER는 duplicate column으로 무시되어 무오류여야 한다.
	st2, err := openStore(path)
	if err != nil {
		t.Fatalf("reopen after migrate: %v", err)
	}
	_ = st2.close()
}
