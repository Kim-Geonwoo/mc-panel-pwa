// mc_sv-panel의 API 서버이자 정적 파일 서버입니다.
//
// 이 프로그램은 하나의 Go 바이너리 안에서 두 가지 일을 함께 처리합니다.
// 먼저 Next.js로 미리 빌드해 둔 패널 화면(web/out)을 "/" 경로에서 그대로 내보내고,
//
// 그와 함께 /api/login, /api/logout, /api/me, /api/nickname, /api/status, /api/chat 같은
// API 요청도 같은 서버에서 응답합니다.
//
// 로그인 - 서버가 세션을 직접 관리하여, 요청을 통해서 특정 유저의 세션을 끊을 수 있습니다.
// 유저의 세션은 서버와 유저의 브라우저 localStorage에 저장하며,
// 2일 후에는 갱신되는 6자리 코드로 다시 로그인해야 합니다.
//
// 채팅은 디스코드 봇이 모든 메시지가 오가는 중심 역할을 합니다. 봇이 chat.json에 대화 내용을 써 두면
// 웹에서는 GET /api/chat으로 그 내용을 읽고, 반대로 웹에서 보낸 메시지는 web_outbox 폴더에 쌓아 두면
// 봇이 가져가 처리합니다(POST /api/chat). 위에서 언급한 파일 경로들은 모두 환경변수로 바꿀 수 있습니다.
// (디스코드 봇은 아직은 공개할 계획이 없으므로, 추후 웹을 중심으로 채팅을 처리하는 방식으로 바뀔 예정입니다.)
//
// 수정가능한 환경변수 목록
// loadConfig() 함수 위의 주석에서 확인가능
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// ------------------------------------------------------------------ 설정
type config struct {
	listen       string
	statusJSON   string
	recordsJSON  string
	authJSON     string
	sessionsJSON string
	chatJSON     string
	timelineJSON string
	revokedJSON  string
	outboxDir    string
	perfJSON     string
	perfHistJSON string
	staticDir    string
	dbPath       string
	maxPlayers   int
	freshSec     float64
	sessionSec   int64
	allowOrigin  string
	alertWebhook string
	demo         bool

	timelineRetentionDays int
	codeRotateSec         int
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
func getenvInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
func getenvFloat(k string, def float64) float64 {
	if v := os.Getenv(k); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
	}
	return def
}
func getenvBool(k string, def bool) bool {
	if v := os.Getenv(k); v != "" {
		switch strings.ToLower(strings.TrimSpace(v)) {
		case "1", "true", "yes", "on":
			return true
		case "0", "false", "no", "off":
			return false
		}
	}
	return def
}

// 환경 변수 설명
// listen: 서버가 바인딩할 주소와 포트. 기본값은 루프백(127.0.0.1:8080)으로, 리버스 프록시나
//
//	터널(cloudflared) 뒤에서 쓰는 위협 모델을 그대로 반영합니다. 모든 인터페이스에서
//	받아야 하면 ":8080"처럼 호스트를 비워 명시적으로 설정하세요.

// 각종 JSON 파일 위치 지정

// statusJSON: 서버 상태를 기록하는 JSON 파일 경로 (예: "./data/status.json")
// recordsJSON: 서버 기록을 저장하는 JSON 파일 경로 (예: "./data/records.json")
// authJSON: 로그인 코드를 저장하는 JSON 파일 경로 (예: "./data/auth.json")
// sessionsJSON: 세션 정보를 저장하는 JSON 파일 경로 (예: "./data/sessions.json")
// chatJSON: 채팅 메시지를 저장하는 JSON 파일 경로 (예: "./data/chat.json")
// timelineJSON: 타임라인 이벤트를 저장하는 JSON 파일 경로 (예: "./data/timeline.json")
// revokedJSON: 취소된 세션 ID를 저장하는 JSON 파일 경로 (예: "./data/web_revoked.json")
// outboxDir: 웹에서 보낸 메시지를 임시로 저장하는 디렉토리 경로 (예: "./data/web_outbox")
// perfJSON: 성능 데이터를 저장하는 JSON 파일 경로 (예: "./data/perf.json")
// perfHistJSON: 성능 기록을 저장하는 JSON 파일 경로 (예: "./data/perf_history.json")

// staticDir: 정적 파일이 위치한 디렉토리 경로 (예: "./web/out") [Next.js로 빌드한 파일폴더]

// dbPath: 채팅·타임라인 SQLite DB 파일 경로 (예: "./data/panel.db"). WAL 부속 파일
//
//	(panel.db-wal, panel.db-shm)이 같은 디렉토리에 생깁니다.

// timelineRetentionDays: 타임라인 접속 이벤트 보존 일수 (기본 90일, DB에서 주기 정리)

// codeRotateSec: 6자리 로그인 코드 로테이션 주기(초). 기본 21600(6시간) — 봇의 기존
//
//	주기와 동일. 코드는 API가 auth.json에 기록하고 봇은 표시만 합니다.

// maxPlayers: 서버에 허용되는 최대 플레이어 수 (예: 20) [패널에 표시됩니다]

// freshSec: 서버 상태가 최신인지 판단하는 시간(초) (예: 21)

// sessionSec: 로그인된 유저의 세션 만료 시간(초) (예: 172800, 2일)

// allowOrigin: CORS 허용 도메인 (예: "https://example.com")

// alertWebhook: 인증 이상 징후(로그인 실패 급증·전역 리미터 포화)를 알릴 디스코드 웹훅 URL.
//
//	비워 두면 경보를 로그로만 남깁니다.

// demo: 데모 모드 활성화 여부 (예: true/false)
func loadConfig() config {
	br := getenv("PANEL_BRIDGE_DIR", "./data")
	mc := getenv("PANEL_MC_DATA_DIR", "./data")
	return config{
		listen:       getenv("PANEL_LISTEN", "127.0.0.1:8080"),
		statusJSON:   getenv("PANEL_STATUS_JSON", filepath.Join(mc, "status.json")),
		recordsJSON:  getenv("PANEL_RECORDS_JSON", filepath.Join(br, "records.json")),
		authJSON:     getenv("PANEL_AUTH_JSON", filepath.Join(br, "auth.json")),
		sessionsJSON: getenv("PANEL_SESSIONS_JSON", filepath.Join(br, "sessions.json")),
		chatJSON:     getenv("PANEL_CHAT_JSON", filepath.Join(br, "chat.json")),
		timelineJSON: getenv("PANEL_TIMELINE_JSON", filepath.Join(br, "timeline.json")),
		revokedJSON:  getenv("PANEL_REVOKED_JSON", filepath.Join(br, "web_revoked.json")),
		outboxDir:    getenv("PANEL_OUTBOX_DIR", filepath.Join(br, "web_outbox")),
		perfJSON:     getenv("PANEL_PERF_JSON", filepath.Join(mc, "perf.json")),
		perfHistJSON: getenv("PANEL_PERF_HISTORY_JSON", filepath.Join(mc, "perf_history.json")),
		staticDir:    getenv("PANEL_STATIC_DIR", "./web/out"),
		dbPath:       getenv("PANEL_DB", filepath.Join(br, "panel.db")),
		maxPlayers:   getenvInt("PANEL_MAX_PLAYERS", 20),
		freshSec:     getenvFloat("PANEL_FRESH_SEC", 21),
		sessionSec:   int64(getenvInt("PANEL_SESSION_SEC", 2*24*3600)),
		allowOrigin:  getenv("PANEL_ALLOW_ORIGIN", ""),
		alertWebhook: getenv("PANEL_ALERT_WEBHOOK", ""),
		demo:         getenvBool("PANEL_DEMO", false),

		timelineRetentionDays: getenvInt("PANEL_TIMELINE_RETENTION_DAYS", 90),
		codeRotateSec:         getenvInt("PANEL_CODE_ROTATE_SEC", 21600),
	}
}

// ------------------------------------------------------------------ 세션 스토어
type session struct {
	Exp      int64  `json:"exp"`
	Nickname string `json:"nickname"`
	Created  int64  `json:"created"`
}

type sessionStore struct {
	mu           sync.Mutex
	path         string
	revokedPath  string
	ttl          int64
	data         map[string]*session
	revoked      map[string]bool
	revokedMtime int64
}

// newSessionStore는 세션 스토어를 초기화합니다. path는 세션 정보를 저장할 JSON 파일 경로이고,
// revokedPath는 취소된 세션 ID를 저장할 JSON 파일 경로입니다. ttl은 세션 만료 시간(초)입니다.
func newSessionStore(path, revokedPath string, ttl int64) *sessionStore {
	s := &sessionStore{path: path, revokedPath: revokedPath, ttl: ttl,
		data: map[string]*session{}, revoked: map[string]bool{}}
	var raw map[string]*session
	if err := readJSON(path, &raw); err == nil && raw != nil {
		s.data = raw
	}
	return s
}

// persistLocked는 세션 정보를 sessions.json에 기록합니다. 반드시 s.mu를 잠근 상태에서 호출해야 합니다.
func (s *sessionStore) persistLocked() {
	tmp := s.path + ".tmp"
	b, _ := json.MarshalIndent(s.data, "", "  ")
	// 디스크 가득참·권한 문제 같은 IO 실패를 조용히 삼키면 재시작 후 세션이 증발한
	// 원인을 찾을 수 없으므로 로그를 남깁니다.
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		log.Printf("session persist failed (write): %v", err)
		return
	}
	if err := os.Rename(tmp, s.path); err != nil {
		log.Printf("session persist failed (rename): %v", err)
	}
}

// refreshRevokedLocked는 web_revoked.json 파일이 수정되었을 때에만 취소 목록을 다시 읽어 옵니다.
// 파일의 수정 시각(mtime)이 이전과 같으면 동작하지 않습니다.
func (s *sessionStore) refreshRevokedLocked() {
	fi, err := os.Stat(s.revokedPath)
	if err != nil {
		if len(s.revoked) > 0 {
			s.revoked = map[string]bool{}
			s.revokedMtime = 0
		}
		return
	}
	mt := fi.ModTime().UnixNano()
	if mt == s.revokedMtime {
		return
	}
	var list []string
	if err := readJSON(s.revokedPath, &list); err != nil {
		// 파싱 실패 시 기존 목록을 유지합니다 — 여기서 목록을 비우면 취소했던 세션이
		// 전부 되살아나므로, 파일 오류 하나로 보안 통제가 풀리지 않게 합니다.
		// mtime을 갱신하지 않아 다음 요청에서 다시 읽기를 시도합니다.
		log.Printf("revoked list read failed (keeping previous %d entries): %v", len(s.revoked), err)
		return
	}
	m := make(map[string]bool, len(list))
	for _, sid := range list {
		m[sid] = true
	}
	s.revoked = m
	s.revokedMtime = mt
}

// genSID는 세션 ID(sid)로 사용할 예측 불가능한 랜덤 토큰(32바이트)을 생성합니다.
// 생성된 토큰은 hex 문자열로 인코딩되어 반환됩니다.
func genSID() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err // 난수 생성 실패 시 오류 반환
	}
	return hex.EncodeToString(b), nil
}

// create는 새로운 세션을 생성하고, 그 세션 ID를 반환합니다. 세션은 ttl 초 후에 만료됩니다.
func (s *sessionStore) create() (string, error) {
	sid, err := genSID()
	if err != nil {
		return "", err
	}
	now := time.Now().Unix()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.purgeLocked(now)
	s.data[sid] = &session{Exp: now + s.ttl, Created: now}
	s.persistLocked()
	return sid, nil
}

// PurgeExpired는 만료된 세션들을 정리합니다. 백그라운드 정리 작업이 주기적으로 호출합니다
func (s *sessionStore) PurgeExpired() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.purgeLocked(time.Now().Unix())
}

// purgeLocked는 만료된 세션들을 정리합니다. 반드시 s.mu를 잠근 상태에서 호출해야 합니다.
func (s *sessionStore) purgeLocked(now int64) {
	changed := false
	for sid, v := range s.data {
		if now >= v.Exp {
			delete(s.data, sid)
			changed = true
		}
	}
	if changed {
		s.persistLocked()
	}
}

// get은 클라이언트가 보낸 sid가 유효한지 검증합니다. 만약 만료되었거나 취소된 세션이면 false를 반환합니다.
func (s *sessionStore) get(sid string) (session, bool) {
	if sid == "" {
		return session{}, false
	}
	now := time.Now().Unix()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.refreshRevokedLocked()
	v, ok := s.data[sid]
	if !ok {
		return session{}, false
	}
	if now >= v.Exp || s.revoked[sid] {
		delete(s.data, sid)
		s.persistLocked()
		return session{}, false
	}
	return *v, true
}

// setNickname은 로그인 후, 닉네임을 설정합니다. 중복 닉네임은 거부합니다
func (s *sessionStore) setNickname(sid, nick string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.data[sid]
	if !ok {
		return errors.New("no_session")
	}
	// 닉네임 중복 체크
	now := time.Now().Unix()
	for other, ov := range s.data {
		if other != sid && now < ov.Exp && ov.Nickname == nick {
			return errors.New("taken")
		}
	}
	v.Nickname = nick
	s.persistLocked()
	return nil
}

// sessionInfo는 내부 API로 노출하는 세션 요약입니다. sid는 앞 8자만 담습니다.
type sessionInfo struct {
	SidPrefix string `json:"sid_prefix"`
	Nickname  string `json:"nickname"`
	Created   int64  `json:"created"`
	Exp       int64  `json:"exp"`
}

// list는 활성 세션 목록을 생성 시각 순으로 돌려줍니다.
func (s *sessionStore) list() []sessionInfo {
	now := time.Now().Unix()
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []sessionInfo{}
	for sid, v := range s.data {
		if now >= v.Exp {
			continue
		}
		p := sid
		if len(p) > 8 {
			p = p[:8]
		}
		out = append(out, sessionInfo{SidPrefix: p, Nickname: v.Nickname, Created: v.Created, Exp: v.Exp})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Created < out[j].Created })
	return out
}

// revokeByNickname은 닉네임이 일치하는 세션을 모두 삭제하고 삭제 수를 돌려줍니다.
func (s *sessionStore) revokeByNickname(nick string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for sid, v := range s.data {
		if v.Nickname == nick {
			delete(s.data, sid)
			n++
		}
	}
	if n > 0 {
		s.persistLocked()
	}
	return n
}

// remove는 세션을 삭제합니다. 로그아웃 시에도 호출됩니다.
func (s *sessionStore) remove(sid string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.data[sid]; ok {
		delete(s.data, sid)
		s.persistLocked()
	}
}

// ------------------------------------------------------------------ 레이트 리밋
type rateLimiter struct {
	mu     sync.Mutex
	hits   map[string][]int64
	window int64
	max    int
}

// newRateLimiter는 인증코드의 시도 횟수를 제한합니다. (IP별로 적용)
func newRateLimiter(windowSec int64, max int) *rateLimiter {
	return &rateLimiter{hits: map[string][]int64{}, window: windowSec, max: max}
}
func (rl *rateLimiter) allow(key string) bool {
	now := time.Now().Unix()
	rl.mu.Lock()
	defer rl.mu.Unlock()
	cut := now - rl.window
	kept := rl.hits[key][:0]
	for _, t := range rl.hits[key] {
		if t > cut {
			kept = append(kept, t)
		}
	}
	if len(kept) >= rl.max {
		rl.hits[key] = kept
		return false
	}
	rl.hits[key] = append(kept, now)
	return true
}

// sweep는 기록이 전부 만료되어 비어 버린 키를 맵에서 지웁니다.
// 이렇게 청소해 주지 않으면 맵이 계속 커지기만 합니다.
func (rl *rateLimiter) sweep() {
	now := time.Now().Unix()
	rl.mu.Lock()
	defer rl.mu.Unlock()
	for k, ts := range rl.hits {
		cut := now - rl.window
		fresh := ts[:0]
		for _, t := range ts {
			if t > cut {
				fresh = append(fresh, t)
			}
		}
		if len(fresh) == 0 {
			delete(rl.hits, k)
		} else {
			rl.hits[k] = fresh
		}
	}
}

// clientIP는 클라이언트의 IP 주소를 반환합니다. (보안 상, 로컬에서 들어오는 요청만 포워딩 헤더를 신뢰합니다)
func clientIP(r *http.Request) string {
	host := r.RemoteAddr
	if c := strings.LastIndexByte(host, ':'); c >= 0 {
		host = host[:c]
	}
	host = strings.Trim(host, "[]")
	// 포워딩 헤더(CF-Connecting-IP, X-Forwarded-For)는 요청이 실제로 로컬 Cloudflare 터널,
	//즉 루프백에서 도는 cloudflared를 거쳐 들어왔을 때에만 믿습니다. 리스너가 127.0.0.1에만
	// 묶여 있어서, 직접 접속하는 클라이언트는 이 헤더들을 위조해도 통하지 않습니다.
	if host == "127.0.0.1" || host == "::1" {
		if ip := r.Header.Get("CF-Connecting-IP"); ip != "" {
			return ip
		}
		if ip := r.Header.Get("X-Forwarded-For"); ip != "" {
			if c := strings.IndexByte(ip, ','); c >= 0 {
				return strings.TrimSpace(ip[:c])
			}
			return strings.TrimSpace(ip)
		}
	}
	return host
}

// sanitizeText는 사용자가 입력한 텍스트에서 위험하거나 지저분한 문자를 걷어 냅니다.
// 제어 문자, 마인크래프트 섹션 기호(§ — 색상·서식·난독화 코드나 다른 사람 사칭에 악용됩니다),
// 줄바꿈, 그리고 앞뒤 공백을 없앱니다. 이 텍스트는 봇의 tellraw를 거쳐 실제 게임 화면에 표시되므로,
// 게임에 닿기 전에 한 번 더 걸러 두는 안전장치입니다.
func sanitizeText(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r == '\n' || r == '\r' || r == '\t':
			b.WriteByte(' ')
		case r < 0x20, r == 0x7f, r >= 0x80 && r <= 0x9f: // C0/C1 제어 문자
			// 버리고 넘어갑니다
		case r == 0x00a7: // § 섹션 기호
			// 버리고 넘어갑니다
		default:
			b.WriteRune(r)
		}
	}
	return strings.TrimSpace(b.String())
}

// ------------------------------------------------------------------ 데이터 리더
func readJSON(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

// ------------------------------------------------------------------ 데이터 구조체

// playr - 서버에 접속한 플레이어 정보를 나타냅니다.
type player struct {
	Name string  `json:"name"`
	UUID string  `json:"uuid"`
	Ping float64 `json:"ping"`
}

// statusFile - 서버 상태의 요약정보용 (status.json)
type statusFile struct {
	TS      float64  `json:"ts"`
	Count   int      `json:"count"`
	TPS     float64  `json:"tps"`
	Mspt    float64  `json:"mspt"`
	Players []player `json:"players"`
}

type recordsFile struct {
	MaxConcurrent int `json:"max_concurrent"`
}

type authFile struct {
	Code string `json:"code"`
}

// 채팅 메시지 구조체 정의
type chatMsg struct {
	ID     int64  `json:"id"`
	TS     int64  `json:"ts"`
	Source string `json:"source"`
	User   string `json:"user"`
	UUID   string `json:"uuid"`
	Text   string `json:"text"`
}

// timelineEntry는 타임라인 탭에 표시할 접속 이벤트를 나타냅니다. (join/leave)
type timelineEntry struct {
	ID      int64  `json:"id"`
	Ts      int64  `json:"ts"`     // UTC 기준 타임스탬프
	TsKst   string `json:"ts_kst"` // KST 기준 타임스탬프 (YYYY-MM-DD HH:MM:SS)
	UUID    string `json:"uuid"`
	Name    string `json:"name"`
	Event   string `json:"event"`    // "join" 또는 "leave"
	IsFirst bool   `json:"is_first"` // 첫 방문 여부 (true = 첫 방문, false = 재방문)
}

// ------------------------------------------------------------------ 서버

// 마인크래프트 서버 성능 측정값 정의
type perfHistEntry struct {
	Ts     int64   `json:"ts"`
	Tps    float64 `json:"tps"`
	Mspt   float64 `json:"mspt"`
	P95    float64 `json:"p95"`
	Count  int     `json:"count"`
	Spikes int     `json:"spikes"`
}

type server struct {
	cfg           config
	sessions      *sessionStore   // 세션 스토어
	loginRL       *rateLimiter    // IP별 로그인 시도 횟수를 셉니다
	loginGlobalRL *rateLimiter    // 서버 전체 로그인 상한 — IP를 변경하여 시도하는 공격을 막습니다.
	chatRL        *rateLimiter    // IP별 채팅 전송 시도 횟수를 셉니다
	alert         *alerter        // 인증 이상 징후를 로그·디스코드 웹훅으로 알립니다
	store         *store          // 채팅·타임라인 SQLite 저장소 (데모 모드에서는 nil)
	perfMu        sync.Mutex      // perf.json을 읽고 쓰는동안 동시 접근을 막습니다
	perfHist      []perfHistEntry // perf.json에서 주기적으로 뽑아 둔 최근 성능 기록(롤링 히스토리)입니다
}

// writeJSON을 http 응답으로 내보내기 위한 코드
func (s *server) writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

// cors 설정
func (s *server) cors(w http.ResponseWriter, r *http.Request) bool {
	if s.cfg.allowOrigin == "" {
		return false
	}
	w.Header().Set("Access-Control-Allow-Origin", s.cfg.allowOrigin)
	w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return true
	}
	return false
}

// 유저의 세션 검증을 위한, Authorization 헤더에서 bearer 토큰 추출
func bearerOf(r *http.Request) string {
	h := r.Header.Get("Authorization")
	const p = "Bearer "
	if strings.HasPrefix(h, p) {
		return strings.TrimSpace(h[len(p):])
	}
	return ""
}

// bearer 토큰의 sid 값을 서버의 세션파일에서 검증하는 하는 코드
func (s *server) auth(w http.ResponseWriter, r *http.Request) (string, session, bool) {
	sid := bearerOf(r)
	sess, ok := s.sessions.get(sid)
	// 세션이 없거나 만료되었거나 취소된 경우 - 권한없음
	if !ok {
		s.writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return "", session{}, false
	}
	return sid, sess, true
}

// api는 모든 API 핸들러가 공유하는 공통 체인입니다: CORS 프리플라이트 → 메서드 검증 → 핸들러.
// 개별 핸들러마다 같은 검사를 반복하다 일부에서 누락되는 일이 있어 한 곳으로 모았습니다.
// 허용되지 않은 메서드는 Allow 헤더와 함께 405로 통일해 응답합니다.
func (s *server) api(methods string, h http.HandlerFunc) http.HandlerFunc {
	allowed := map[string]bool{}
	for _, m := range strings.Split(methods, ",") {
		allowed[strings.TrimSpace(m)] = true
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if s.cors(w, r) {
			return
		}
		if !allowed[r.Method] {
			w.Header().Set("Allow", strings.ReplaceAll(methods, ",", ", "))
			s.writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method"})
			return
		}
		h(w, r)
	}
}

// apiAuthed는 api 체인에 세션 검증을 더한 것입니다. 검증에 성공하면 sid와 세션을 핸들러에 넘깁니다.
func (s *server) apiAuthed(methods string, h func(w http.ResponseWriter, r *http.Request, sid string, sess session)) http.HandlerFunc {
	return s.api(methods, func(w http.ResponseWriter, r *http.Request) {
		sid, sess, ok := s.auth(w, r)
		if !ok {
			return
		}
		h(w, r, sid, sess)
	})
}

// 로그인 요청을 처리하는 함수 (공통 체인: s.api("POST"))
func (s *server) handleLogin(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	// IP별 로그인 시도 횟수 제한 및 서버 전체 로그인 시도 제한
	// (전역 리미터 포화는 IP를 바꿔 가며 시도하는 공격 신호라 경보 범위를 구분합니다)
	if !s.loginRL.allow(ip) {
		s.alert.rateLimited("ip", ip)
		s.writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "too_many_attempts"})
		return
	}
	if !s.loginGlobalRL.allow("global") {
		s.alert.rateLimited("global", ip)
		s.writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "too_many_attempts"})
		return
	}
	var body struct {
		Code string `json:"code"`
	}
	// 요청이 JSON 형식인지 검증 - 오류=응답없음
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&body); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "error"})
		return
	}
	code := strings.TrimSpace(body.Code)

	// 로그인 코드 검증 (auth.json)

	// 데모 모드라면 데모용 코드와 비교,
	// 아니면 auth.json에 저장된 코드와 비교
	if s.cfg.demo {
		// 데모 모드에서는 코드를 갱신해 줄 봇이 없으므로, 미리 정해 둔 데모용 코드를 그대로 받아들입니다.
		if subtleNE(code, demoLoginCode) {
			s.alert.loginFail(ip)
			s.writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_code"})
			return
		}
	} else {
		var af authFile
		if err := readJSON(s.cfg.authJSON, &af); err != nil || af.Code == "" {
			log.Printf("login unavailable (auth code missing) for %s", ip)
			s.writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "no_active_code"})
			return
		}
		if len(code) != len(af.Code) || subtleNE(code, af.Code) {
			s.alert.loginFail(ip)
			s.writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_code"})
			return
		}
	}
	sid, err := s.sessions.create()

	// 세션 생성에 실패하면 서버 오류로 응답
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	log.Printf("login ok from %s", ip)
	s.writeJSON(w, http.StatusOK, map[string]any{"token": sid})
}

// ------------------------------------------------------------------ API 핸들러

// 응답속도 추정으로 로그인 코드를 알아내는 공격 방지용 코드

// subtleNE는 두 문자열 a와 b가 서로 다른지를 비교합니다. 걸리는 시간이 내용에 따라 달라지지 않도록
// 항상 일정한 시간(상수 시간)으로 처리해서, 응답 속도를 재어 코드를 알아내는 타이밍 공격을 막습니다.
func subtleNE(a, b string) bool {
	if len(a) != len(b) {
		return true
	}
	var v byte
	for i := 0; i < len(a); i++ {
		v |= a[i] ^ b[i]
	}
	return v != 0
}

// handleLogout - 로그아웃 처리 (공통 체인: s.api("POST"))
func (s *server) handleLogout(w http.ResponseWriter, r *http.Request) {
	// bearer 토큰에서 세션sid를 가져오고, 해당 sid를 세션파일에서 제거 (로그아웃은 세션을 취소합니다. 유지x)
	if sid := bearerOf(r); sid != "" {
		s.sessions.remove(sid)
	}
	s.writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleMe - sid를 조회하여, 해당하는 sid의 닉네임을 반환 (공통 체인: s.apiAuthed("GET"))
func (s *server) handleMe(w http.ResponseWriter, r *http.Request, _ string, sess session) {
	s.writeJSON(w, http.StatusOK, map[string]any{"nickname": sess.Nickname})
}

// handleNickname - 닉네임 설정 처리 (공통 체인: s.apiAuthed("POST"))
func (s *server) handleNickname(w http.ResponseWriter, r *http.Request, sid string, _ session) {
	var body struct {
		Nickname string `json:"nickname"`
	}
	// 요청이 JSON 형식인지 검증
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&body); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "error"})
		return
	}
	// 닉네임 길이 검증 (2~16자)
	nick := sanitizeText(body.Nickname)
	n := len([]rune(nick))
	if n < 2 || n > 16 {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "error"})
		return
	}
	// 닉네임 중복 체크 및 세션에 닉네임 저장
	if err := s.sessions.setNickname(sid, nick); err != nil {
		if err.Error() == "taken" {
			s.writeJSON(w, http.StatusConflict, map[string]string{"error": "nickname_taken"})
			return
		}
		// 세션이 없거나 만료되었거나 취소된 경우
		s.writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"nickname": nick})
}

// handleStatus - 서버 상태를 브라우저에 반환 (공통 체인: s.apiAuthed("GET"))
func (s *server) handleStatus(w http.ResponseWriter, r *http.Request, _ string, _ session) {
	var st statusFile
	var rec recordsFile
	// 데모 모드라면 데모 데이터 반환,
	// 아니라면 status.json과 records.json을 읽어 반환
	if s.cfg.demo {
		st, rec = demoStatus(), demoRecords()
	} else {
		_ = readJSON(s.cfg.statusJSON, &st)
		_ = readJSON(s.cfg.recordsJSON, &rec)
	}

	// 서버의 상태가 최신인지 판단 (freshSec 초 이내에 업데이트된 경우)
	nowMs := float64(time.Now().UnixMilli())
	serverUp := st.TS > 0 && (nowMs-st.TS) < s.cfg.freshSec*1000

	// 서버 상태를 JSON으로 반환
	resp := map[string]any{
		"server_up":      serverUp,          // 서버 온라인, 오프라인 여부
		"max":            s.cfg.maxPlayers,  // config에서 설정한 최대 플레이어 수(패널 표시전용 값)
		"max_concurrent": rec.MaxConcurrent, // records.json에서 읽은 역대 최대 동시 접속자 수
		"updated_ts":     int64(st.TS),      // status.json에서 읽은 마지막 업데이트 시각(UTC 기준)
	}
	// 서버가 켜져 있으면 플레이어 정보와 TPS, MSPT 등을 반환
	if serverUp {
		players := st.Players
		// 플레이어 정보가 없으면 빈 배열로 초기화
		if players == nil {
			players = []player{}
		}
		resp["count"] = st.Count  // 접속자 수
		resp["tps"] = st.TPS      // 서버의 TPS 값
		resp["mspt"] = st.Mspt    // 서버의 MSPT 값
		resp["players"] = players // 접속한 플레이어 정보(이름, UUID, 핑)
	} else {
		// 서버가 꺼져 있으면 플레이어 정보와 TPS, MSPT 등을 -1로 반환
		resp["count"] = 0
		resp["tps"] = -1
		resp["mspt"] = -1
		resp["players"] = []player{}
	}
	s.writeJSON(w, http.StatusOK, resp)
}

// handlePerf - 서버 성능(perf.json)과 최근 기록을 브라우저에 반환
// 데이터 목록 : tps, mspt, p95, count, spikes
// 서버의 kubejs 모드에서 플레이어가 1명 이상일때만 데이터값을 제공 받습니다.
// (공통 체인: s.apiAuthed("GET"))
func (s *server) handlePerf(w http.ResponseWriter, r *http.Request, _ string, _ session) {
	var cur map[string]any
	// 데모 모드라면 데모용 샘플 데이터를 가져오고,
	// 아니라면 perf.json을 읽어 옵니다. (KubeJS가 기록한 값)
	if s.cfg.demo {
		cur = demoPerfCurrent()
	} else {
		_ = readJSON(s.cfg.perfJSON, &cur)
	}
	// perf.json이 존재하지 않거나 오래된 경우, tracking=false로 응답합니다.
	tracking := false
	if cur != nil {
		if tsv, ok := cur["ts"].(float64); ok {
			tracking = (float64(time.Now().UnixMilli()) - tsv) < 6000
		}
	}
	// kubeJS가 기록을 시작하지 않은 경우, 데이터 없음으로 처리 (서버 문제혹은 유저가 0명일때)
	if !tracking {
		cur = nil
	}
	s.perfMu.Lock()
	hist := make([]perfHistEntry, len(s.perfHist))
	copy(hist, s.perfHist)
	s.perfMu.Unlock()
	s.writeJSON(w, http.StatusOK, map[string]any{"tracking": tracking, "current": cur, "history": hist})
}

// perfSampler - 서버 성능(perf.json)을 주기적으로 읽어, 최근 기록을 s.perfHist에 저장합니다. (1.5초 간격)
func (s *server) perfSampler() {
	// time.NewTicker는 코드 실행 시간과 무관하게 벽시계 기준으로 정확히 1.5초마다 발화합니다.
	// (time.Sleep과 달리 실행 시간이 누적되지 않습니다.)
	t := time.NewTicker(1500 * time.Millisecond)
	defer t.Stop()
	for range t.C {
		// 처리가 1.5초를 초과했을 때 채널에 쌓인 틱을 버려 연속 실행을 방지합니다
		for len(t.C) > 0 {
			<-t.C
		}
		var cur map[string]any
		// 데모 모드는 샘플 데이터를 가져오고,
		// 아니라면 perf.json을 읽어 옵니다.
		if s.cfg.demo {
			cur = demoPerfCurrent()
		} else if readJSON(s.cfg.perfJSON, &cur) != nil || cur == nil {
			continue
		}
		// perf.json이 존재하지 않거나 오래된 경우, 기록을 갱신하지 않습니다.
		tsv, _ := cur["ts"].(float64)
		if tsv == 0 || float64(time.Now().UnixMilli())-tsv >= 6000 {
			continue // 데이터가 오래됨 — 플레이어가 없는 유휴 상태이므로 건너뜁니다
		}
		e := perfHistEntry{Ts: int64(tsv)}
		e.Tps, _ = cur["tps"].(float64)
		e.Mspt, _ = cur["mspt"].(float64)
		// P95값이 0이상이면 그대로 사용, 0 미만 소수라면 period_p95 사용
		if p95, _ := cur["mspt_p95"].(float64); p95 >= 0 {
			e.P95 = p95
		} else {
			e.P95, _ = cur["period_p95"].(float64)
		}
		// count와 spikes_100은 float64로 읽어온 뒤 int로 변환합니다.
		if v, ok := cur["count"].(float64); ok {
			e.Count = int(v)
		}
		// spikes_100은 100ms 이상 걸린 스파이크 횟수입니다. (TPS=10 이하로 떨어진 횟수)
		if v, ok := cur["spikes_100"].(float64); ok {
			e.Spikes = int(v)
		}
		// 최근 기록에 추가합니다. 단, 같은 타임스탬프는 중복 저장하지 않습니다.
		s.perfMu.Lock()
		if n := len(s.perfHist); n == 0 || s.perfHist[n-1].Ts != e.Ts {
			s.perfHist = append(s.perfHist, e)
			if len(s.perfHist) > 480 { // 1.5초 간격으로 대략 12분 분량입니다
				s.perfHist = s.perfHist[len(s.perfHist)-480:]
			}
		}
		s.perfMu.Unlock()
	}
}

// handleTimeline - 타임라인 탭에 표시할 접속 이벤트를 브라우저에 반환 (공통 체인: s.apiAuthed("GET"))
func (s *server) handleTimeline(w http.ResponseWriter, r *http.Request, _ string, _ session) {
	// 데모 모드에서는 샘플 데이터 값을 불러오고, 아니라면 SQLite에서 조회합니다.
	var events []timelineEntry
	if s.cfg.demo {
		events = demoTimeline()
	} else {
		var err error
		events, err = s.store.timelineEvents()
		if err != nil {
			log.Printf("timeline query failed: %v", err)
			s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server_error"})
			return
		}
	}
	if events == nil {
		events = []timelineEntry{}
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"events": events})
}

// handleChat - 채팅 메시지를 브라우저에 반환하거나, 새 메시지를 받아 outbox에 저장
// (공통 체인: s.apiAuthed("GET,POST"))
func (s *server) handleChat(w http.ResponseWriter, r *http.Request, sid string, sess session) {
	// GET 요청이면 since 이후의 메시지를 반환, POST 요청이면 새 메시지를 받아 outbox에 저장
	switch r.Method {
	case http.MethodGet:
		since, _ := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
		// 데모 모드는 in-memory 시드 스토어에서 필터링합니다.
		if s.cfg.demo {
			all := demoChat()
			out := make([]chatMsg, 0, len(all))
			var last int64 = since
			for _, m := range all {
				if m.ID > since {
					out = append(out, m)
				}
				if m.ID > last {
					last = m.ID
				}
			}
			sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
			s.writeJSON(w, http.StatusOK, map[string]any{"messages": out, "last_id": last})
			return
		}
		// SQLite에서 since 이후 최신 200개를 조회합니다 (기존 chat.json 롤링 버퍼와 같은 창 크기)
		out, last, err := s.store.chatSince(since, 200)
		if err != nil {
			log.Printf("chat query failed: %v", err)
			s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server_error"})
			return
		}
		s.writeJSON(w, http.StatusOK, map[string]any{"messages": out, "last_id": last})
	// POST 요청이면 새 메시지를 받아 outbox에 저장
	case http.MethodPost:
		// 닉네임이 없는 세션은 메시지를 보낼 수 없습니다. (닉네임 설정 후에만 채팅 가능)
		if sess.Nickname == "" {
			s.writeJSON(w, http.StatusConflict, map[string]string{"error": "no_nickname"})
			return
		}
		// IP별 채팅 전송 시도 횟수 제한 (하단의 rateLimiter 구조체에서 config 할수있음)
		if !s.chatRL.allow(sid) {
			s.writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "slow_down"})
			return
		}
		// 요청이 JSON 형식인지 검증
		var body struct {
			Text string `json:"text"`
		}
		// 요청 본문이 4KB를 초과하면 오류로 처리합니다.
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body); err != nil {
			s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "error"})
			return
		}
		// 채팅 메시지로 사용할 수 없는 문자를 제거하여 코드주입 공격을 방지합니다. +채팅의 길이를 256자로 제한합니다.
		text := sanitizeText(body.Text)
		if text == "" {
			s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "error"})
			return
		}
		// 채팅 메시지 길이 제한 (256자)
		if len([]rune(text)) > 256 {
			text = string([]rune(text)[:256])
		}

		// 데모 모드에서는 in-memory 데모 스토어에 바로 반영해 보낸 메시지가 피드에 나타나게 합니다.
		if s.cfg.demo {
			demoChatAppend(sess.Nickname, text)
			s.writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
			return
		}
		// 웹 중심 구조: 저장은 API가 직접 처리해 피드에 즉시 반영되고, 게임·디스코드
		// 전달만 봇이 outbox를 소비해 처리합니다(순수 브리지). 봇이 없어도 웹 채팅은
		// 독립적으로 동작합니다.
		ts := time.Now().UnixMilli()
		id, err := s.store.insertChatAuto(ts, "web", "", sess.Nickname, text)
		if err != nil {
			log.Printf("chat insert failed: %v", err)
			s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server_error"})
			return
		}
		if err := s.enqueueOutbox(sess.Nickname, text); err != nil {
			// 저장은 성공했으므로 실패해도 게임·디스코드 전달만 지연됩니다 — 로그만 남깁니다
			log.Printf("outbox enqueue failed (message %d saved): %v", id, err)
		}
		s.writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": id, "ts": ts})
	}
}

// enqueueOutbox - outbox 디렉토리에 새 채팅 메시지를 저장합니다. (디텍토리의 데이터를 봇이 읽어 마인크래프트 서버에 전송)
func (s *server) enqueueOutbox(nick, text string) error {
	// outbox 디렉토리가 없으면 생성합니다. (권한 0700)
	if err := os.MkdirAll(s.cfg.outboxDir, 0o700); err != nil {
		return err
	}
	// 봇이 멈췄거나 처리가 밀리면 요청을 더 받지 않고 떨궈서, inode나 디스크가 바닥나는 것을 막습니다
	if entries, err := os.ReadDir(s.cfg.outboxDir); err == nil && len(entries) > 500 {
		// backlog에 에러 메시지 기록
		return errors.New("backlog")
	}
	// 메시지 파일 이름은 타임스탬프와 랜덤 6바이트를 조합하여 생성합니다. (예: 1672531200000-abcdef123456.json)
	now := time.Now()
	rb := make([]byte, 6)
	if _, err := rand.Read(rb); err != nil {
		return err
	}
	name := fmt.Sprintf("%013d-%s.json", now.UnixMilli(), hex.EncodeToString(rb))

	// 마인크래프트 서버에 메시지를 전송하기 위해서, nick, text, ts를 json으로 저장하여 outbox 디렉토리에 기록합니다. (권한 0600)
	payload, _ := json.Marshal(map[string]any{
		"nickname": nick, "text": text, "ts": now.UnixMilli(),
	})
	tmp := filepath.Join(s.cfg.outboxDir, "."+name)
	final := filepath.Join(s.cfg.outboxDir, name)
	if err := os.WriteFile(tmp, payload, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, final) // 이름을 한 번에 바꿔 원자적으로 공개합니다 — 봇이 쓰다 만 파일을 읽지 않도록
}

// static - 정적 파일을 제공하는 핸들러입니다. (사이트 호스팅) (Next.js 빌드 결과물)
func (s *server) static(w http.ResponseWriter, r *http.Request) {
	clean := filepath.Clean(r.URL.Path)
	if strings.Contains(clean, "..") {
		http.NotFound(w, r)
		return
	}
	full := filepath.Join(s.cfg.staticDir, clean)

	if fi, err := os.Stat(full); err == nil && !fi.IsDir() {
		if strings.HasSuffix(clean, ".webmanifest") {
			w.Header().Set("Content-Type", "application/manifest+json; charset=utf-8")
		}
		http.ServeFile(w, r, full)
		return
	}
	if clean != "/" {
		if fi, err := os.Stat(full + ".html"); err == nil && !fi.IsDir() {
			http.ServeFile(w, r, full+".html")
			return
		}
	}
	idx := filepath.Join(s.cfg.staticDir, "index.html")
	if _, err := os.Stat(idx); err != nil {
		http.Error(w, "service unavailable", http.StatusServiceUnavailable)
		return
	}
	http.ServeFile(w, r, idx)
}

// securityHeaders - 보안 헤더를 설정하는 미들웨어입니다. (XSS, Clickjacking, Content Sniffing 방지)
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
		// 패널은 카메라·마이크·위치를 쓰지 않으므로 브라우저 기능 접근을 명시적으로 차단합니다.
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		// API 응답에는 세션 상태·채팅이 담기므로 브라우저·중간 캐시에 남지 않게 합니다.
		if strings.HasPrefix(r.URL.Path, "/api/") {
			h.Set("Cache-Control", "no-store")
		}
		// Next.js 정적 빌드 결과물은 작은 인라인 부트스트랩·테마 스크립트와 인라인 스타일을 쓰기 때문에,
		// script와 style에는 'unsafe-inline'을 허용해야 합니다. 그 밖의 출처는 모두 막아 둡니다.
		h.Set("Content-Security-Policy",
			"default-src 'self'; img-src 'self' https://mc-heads.net data:; "+ // mc-heads.net는 플레이어 스킨·두상 이미지를 가져오는 곳입니다. data:는 favicon.ico를 위해 허용합니다.
				"style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; "+
				"connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'")
		next.ServeHTTP(w, r)
	})
}

// ------------------------------------------------------------------ main
func main() {
	cfg := loadConfig()
	s := &server{
		cfg:           cfg,
		sessions:      newSessionStore(cfg.sessionsJSON, cfg.revokedJSON, cfg.sessionSec),
		loginRL:       newRateLimiter(600, 10),  // IP 하나당 600초(10분)에 로그인 10번까지
		loginGlobalRL: newRateLimiter(600, 120), // 서버 전체로는 600초(10분)에 로그인 120번까지
		chatRL:        newRateLimiter(5, 3),     // 세션 하나당 5초에 메시지 3개까지
		alert:         newAlerter(cfg.alertWebhook),
	}

	// 데모 모드가 아니면 SQLite 저장소를 열고 봇 파일 임포터를 시작합니다.
	// (데모 모드는 in-memory 샘플 데이터만 쓰므로 DB가 필요 없습니다)
	stopImporter := make(chan struct{})
	if !cfg.demo {
		st, err := openStore(cfg.dbPath)
		if err != nil {
			log.Fatalf("db open failed (%s): %v", cfg.dbPath, err)
		}
		s.store = st
		defer func() { _ = st.close() }()
		go s.runImporter(stopImporter)
		go s.runCodeRotator(stopImporter) // 로그인 코드 생성·로테이션 (auth.json의 단일 작성자)
	}

	go s.perfSampler() // 패널 차트에 쓸 실시간 성능 기록을 백그라운드에서 모읍니다

	// ----------------------------------------------------------------- 헬스 체크 리스너
	// /healthz 경로에 GET 요청을 보내면 200 OK를 반환하는 헬스 체크용 리스너를 별도로 띄웁니다.
	// uptimerobot 사용중.
	go func() {
		hmux := http.NewServeMux()
		hmux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("ok\n"))
		})
		// 내부 API(봇 전용) — 루프백 리스너에만 등록합니다. internal.go 참고.
		hmux.HandleFunc("/internal/ingest", s.handleInternalIngest)
		hmux.HandleFunc("/internal/sessions", s.handleInternalSessions)
		hmux.HandleFunc("/internal/revoke", s.handleInternalRevoke)
		hsrv := &http.Server{
			Addr:              getenv("PANEL_HEALTH_LISTEN", "127.0.0.1:8099"),
			Handler:           hmux,
			ReadHeaderTimeout: 5 * time.Second,  // 요청 헤더를 읽는 시간 제한
			ReadTimeout:       10 * time.Second, // 요청 본문을 읽는 시간 제한
			WriteTimeout:      10 * time.Second, // 응답을 쓰는 시간 제한
			IdleTimeout:       30 * time.Second, // 유휴 연결의 시간 제한
			MaxHeaderBytes:    1 << 14,          // 최대 헤더 크기 16KB
		}
		// 헬스 체크 리스너를 시작하고, 오류가 발생하면 로그에 기록합니다. (http.ErrServerClosed는 정상 종료이므로 무시)
		log.Printf("mc_sv-panel health listener on %s (/healthz)", hsrv.Addr)
		if err := hsrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("health listener stopped: %v", err)
		}
	}()

	// 백그라운드 정리 작업입니다. 만료된 세션을 지우고, 오래된 레이트 리밋 기록도 함께 청소합니다
	go func() {
		t := time.NewTicker(5 * time.Minute) // 5분마다 정리 작업
		defer t.Stop()
		for range t.C {
			s.sessions.PurgeExpired() // 만료된 세션 제거
			s.loginRL.sweep()         // 오래된 레이트 리밋 기록 제거
			s.loginGlobalRL.sweep()   // 오래된 레이트 리밋 기록 제거
			s.chatRL.sweep()          // 오래된 레이트 리밋 기록 제거
		}
	}()

	// ----------------------------------------------------------------- 메인 리스너 (경로 등록)
	mux := http.NewServeMux()
	mux.HandleFunc("/api/login", s.api("POST", s.handleLogin))
	mux.HandleFunc("/api/logout", s.api("POST", s.handleLogout))
	mux.HandleFunc("/api/me", s.apiAuthed("GET", s.handleMe))
	mux.HandleFunc("/api/nickname", s.apiAuthed("POST", s.handleNickname))
	mux.HandleFunc("/api/status", s.apiAuthed("GET", s.handleStatus))
	mux.HandleFunc("/api/perf", s.apiAuthed("GET", s.handlePerf))
	mux.HandleFunc("/api/chat", s.apiAuthed("GET,POST", s.handleChat))
	mux.HandleFunc("/api/timeline", s.apiAuthed("GET", s.handleTimeline))
	mux.HandleFunc("/", s.static)

	// ----------------------------------------------------------------- 서버 시작
	srv := &http.Server{
		Addr:              cfg.listen,           // 서버가 바인딩할 주소와 포트
		Handler:           securityHeaders(mux), // 보안 헤더를 설정하는 미들웨어를 적용합니다
		ReadHeaderTimeout: 10 * time.Second,     // 요청 헤더를 읽는 시간 제한
		ReadTimeout:       20 * time.Second,     // 요청 본문을 읽는 시간 제한
		WriteTimeout:      30 * time.Second,     // 응답을 쓰는 시간 제한
		IdleTimeout:       60 * time.Second,     // 유휴 연결의 시간 제한
		MaxHeaderBytes:    1 << 16,              // 최대 헤더 크기 64KB
	}
	// 데모 모드에서는 브리지 파일을 무시하고 샘플 데이터를 제공합니다. (로그인 코드 demoLoginCode)
	if cfg.demo {
		log.Printf("mc_sv-panel DEMO MODE — bridge files ignored, sample data served (login code %q)", demoLoginCode)
	}
	// 종료 시그널(SIGINT/SIGTERM)을 받으면 진행 중인 요청을 마무리하고 내려갑니다 —
	// systemd 재시작 시 세션 저장 같은 쓰기 도중 프로세스가 끊기지 않도록.
	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
		<-sig
		log.Printf("shutdown signal received — draining connections")
		close(stopImporter) // DB를 닫기 전에 임포터부터 멈춥니다
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}()

	// 메인 리스너를 시작하고, 오류가 발생하면 로그에 기록합니다. (http.ErrServerClosed는 정상 종료이므로 무시)
	log.Printf("mc_sv-panel listening on %s (static=%s)", cfg.listen, cfg.staticDir)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
	log.Printf("mc_sv-panel shutdown complete")
}
