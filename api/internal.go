package main

// 내부(루프백) API: 봇처럼 같은 호스트에서 도는 신뢰된 프로세스 전용 엔드포인트로,
// 헬스 리스너(기본 127.0.0.1:8099)에만 등록합니다. 공유 파일(0600)과 동일한 신뢰
// 모델입니다 — 같은 호스트·같은 계정이면 어차피 파일을 직접 읽고 쓸 수 있으므로
// 별도 토큰을 두지 않습니다. 인터넷에 노출되는 메인 리스너(8080)에는 절대 등록하지
// 않습니다.

import (
	"encoding/json"
	"log"
	"net/http"
	"time"
)

var kstZone = time.FixedZone("KST", 9*3600)

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
