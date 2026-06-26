// mc_sv-panel API + 정적 파일 서버.
//
// 단일 Go 바이너리로 다음을 모두 수행한다:
//   - 정적 익스포트된 Next.js 패널(web/out)을 "/"에서 서빙
//   - /api/login, /api/logout, /api/me, /api/nickname, /api/status, /api/chat 제공
//
// 인증 모델(서버 측 세션, 취소 가능):
//
//	POST /api/login {code} — 봇이 주기적으로 갱신하는 6자리 코드(auth.json)와 비교하고,
//	일치하면 sessions.json에 세션을 만들어 불투명한 랜덤 id(sid)를 반환한다.
//	클라이언트는 sid를 저장(localStorage)하고 `Authorization: Bearer <sid>`로 전송한다.
//	매 요청마다 sid를 스토어와 대조(존재 여부, 만료, 취소)한다.
//	관리자는 봇의 /웹유저삭제 명령이 기록하는 web_revoked.json에 sid를 올려 세션을
//	취소할 수 있고, 그러면 다음 요청부터 401로 실패한다.
//
// 채팅: 봇이 유일한 허브다. chat.json을 기록하고(GET /api/chat에서 읽음),
// web_outbox/*.json을 소비한다(POST /api/chat에서 기록). 모든 경로는 환경변수로 설정 가능하다.
package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
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
	revokedJSON  string
	outboxDir    string
	perfJSON     string
	perfHistJSON string
	staticDir    string
	maxPlayers   int
	freshSec     float64
	sessionSec   int64
	allowOrigin  string
	demo         bool
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

// loadConfig는 모든 경로를 환경변수에서 읽어 바이너리의 이식성을 확보한다.
// 기본값은 저장소 상대 경로이고, 실제 배포에서는 런처(예: systemd 유닛)가 절대 경로로
// 덮어쓴다. PANEL_BRIDGE_DIR은 동반 디스코드 봇이 JSON 파일을 기록하는 디렉터리,
// PANEL_MC_DATA_DIR은 서버 측 KubeJS 스크립트가 status/perf를 기록하는 디렉터리다.
func loadConfig() config {
	br := getenv("PANEL_BRIDGE_DIR", "./data")
	mc := getenv("PANEL_MC_DATA_DIR", "./data")
	return config{
		listen:       getenv("PANEL_LISTEN", ":8080"),
		statusJSON:   getenv("PANEL_STATUS_JSON", filepath.Join(mc, "status.json")),
		recordsJSON:  getenv("PANEL_RECORDS_JSON", filepath.Join(br, "records.json")),
		authJSON:     getenv("PANEL_AUTH_JSON", filepath.Join(br, "auth.json")),
		sessionsJSON: getenv("PANEL_SESSIONS_JSON", filepath.Join(br, "sessions.json")),
		chatJSON:     getenv("PANEL_CHAT_JSON", filepath.Join(br, "chat.json")),
		revokedJSON:  getenv("PANEL_REVOKED_JSON", filepath.Join(br, "web_revoked.json")),
		outboxDir:    getenv("PANEL_OUTBOX_DIR", filepath.Join(br, "web_outbox")),
		perfJSON:     getenv("PANEL_PERF_JSON", filepath.Join(mc, "perf.json")),
		perfHistJSON: getenv("PANEL_PERF_HISTORY_JSON", filepath.Join(mc, "perf_history.json")),
		staticDir:    getenv("PANEL_STATIC_DIR", "./web/out"),
		maxPlayers:   getenvInt("PANEL_MAX_PLAYERS", 20),
		freshSec:     getenvFloat("PANEL_FRESH_SEC", 21),
		sessionSec:   int64(getenvInt("PANEL_SESSION_SEC", 2*24*3600)),
		allowOrigin:  getenv("PANEL_ALLOW_ORIGIN", ""),
		demo:         getenvBool("PANEL_DEMO", false),
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

func newSessionStore(path, revokedPath string, ttl int64) *sessionStore {
	s := &sessionStore{path: path, revokedPath: revokedPath, ttl: ttl,
		data: map[string]*session{}, revoked: map[string]bool{}}
	var raw map[string]*session
	if err := readJSON(path, &raw); err == nil && raw != nil {
		s.data = raw
	}
	return s
}

func (s *sessionStore) persistLocked() {
	tmp := s.path + ".tmp"
	b, _ := json.MarshalIndent(s.data, "", "  ")
	if os.WriteFile(tmp, b, 0o600) == nil {
		_ = os.Rename(tmp, s.path)
	}
}

// refreshRevokedLocked는 web_revoked.json의 mtime이 바뀌면 다시 로드한다.
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
	_ = readJSON(s.revokedPath, &list)
	m := make(map[string]bool, len(list))
	for _, sid := range list {
		m[sid] = true
	}
	s.revoked = m
	s.revokedMtime = mt
}

func genSID() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err // RNG 실패 시 예측 가능한 토큰을 절대 발급하지 않는다
	}
	return hex.EncodeToString(b), nil
}

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

// PurgeExpired는 만료된 세션을 제거한다(클리너가 주기적으로 호출).
func (s *sessionStore) PurgeExpired() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.purgeLocked(time.Now().Unix())
}

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

// get은 sid를 검증하고 세션의 복사본을 반환한다.
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

func (s *sessionStore) setNickname(sid, nick string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.data[sid]
	if !ok {
		return errors.New("no_session")
	}
	// 다른 활성 세션이 이미 쓰고 있는 닉네임은 거부
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

// sweep는 기록이 모두 만료된 키를 제거한다(맵의 무한 증가 방지).
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

func clientIP(r *http.Request) string {
	host := r.RemoteAddr
	if c := strings.LastIndexByte(host, ':'); c >= 0 {
		host = host[:c]
	}
	host = strings.Trim(host, "[]")
	// 요청이 실제로 로컬 Cloudflare 터널(루프백의 cloudflared)에서 들어온 경우에만 포워딩
	// 헤더를 신뢰한다. 리스너가 127.0.0.1에 바인딩되므로 직접 접속하는 클라이언트는
	// CF-Connecting-IP / X-Forwarded-For를 위조할 방법이 없다.
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

// sanitizeText는 제어 문자, 마인크래프트 섹션 기호(§, 색상/서식/난독화 코드 및 사칭에 사용),
// 개행, 앞뒤 공백을 제거한다. 봇의 tellraw를 통해 사용자 텍스트가 게임에 도달하기 전의
// 심층 방어다.
func sanitizeText(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r == '\n' || r == '\r' || r == '\t':
			b.WriteByte(' ')
		case r < 0x20, r == 0x7f, r >= 0x80 && r <= 0x9f: // C0/C1 제어 문자
			// 제거
		case r == 0x00a7: // § 섹션 기호
			// 제거
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

type player struct {
	Name string  `json:"name"`
	UUID string  `json:"uuid"`
	Ping float64 `json:"ping"`
}
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
type chatMsg struct {
	ID     int64  `json:"id"`
	TS     int64  `json:"ts"`
	Source string `json:"source"`
	User   string `json:"user"`
	UUID   string `json:"uuid"`
	Text   string `json:"text"`
}

// ------------------------------------------------------------------ 서버
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
	sessions      *sessionStore
	loginRL       *rateLimiter // IP별 로그인 시도
	loginGlobalRL *rateLimiter // 서버 전체 로그인 상한(IP별 제한이 우회될 경우의 방어선)
	chatRL        *rateLimiter
	perfMu        sync.Mutex
	perfHist      []perfHistEntry // perf.json에서 샘플링한 롤링 성능 히스토리
}

func (s *server) writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

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

func bearerOf(r *http.Request) string {
	h := r.Header.Get("Authorization")
	const p = "Bearer "
	if strings.HasPrefix(h, p) {
		return strings.TrimSpace(h[len(p):])
	}
	return ""
}

// auth는 세션을 검증한다. 실패하면 401을 쓰고 ok=false를 반환한다.
func (s *server) auth(w http.ResponseWriter, r *http.Request) (string, session, bool) {
	sid := bearerOf(r)
	sess, ok := s.sessions.get(sid)
	if !ok {
		s.writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return "", session{}, false
	}
	return sid, sess, true
}

func (s *server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if s.cors(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		s.writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method"})
		return
	}
	if !s.loginRL.allow(clientIP(r)) || !s.loginGlobalRL.allow("global") {
		s.writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "too_many_attempts"})
		return
	}
	var body struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&body); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad_request"})
		return
	}
	code := strings.TrimSpace(body.Code)
	if s.cfg.demo {
		// 데모 모드에는 코드를 갱신할 봇이 없으므로 잘 알려진 데모 코드를 받아들인다.
		if subtleNE(code, demoLoginCode) {
			s.writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_code"})
			return
		}
	} else {
		var af authFile
		if err := readJSON(s.cfg.authJSON, &af); err != nil || af.Code == "" {
			s.writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "no_active_code"})
			return
		}
		if len(code) != len(af.Code) || subtleNE(code, af.Code) {
			s.writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_code"})
			return
		}
	}
	sid, err := s.sessions.create()
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"token": sid})
}

// subtleNE는 a != b 여부를 상수 시간으로 판정한다.
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

func (s *server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if s.cors(w, r) {
		return
	}
	if sid := bearerOf(r); sid != "" {
		s.sessions.remove(sid)
	}
	s.writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *server) handleMe(w http.ResponseWriter, r *http.Request) {
	if s.cors(w, r) {
		return
	}
	_, sess, ok := s.auth(w, r)
	if !ok {
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"nickname": sess.Nickname})
}

func (s *server) handleNickname(w http.ResponseWriter, r *http.Request) {
	if s.cors(w, r) {
		return
	}
	sid, _, ok := s.auth(w, r)
	if !ok {
		return
	}
	if r.Method != http.MethodPost {
		s.writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method"})
		return
	}
	var body struct {
		Nickname string `json:"nickname"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&body); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad_request"})
		return
	}
	nick := sanitizeText(body.Nickname)
	n := len([]rune(nick))
	if n < 2 || n > 16 {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_nickname"})
		return
	}
	if err := s.sessions.setNickname(sid, nick); err != nil {
		if err.Error() == "taken" {
			s.writeJSON(w, http.StatusConflict, map[string]string{"error": "nickname_taken"})
			return
		}
		s.writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"nickname": nick})
}

func (s *server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if s.cors(w, r) {
		return
	}
	if _, _, ok := s.auth(w, r); !ok {
		return
	}
	var st statusFile
	var rec recordsFile
	if s.cfg.demo {
		st, rec = demoStatus(), demoRecords()
	} else {
		_ = readJSON(s.cfg.statusJSON, &st)
		_ = readJSON(s.cfg.recordsJSON, &rec)
	}

	nowMs := float64(time.Now().UnixMilli())
	serverUp := st.TS > 0 && (nowMs-st.TS) < s.cfg.freshSec*1000

	resp := map[string]any{
		"server_up":      serverUp,
		"max":            s.cfg.maxPlayers,
		"max_concurrent": rec.MaxConcurrent,
		"updated_ts":     int64(st.TS),
	}
	if serverUp {
		players := st.Players
		if players == nil {
			players = []player{}
		}
		resp["count"] = st.Count
		resp["tps"] = st.TPS
		resp["mspt"] = st.Mspt
		resp["players"] = players
	} else {
		resp["count"] = 0
		resp["tps"] = -1
		resp["mspt"] = -1
		resp["players"] = []player{}
	}
	s.writeJSON(w, http.StatusOK, resp)
}

// handlePerf는 패널의 성능 뷰를 위해 실시간 성능 샘플(perf.json)과 롤링 히스토리
// (perf_history.json)를 서빙한다. 둘 다 플레이어가 1명 이상 접속해 있을 때만 KubeJS가
// 기록하며, 유휴 상태에서는 오래되거나 없으므로 tracking=false를 반환한다.
func (s *server) handlePerf(w http.ResponseWriter, r *http.Request) {
	if s.cors(w, r) {
		return
	}
	if _, _, ok := s.auth(w, r); !ok {
		return
	}
	var cur map[string]any
	if s.cfg.demo {
		cur = demoPerfCurrent()
	} else {
		_ = readJSON(s.cfg.perfJSON, &cur)
	}
	tracking := false
	if cur != nil {
		if tsv, ok := cur["ts"].(float64); ok {
			tracking = (float64(time.Now().UnixMilli()) - tsv) < 6000
		}
	}
	if !tracking {
		cur = nil
	}
	s.perfMu.Lock()
	hist := make([]perfHistEntry, len(s.perfHist))
	copy(hist, s.perfHist)
	s.perfMu.Unlock()
	s.writeJSON(w, http.StatusOK, map[string]any{"tracking": tracking, "current": cur, "history": hist})
}

// perfSampler는 perf.json이 신선한 동안(플레이어 접속 중) 약 1.5초마다 압축된 히스토리
// 포인트를 추가한다. 메모리에 보관(재시작 시 초기화)되며 패널의 실시간 차트를 구동한다.
func (s *server) perfSampler() {
	t := time.NewTicker(1500 * time.Millisecond)
	defer t.Stop()
	for range t.C {
		var cur map[string]any
		if s.cfg.demo {
			cur = demoPerfCurrent()
		} else if readJSON(s.cfg.perfJSON, &cur) != nil || cur == nil {
			continue
		}
		tsv, _ := cur["ts"].(float64)
		if tsv == 0 || float64(time.Now().UnixMilli())-tsv >= 6000 {
			continue // 오래됨/유휴(플레이어 없음)
		}
		e := perfHistEntry{Ts: int64(tsv)}
		e.Tps, _ = cur["tps"].(float64)
		e.Mspt, _ = cur["mspt"].(float64)
		if p95, _ := cur["mspt_p95"].(float64); p95 >= 0 {
			e.P95 = p95
		} else {
			e.P95, _ = cur["period_p95"].(float64)
		}
		if v, ok := cur["count"].(float64); ok {
			e.Count = int(v)
		}
		if v, ok := cur["spikes_100"].(float64); ok {
			e.Spikes = int(v)
		}
		s.perfMu.Lock()
		if n := len(s.perfHist); n == 0 || s.perfHist[n-1].Ts != e.Ts {
			s.perfHist = append(s.perfHist, e)
			if len(s.perfHist) > 480 { // 1.5초 간격으로 약 12분
				s.perfHist = s.perfHist[len(s.perfHist)-480:]
			}
		}
		s.perfMu.Unlock()
	}
}

func (s *server) handleChat(w http.ResponseWriter, r *http.Request) {
	if s.cors(w, r) {
		return
	}
	sid, sess, ok := s.auth(w, r)
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		since, _ := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
		var all []chatMsg
		if s.cfg.demo {
			all = demoChat()
		} else {
			_ = readJSON(s.cfg.chatJSON, &all)
		}
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
	case http.MethodPost:
		if sess.Nickname == "" {
			s.writeJSON(w, http.StatusConflict, map[string]string{"error": "no_nickname"})
			return
		}
		if !s.chatRL.allow(sid) {
			s.writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "slow_down"})
			return
		}
		var body struct {
			Text string `json:"text"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body); err != nil {
			s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad_request"})
			return
		}
		text := sanitizeText(body.Text)
		if text == "" {
			s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "empty"})
			return
		}
		if len([]rune(text)) > 256 {
			text = string([]rune(text)[:256])
		}
		// 데모 모드에는 아웃박스를 소비할 봇이 없으므로 받아들이고 버린다.
		if !s.cfg.demo {
			if err := s.enqueueOutbox(sess.Nickname, text); err != nil {
				s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "enqueue_failed"})
				return
			}
		}
		s.writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	default:
		s.writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method"})
	}
}

func (s *server) enqueueOutbox(nick, text string) error {
	if err := os.MkdirAll(s.cfg.outboxDir, 0o700); err != nil {
		return err
	}
	// 봇이 죽었거나 지연되면 부하를 떨궈 inode/디스크 고갈을 막는다
	if entries, err := os.ReadDir(s.cfg.outboxDir); err == nil && len(entries) > 500 {
		return errors.New("backlog")
	}
	now := time.Now()
	rb := make([]byte, 6)
	if _, err := rand.Read(rb); err != nil {
		return err
	}
	name := fmt.Sprintf("%013d-%s.json", now.UnixMilli(), hex.EncodeToString(rb))
	// 세션 id는 일부러 디스크에 기록하지 않는다(봇은 닉네임만 필요하다)
	payload, _ := json.Marshal(map[string]any{
		"nickname": nick, "text": text, "ts": now.UnixMilli(),
	})
	tmp := filepath.Join(s.cfg.outboxDir, "."+name)
	final := filepath.Join(s.cfg.outboxDir, name)
	if err := os.WriteFile(tmp, payload, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, final) // 원자적 게시 — 봇이 미완성 파일을 읽지 않도록
}

// static은 익스포트된 Next.js 사이트를 서빙하며 SPA 방식으로 index.html로 폴백한다.
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

// securityHeaders는 mux를 감싸 모든 응답에 보안 강화 헤더를 설정한다.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
		// Next.js 정적 익스포트는 작은 인라인 부트스트랩/테마 스크립트와 인라인 스타일을
		// 쓰므로 script/style에 'unsafe-inline'이 필요하다. 나머지는 모두 잠근다.
		h.Set("Content-Security-Policy",
			"default-src 'self'; img-src 'self' https://mc-heads.net data:; "+
				"style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; "+
				"connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'")
		next.ServeHTTP(w, r)
	})
}

func main() {
	cfg := loadConfig()
	s := &server{
		cfg:           cfg,
		sessions:      newSessionStore(cfg.sessionsJSON, cfg.revokedJSON, cfg.sessionSec),
		loginRL:       newRateLimiter(600, 10),  // IP당 10분에 로그인 10회
		loginGlobalRL: newRateLimiter(600, 120), // 서버 전체 10분에 로그인 120회
		chatRL:        newRateLimiter(5, 3),     // 세션당 5초에 메시지 3개
	}

	go s.perfSampler() // 패널 차트용 실시간 성능 히스토리

	// 외부 릴레이 모니터링(frp 경유 UptimeRobot)용 헬스 리스너.
	// 전용 포트의 루프백에 바인딩되고 frpc 터널(VPS -> frps -> frpc -> 여기)을 통해서만
	// 노출된다. 따라서 HTTP 200 성공은 릴레이 체인 전체가 살아있음을 증명한다. /healthz만
	// 서빙하며 인증도 민감 데이터도 없다 — 패널 API 자체는 cfg.listen에서 비노출 상태로 유지된다.
	go func() {
		hmux := http.NewServeMux()
		hmux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("ok\n"))
		})
		hsrv := &http.Server{
			Addr:              getenv("PANEL_HEALTH_LISTEN", "127.0.0.1:8099"),
			Handler:           hmux,
			ReadHeaderTimeout: 5 * time.Second,
			ReadTimeout:       10 * time.Second,
			WriteTimeout:      10 * time.Second,
			IdleTimeout:       30 * time.Second,
			MaxHeaderBytes:    1 << 14,
		}
		log.Printf("mc_sv-panel health listener on %s (/healthz)", hsrv.Addr)
		if err := hsrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("health listener stopped: %v", err)
		}
	}()

	// 백그라운드 클리너: 만료 세션 제거 및 오래된 레이트 리밋 키 정리
	go func() {
		t := time.NewTicker(5 * time.Minute)
		defer t.Stop()
		for range t.C {
			s.sessions.PurgeExpired()
			s.loginRL.sweep()
			s.loginGlobalRL.sweep()
			s.chatRL.sweep()
		}
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("/api/login", s.handleLogin)
	mux.HandleFunc("/api/logout", s.handleLogout)
	mux.HandleFunc("/api/me", s.handleMe)
	mux.HandleFunc("/api/nickname", s.handleNickname)
	mux.HandleFunc("/api/status", s.handleStatus)
	mux.HandleFunc("/api/perf", s.handlePerf)
	mux.HandleFunc("/api/chat", s.handleChat)
	mux.HandleFunc("/", s.static)

	srv := &http.Server{
		Addr:              cfg.listen,
		Handler:           securityHeaders(mux),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       20 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 16,
	}
	if cfg.demo {
		log.Printf("mc_sv-panel DEMO MODE — bridge files ignored, sample data served (login code %q)", demoLoginCode)
	}
	log.Printf("mc_sv-panel listening on %s (static=%s)", cfg.listen, cfg.staticDir)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
