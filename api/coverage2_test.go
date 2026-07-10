package main

// M16: 커버리지 80% 달성 보강. 기존 coverage_test.go가 다루지 못한 오류·경계 분기를
// 실제 동작(상태 코드·반환 오류·상태 변화) 기준으로 고정합니다: 내부 ingest 오류 경로,
// 닫힌 스토어에서의 삽입/삭제 실패, 임포터 엣지(파일 없음·손상·커서 리셋·중복 스킵),
// 세션 영속화 실패·취소 목록 갱신, 정적 경로 순회 차단, 채팅 전달 실패 로깅, 푸시
// 구독/발송 가드, 헬스체크 주소 보정 등. 무결성 원칙: 모든 테스트는 관측 가능한
// 결과를 단언합니다(단언 없는 커버리지 채우기 금지).

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// ------------------------------------------------------------------ 내부 ingest 오류 경로

func TestInternalIngestErrorPaths(t *testing.T) {
	// 데모(store nil) → 503
	d := newDemoServer(t)
	rec := httptest.NewRecorder()
	d.handleInternalIngest(rec, httptest.NewRequest(http.MethodPost, "/i",
		strings.NewReader(`{"kind":"chat","source":"web","user":"u","text":"t"}`)))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("no store: got %d, want 503", rec.Code)
	}

	s, _ := newTestServer(t)
	// 잘못된 JSON → 400
	rec = httptest.NewRecorder()
	s.handleInternalIngest(rec, httptest.NewRequest(http.MethodPost, "/i", strings.NewReader(`{bad`)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("bad json: got %d, want 400", rec.Code)
	}
	// 타임라인 이름이 공백뿐 → 새니타이즈 후 빈 문자열 → 400
	rec = httptest.NewRecorder()
	s.handleInternalIngest(rec, httptest.NewRequest(http.MethodPost, "/i",
		strings.NewReader(`{"kind":"timeline","event":"join","name":"   "}`)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("empty timeline name: got %d, want 400", rec.Code)
	}

	// 닫힌 store → chat/timeline 삽입 실패 시 500
	_ = s.store.close()
	rec = httptest.NewRecorder()
	s.handleInternalIngest(rec, httptest.NewRequest(http.MethodPost, "/i",
		strings.NewReader(`{"kind":"chat","source":"web","user":"u","text":"t"}`)))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("closed store chat: got %d, want 500", rec.Code)
	}
	rec = httptest.NewRecorder()
	s.handleInternalIngest(rec, httptest.NewRequest(http.MethodPost, "/i",
		strings.NewReader(`{"kind":"timeline","event":"join","name":"철수"}`)))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("closed store timeline: got %d, want 500", rec.Code)
	}
}

// ------------------------------------------------------------------ 닫힌 스토어 오류

func TestStoreClosedErrors(t *testing.T) {
	s, _ := newTestServer(t)
	st := s.store
	_ = st.close()
	if _, err := st.insertChatAuto(1, "web", "", "u", "t"); err == nil {
		t.Fatal("insertChatAuto on closed store should error")
	}
	if _, err := st.insertTimelineAuto(1, "k", "u", "n", "join", false); err == nil {
		t.Fatal("insertTimelineAuto on closed store should error")
	}
	if _, err := st.pruneTimeline(0); err == nil {
		t.Fatal("pruneTimeline on closed store should error")
	}
	if _, err := st.pushSubs(); err == nil {
		t.Fatal("pushSubs on closed store should error")
	}
}

// ------------------------------------------------------------------ 임포터 엣지

func TestImporterEdgePaths(t *testing.T) {
	s, _ := newTestServer(t)

	// importChat: 파일 없음 → prevMtime 유지
	if got := s.importChat(0); got != 0 {
		t.Fatalf("no chat file: mtime=%d, want 0", got)
	}
	// importChat: 손상 파일 → 읽기 실패로 prevMtime 유지
	writeFile(t, s.cfg.chatJSON, "{corrupt")
	if got := s.importChat(0); got != 0 {
		t.Fatalf("corrupt chat file should keep prev mtime: %d", got)
	}

	// importTimeline: 파일 없음 → prevMtime 유지
	if got := s.importTimeline(0); got != 0 {
		t.Fatalf("no timeline file: mtime=%d, want 0", got)
	}
	// 단일 join 이벤트 → notify 경로를 통과하며 1건 삽입, 커서=파일 id
	writeFile(t, s.cfg.timelineJSON,
		`[{"id":5,"ts":10,"ts_kst":"2026-07-10 00:00:00","name":"철수","event":"join","is_first":true}]`)
	mt := s.importTimeline(0)
	if mt == 0 {
		t.Fatal("timeline import did not advance mtime")
	}
	if s.store.metaInt(metaTimelineImportID) != 5 {
		t.Fatalf("cursor=%d, want 5", s.store.metaInt(metaTimelineImportID))
	}
	if evs, _ := s.store.timelineEvents(); len(evs) != 1 {
		t.Fatalf("single import count=%d, want 1", len(evs))
	}
	// 같은 mtime → 재처리하지 않음
	if got := s.importTimeline(mt); got != mt {
		t.Fatal("unchanged timeline re-imported")
	}
	// 같은 내용·새 mtime → 모든 id가 커서 이하 → continue (신규 삽입 없음)
	later := time.Now().Add(3 * time.Second)
	if err := os.Chtimes(s.cfg.timelineJSON, later, later); err != nil {
		t.Fatal(err)
	}
	s.importTimeline(mt)
	if evs, _ := s.store.timelineEvents(); len(evs) != 1 {
		t.Fatalf("continue-skip added rows: count=%d, want 1", len(evs))
	}
	// 손상된 파일·새 mtime → 읽기 실패로 prevMtime 유지
	writeFile(t, s.cfg.timelineJSON, "{bad")
	later2 := time.Now().Add(6 * time.Second)
	_ = os.Chtimes(s.cfg.timelineJSON, later2, later2)
	prev := later.UnixNano()
	if got := s.importTimeline(prev); got != prev {
		t.Fatalf("corrupt timeline should keep prev mtime: got %d", got)
	}
	// 커서 리셋: 커서를 크게 설정 후 낮은 id 파일 → 되감고 재임포트
	if err := s.store.setMetaInt(metaTimelineImportID, 9999); err != nil {
		t.Fatal(err)
	}
	writeFile(t, s.cfg.timelineJSON,
		`[{"id":1,"ts":20,"ts_kst":"2026-07-10 01:00:00","name":"영희","event":"join","is_first":false}]`)
	later3 := time.Now().Add(9 * time.Second)
	_ = os.Chtimes(s.cfg.timelineJSON, later3, later3)
	s.importTimeline(prev)
	if evs, _ := s.store.timelineEvents(); len(evs) != 2 {
		t.Fatalf("reset resync count=%d, want 2", len(evs))
	}
}

func TestImporterInsertFailure(t *testing.T) {
	s, _ := newTestServer(t)
	writeFile(t, s.cfg.chatJSON, `[{"id":1,"ts":1,"source":"game","user":"u","text":"t"}]`)
	writeFile(t, s.cfg.timelineJSON,
		`[{"id":1,"ts":1,"ts_kst":"2026-07-10 00:00:00","name":"n","event":"join"}]`)
	_ = s.store.close() // 이후 삽입은 모두 실패해야 함
	// 삽입 실패 시 커서를 진전시키지 않고 prevMtime을 그대로 돌려줘 다음 틱에 재시도
	if got := s.importChat(0); got != 0 {
		t.Fatalf("chat insert failure should keep prev mtime: got %d", got)
	}
	if got := s.importTimeline(0); got != 0 {
		t.Fatalf("timeline insert failure should keep prev mtime: got %d", got)
	}
}

// ------------------------------------------------------------------ 세션 영속화·취소 목록

func TestSessionStoreLoadAndRevokedRefresh(t *testing.T) {
	dir := t.TempDir()
	sessPath := filepath.Join(dir, "sessions.json")
	revPath := filepath.Join(dir, "web_revoked.json")

	// newSessionStore가 디스크의 기존 세션을 로드하는 경로(raw != nil)
	future := strconv.FormatInt(time.Now().Unix()+3600, 10)
	writeFile(t, sessPath, `{"seed-sid":{"exp":`+future+`,"created":1,"nickname":"씨앗"}}`)
	st := newSessionStore(sessPath, revPath, 3600)
	if sess, ok := st.get("seed-sid"); !ok || sess.Nickname != "씨앗" {
		t.Fatalf("loaded session missing: ok=%v sess=%+v", ok, sess)
	}

	// 취소 목록 로드 → 해당 세션 거부
	reAdd := func(sid string) {
		st.mu.Lock()
		st.data[sid] = &session{Exp: time.Now().Unix() + 3600, Created: 1}
		st.mu.Unlock()
	}
	writeFile(t, revPath, `["revoked-sid"]`)
	reAdd("revoked-sid")
	if _, ok := st.get("revoked-sid"); ok {
		t.Fatal("revoked session accepted on first refresh")
	}
	// mtime 변화 없음 → 재파싱 없이 조기 반환, 취소 상태 유지
	reAdd("revoked-sid")
	if _, ok := st.get("revoked-sid"); ok {
		t.Fatal("revoked session accepted after unchanged-mtime path")
	}
	// 취소 파일 삭제 → 목록이 비워져 세션이 되살아남
	if err := os.Remove(revPath); err != nil {
		t.Fatal(err)
	}
	reAdd("revoked-sid")
	if _, ok := st.get("revoked-sid"); !ok {
		t.Fatal("revocation not cleared after file removed")
	}
}

func TestSessionPersistWriteError(t *testing.T) {
	dir := t.TempDir()
	// 존재하지 않는 하위 디렉토리를 경로로 주면 persistLocked의 WriteFile이 실패합니다.
	// 디스크 기록은 실패해도 인메모리 세션은 유지되어야 합니다(영속화는 best-effort).
	bad := filepath.Join(dir, "no-such-dir", "sessions.json")
	rev := filepath.Join(dir, "web_revoked.json")
	st := newSessionStore(bad, rev, 3600)
	sid, err := st.create()
	if err != nil {
		t.Fatalf("create should succeed even if persist fails: %v", err)
	}
	if _, ok := st.get(sid); !ok {
		t.Fatal("in-memory session lost after persist failure")
	}
	if _, statErr := os.Stat(bad); !os.IsNotExist(statErr) {
		t.Fatalf("session file unexpectedly created: %v", statErr)
	}
}

func TestSessionListSkipsExpired(t *testing.T) {
	s, _ := newTestServer(t)
	live, _ := s.sessions.create()
	_ = s.sessions.setNickname(live, "살아있음")
	dead, _ := s.sessions.create()
	s.sessions.mu.Lock()
	s.sessions.data[dead].Exp = time.Now().Unix() - 1 // 강제 만료
	s.sessions.mu.Unlock()

	infos := s.sessions.list()
	if len(infos) != 1 || infos[0].Nickname != "살아있음" {
		t.Fatalf("list should contain only the live session: %+v", infos)
	}
}

// ------------------------------------------------------------------ clientIP

func TestClientIPXFFNoComma(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "127.0.0.1:1"               // 루프백(cloudflared)이면 XFF 신뢰
	r.Header.Set("X-Forwarded-For", "7.7.7.7") // 쉼표 없는 단일 값
	if got := clientIP(r); got != "7.7.7.7" {
		t.Fatalf("single-value XFF: got %q, want 7.7.7.7", got)
	}
}

// ------------------------------------------------------------------ 정적 파일 순회 차단

func TestStaticRejectsDotDot(t *testing.T) {
	s, _ := newTestServer(t)
	if err := os.MkdirAll(s.cfg.staticDir, 0o700); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(s.cfg.staticDir, "index.html"), "INDEX")
	rec := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.URL.Path = "/weird..name" // filepath.Clean 후에도 ".." 포함 → 차단
	s.static(rec, r)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("path containing '..' should be 404, got %d", rec.Code)
	}
}

// ------------------------------------------------------------------ 채팅 전달 실패·오류

func TestHandleChatPostDeliveryFailuresLogged(t *testing.T) {
	s, dir := newTestServer(t)
	// 일반 파일을 부모로 두면 게임 인박스(CreateTemp)와 outbox(MkdirAll)가 모두 실패합니다.
	// 그래도 DB 저장은 성공하므로 응답은 200이어야 합니다(전달만 지연).
	blk := filepath.Join(dir, "blockfile")
	writeFile(t, blk, "x")
	s.cfg.outboxDir = filepath.Join(blk, "out")
	s.cfg.gameInbox = filepath.Join(blk, "wtg.json")

	rec := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/chat", strings.NewReader(`{"text":"배달실패"}`))
	s.handleChat(rec, r, "sid", session{Nickname: "보내는이"})
	if rec.Code != http.StatusOK {
		t.Fatalf("post should still succeed (message saved): %d %s", rec.Code, rec.Body.String())
	}
	out, _, _ := s.store.chatSince(0, 10)
	if len(out) != 1 || out[0].Text != "배달실패" || out[0].Source != "web" {
		t.Fatalf("message not saved despite delivery failure: %+v", out)
	}
}

func TestHandleChatPostStoreError(t *testing.T) {
	s, _ := newTestServer(t)
	_ = s.store.close()
	rec := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/chat", strings.NewReader(`{"text":"저장실패"}`))
	s.handleChat(rec, r, "sid", session{Nickname: "N"})
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("closed store POST: got %d, want 500", rec.Code)
	}
}

func TestHandleChatGetBranches(t *testing.T) {
	// 비데모 GET since=0 정상 응답
	s, _ := newTestServer(t)
	if _, err := s.store.insertChatAuto(time.Now().UnixMilli(), "web", "", "U", "안녕하세요"); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	s.handleChat(rec, httptest.NewRequest(http.MethodGet, "/api/chat?since=0", nil), "", session{})
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "안녕하세요") {
		t.Fatalf("non-demo since: %d %s", rec.Code, rec.Body.String())
	}

	// 데모 before에 해당 메시지 없음 → 빈 배열
	d := newDemoServer(t)
	rec = httptest.NewRecorder()
	d.handleChat(rec, httptest.NewRequest(http.MethodGet, "/api/chat?before=1", nil), "", session{})
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"messages":[]`) {
		t.Fatalf("demo before empty: %d %s", rec.Code, rec.Body.String())
	}
}

// ------------------------------------------------------------------ handleStatus 온라인·플레이어 없음

func TestHandleStatusOnlineNoPlayers(t *testing.T) {
	s, dir := newTestServer(t)
	now := ftoa(float64(time.Now().UnixMilli()))
	// 신선한 status지만 players 키가 없는 경우 → 빈 배열로 정규화
	writeFile(t, filepath.Join(dir, "status.json"), `{"ts":`+now+`,"count":3,"tps":19.5,"mspt":9.1}`)
	rec := httptest.NewRecorder()
	s.handleStatus(rec, httptest.NewRequest(http.MethodGet, "/api/status", nil), "", session{})
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["server_up"] != true || body["count"].(float64) != 3 {
		t.Fatalf("status online: %v", body)
	}
	players, ok := body["players"].([]any)
	if !ok || len(players) != 0 {
		t.Fatalf("players should be an empty array, got %v", body["players"])
	}
}

// ------------------------------------------------------------------ enqueueOutbox

func TestEnqueueOutboxBacklogAndMkdirError(t *testing.T) {
	s, dir := newTestServer(t)
	// 백로그: outbox 파일이 상한(500)을 넘으면 새 메시지를 거부해 inode/디스크 고갈을 막습니다.
	if err := os.MkdirAll(s.cfg.outboxDir, 0o700); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 501; i++ {
		writeFile(t, filepath.Join(s.cfg.outboxDir, "m"+strconv.Itoa(i)+".json"), "{}")
	}
	if err := s.enqueueOutbox("nick", "text"); err == nil || err.Error() != "backlog" {
		t.Fatalf("expected backlog error, got %v", err)
	}

	// MkdirAll 실패: 부모가 일반 파일이면 디렉토리를 만들 수 없습니다.
	blk := filepath.Join(dir, "blk")
	writeFile(t, blk, "x")
	s.cfg.outboxDir = filepath.Join(blk, "out")
	if err := s.enqueueOutbox("nick", "text"); err == nil {
		t.Fatal("expected MkdirAll error when outboxDir parent is a file")
	}
}

// ------------------------------------------------------------------ 헬스체크

func TestRunHealthcheckColonPrefixAndBadStatus(t *testing.T) {
	// 비정상 상태코드(500) → 1
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer bad.Close()
	t.Setenv("PANEL_HEALTH_LISTEN", strings.TrimPrefix(bad.URL, "http://"))
	if got := runHealthcheck(); got != 1 {
		t.Fatalf("non-200 status: got %d, want 1", got)
	}

	// ":포트" 형태 주소는 127.0.0.1로 보정되어야 함
	ok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer ok.Close()
	_, port, err := net.SplitHostPort(strings.TrimPrefix(ok.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("PANEL_HEALTH_LISTEN", ":"+port)
	if got := runHealthcheck(); got != 0 {
		t.Fatalf("colon-prefixed addr: got %d, want 0", got)
	}
}

// ------------------------------------------------------------------ 푸시

func TestNormalizeTopicsFallback(t *testing.T) {
	s := newDemoServer(t) // cfg.pushEvents = ["server","join"]
	// 요청 토픽이 활성 이벤트와 전혀 겹치지 않으면 활성 전체로 대체합니다.
	if got := s.normalizeTopics([]string{"bogus", "nope"}); got != "server,join" {
		t.Fatalf("fallback topics = %q, want server,join", got)
	}
}

func TestPushSubscribeUnsubscribeStoreError(t *testing.T) {
	s, _ := newTestServer(t)
	s.cfg.pushEvents = []string{"server", "join"}
	_ = s.store.close() // store는 nil이 아니지만 닫혀 있어 upsert/delete가 실패

	rec := httptest.NewRecorder()
	body := `{"endpoint":"https://push.example/e","keys":{"p256dh":"pk","auth":"ak"}}`
	s.handlePushSubscribe(rec, httptest.NewRequest(http.MethodPost, "/s", strings.NewReader(body)))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("subscribe on closed store: got %d, want 500", rec.Code)
	}

	rec = httptest.NewRecorder()
	s.handlePushUnsubscribe(rec, httptest.NewRequest(http.MethodPost, "/u",
		strings.NewReader(`{"endpoint":"https://push.example/e"}`)))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("unsubscribe on closed store: got %d, want 500", rec.Code)
	}
}

func TestSendPushAllSyncGuards(t *testing.T) {
	s, dir := newTestServer(t)
	s.cfg.pushEvents = []string{"join"} // "server"는 비활성
	k, err := loadOrCreateVAPID(filepath.Join(dir, "vapid.json"))
	if err != nil {
		t.Fatal(err)
	}
	s.vapid = k

	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()
	pk, ak := testPushKeys(t)
	if err := s.store.upsertPushSub(srv.URL, pk, ak, "server"); err != nil {
		t.Fatal(err)
	}

	// 비활성 토픽 → 아무것도 발송하지 않음(구독은 있어도 서버 설정이 우선)
	s.sendPushAllSync("server", "제목", "본문")
	if atomic.LoadInt32(&hits) != 0 {
		t.Fatalf("disabled topic was sent: hits=%d", hits)
	}
	// 활성 토픽이지만 구독이 하나도 없으면 조기 반환
	_ = s.store.deletePushSub(srv.URL)
	s.sendPushAllSync("join", "제목", "본문")
	if atomic.LoadInt32(&hits) != 0 {
		t.Fatalf("send with no subscribers happened: hits=%d", hits)
	}
}

func TestLoadOrCreateVAPIDWriteError(t *testing.T) {
	// 존재하지 않는 디렉토리 → 새로 생성한 키를 기록하지 못해 오류를 반환해야 합니다.
	path := filepath.Join(t.TempDir(), "no-such-dir", "vapid.json")
	if _, err := loadOrCreateVAPID(path); err == nil {
		t.Fatal("loadOrCreateVAPID should fail when the directory is missing")
	}
}

// ------------------------------------------------------------------ 경보 웹훅(비2xx)

func TestAlerterWebhookNon2xx(t *testing.T) {
	received := make(chan struct{}, 1)
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case received <- struct{}{}:
		default:
		}
		w.WriteHeader(http.StatusInternalServerError) // 3xx 이상 → 상태 로그 분기 실행
	}))
	defer ts.Close()
	a := newAlerter(ts.URL)
	a.cooldown = 0
	a.send("테스트 경보")
	select {
	case <-received:
		// 웹훅이 실제로 호출되었음을 확인(비2xx여도 발송은 수행)
	case <-time.After(3 * time.Second):
		t.Fatal("webhook not called on non-2xx path")
	}
}
