package main

// 내부(루프백) API: 봇처럼 같은 호스트에서 도는 신뢰된 프로세스 전용 엔드포인트로,
// 헬스 리스너(기본 127.0.0.1:8099)에만 등록합니다. 인터넷에 노출되는 메인 리스너(8080)에는
// 절대 등록하지 않습니다.
//
// 루프백이라는 사실만으로는 믿지 않습니다. 같은 호스트의 다른 계정도 127.0.0.1에 닿고,
// userspace 모드 tailscaled처럼 들어온 연결을 127.0.0.1로 넘겨 주는 프로세스가 있으면
// 바깥 요청도 루프백에서 온 것처럼 보입니다. 그래서 봇과 공유하는 비밀(0600 파일 권장)을
// Authorization: Bearer로 받아 상수 시간으로 비교합니다. 비밀이 설정되지 않았으면 내부
// 경로는 모두 503으로 닫힙니다.

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"runtime"
	"strings"
	"time"
)

var kstZone = time.FixedZone("KST", 9*3600)

// minInternalTokenLen은 공유 비밀의 최소 길이입니다. `openssl rand -hex 32`(64자)를 권장합니다.
const minInternalTokenLen = 32

// loadInternalToken은 내부 API 공유 비밀을 PANEL_INTERNAL_TOKEN_FILE(0600 파일, 권장)이나
// PANEL_INTERNAL_TOKEN(환경변수)에서 읽습니다. 둘 다 비어 있으면 ("", nil)이고 내부 API는
// 닫힙니다. 둘 다 설정했거나, 파일을 읽을 수 없거나, 다른 사용자가 읽을 수 있는 권한이거나,
// 너무 짧으면 오류를 돌려줍니다. 오류 메시지에는 비밀 값을 넣지 않습니다.
func loadInternalToken() (string, error) {
	path := os.Getenv("PANEL_INTERNAL_TOKEN_FILE")
	tok := os.Getenv("PANEL_INTERNAL_TOKEN")
	switch {
	case path != "" && tok != "":
		return "", errors.New("PANEL_INTERNAL_TOKEN과 PANEL_INTERNAL_TOKEN_FILE은 하나만 설정하세요")
	case path != "":
		fi, err := os.Stat(path)
		if err != nil {
			return "", err
		}
		// 윈도우는 유닉스 권한 비트를 쓰지 않으므로 검사하지 않습니다.
		if runtime.GOOS != "windows" && fi.Mode().Perm()&0o077 != 0 {
			return "", fmt.Errorf("%s 권한이 %v입니다 — 소유자만 읽도록 0600으로 두세요", path, fi.Mode().Perm())
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return "", err
		}
		tok = string(b)
	case tok == "":
		return "", nil
	}
	tok = strings.TrimSpace(tok)
	if len(tok) < minInternalTokenLen {
		return "", fmt.Errorf("내부 API 공유 비밀은 %d자 이상이어야 합니다", minInternalTokenLen)
	}
	return tok, nil
}

// internalAuth는 내부 API 핸들러 앞에서 공유 비밀(Authorization: Bearer)을 검사합니다.
// 비밀이 설정되지 않았으면 모든 요청을 503으로 거절합니다. 봇은 5xx를 받으면 기존 파일
// 경로로 물러나므로, 이행 중에도 기록을 잃지 않습니다.
func (s *server) internalAuth(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.cfg.internalToken == "" {
			s.writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "internal_disabled"})
			return
		}
		if !internalTokenMatch(bearerOf(r), s.cfg.internalToken) {
			w.Header().Set("WWW-Authenticate", `Bearer realm="internal"`)
			s.writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		h(w, r)
	}
}

// internalTokenMatch는 받은 값과 공유 비밀을 상수 시간으로 비교합니다. 양쪽의 SHA-256
// 다이제스트를 비교해 길이가 다른 값도 같은 시간에 거절합니다.
func internalTokenMatch(got, token string) bool {
	if got == "" || token == "" {
		return false
	}
	a := sha256.Sum256([]byte(got))
	b := sha256.Sum256([]byte(token))
	return subtle.ConstantTimeCompare(a[:], b[:]) == 1
}

// handleInternalIngest는 봇이 보내는 채팅/타임라인 레코드를 DB에 저장합니다.
// id·ts는 API가 부여합니다(단일 id 권위 = DB). 성공 시 {"id","ts"}를 돌려줍니다.
func (s *server) handleInternalIngest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		s.writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method"})
		return
	}
	if s.store == nil { // 데모 모드
		s.writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "no_store"})
		return
	}
	var body struct {
		Kind    string `json:"kind"`
		Source  string `json:"source"`
		User    string `json:"user"`
		UUID    string `json:"uuid"`
		Text    string `json:"text"`
		Name    string `json:"name"`
		Event   string `json:"event"`
		IsFirst bool   `json:"is_first"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&body); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "error"})
		return
	}
	now := time.Now()
	switch body.Kind {
	case "chat":
		if body.Source != "game" && body.Source != "discord" && body.Source != "web" {
			s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad_source"})
			return
		}
		user := capRunes(sanitizeText(body.User), 32)
		text := capRunes(sanitizeText(body.Text), 256)
		if user == "" || text == "" {
			s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "error"})
			return
		}
		id, err := s.store.insertChatAuto(now.UnixMilli(), body.Source, capRunes(sanitizeText(body.UUID), 40), user, text)
		if err != nil {
			log.Printf("ingest chat failed: %v", err)
			s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server_error"})
			return
		}
		s.writeJSON(w, http.StatusOK, map[string]any{"id": id, "ts": now.UnixMilli()})
	case "timeline":
		if body.Event != "join" && body.Event != "leave" {
			s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad_event"})
			return
		}
		name := capRunes(sanitizeText(body.Name), 32)
		if name == "" {
			s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "error"})
			return
		}
		tsKst := now.In(kstZone).Format("2006-01-02 15:04:05")
		id, err := s.store.insertTimelineAuto(now.UnixMilli(), tsKst, capRunes(sanitizeText(body.UUID), 40), name, body.Event, body.IsFirst)
		if err != nil {
			log.Printf("ingest timeline failed: %v", err)
			s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server_error"})
			return
		}
		if body.Event == "join" {
			s.notifyJoin(name, body.IsFirst)
		}
		s.writeJSON(w, http.StatusOK, map[string]any{"id": id, "ts": now.UnixMilli()})
	default:
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad_kind"})
	}
}

// handleInternalSessions는 활성 웹 세션 목록을 돌려줍니다. sid는 앞 8자만 노출 —
// 전체 sid가 새 나가면 그 자체가 로그인 토큰이기 때문입니다.
func (s *server) handleInternalSessions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		s.writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method"})
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"sessions": s.sessions.list()})
}

// handleInternalRevoke는 닉네임이 일치하는 활성 세션을 삭제합니다. 세션 저장소의
// 소유자(API)가 직접 지우므로 web_revoked.json 파일 IPC가 필요 없습니다.
// (파일 방식은 구버전 봇 호환을 위해 당분간 유지됩니다)
func (s *server) handleInternalRevoke(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		s.writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method"})
		return
	}
	var body struct {
		Nickname string `json:"nickname"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&body); err != nil || body.Nickname == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "error"})
		return
	}
	n := s.sessions.revokeByNickname(body.Nickname)
	log.Printf("internal revoke: nickname %q → %d sessions removed", body.Nickname, n)
	s.writeJSON(w, http.StatusOK, map[string]any{"revoked": n})
}

// capRunes는 유니코드 기준 n자로 자릅니다.
func capRunes(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}
