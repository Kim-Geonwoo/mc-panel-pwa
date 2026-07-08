package main

// 웹 푸시(VAPID): 서버 다운/복구·플레이어 접속을 설치형 PWA에 알립니다.
// VAPID 키는 최초 실행 시 자동 생성해 bridge 디렉토리에 보관(0600)합니다 —
// 키가 바뀌면 기존 구독이 전부 무효가 되므로 반드시 재사용해야 합니다.
// 구독은 SQLite(push_subs)에 저장하고, 404/410 응답을 받은 구독은 제거합니다.

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

	webpush "github.com/SherClockHolmes/webpush-go"
)

type vapidKeys struct {
	Public  string `json:"public"`
	Private string `json:"private"`
}

// loadOrCreateVAPID는 저장된 키를 읽고, 없으면 새로 생성해 원자적으로 기록합니다.
func loadOrCreateVAPID(path string) (vapidKeys, error) {
	var k vapidKeys
	if err := readJSON(path, &k); err == nil && k.Public != "" && k.Private != "" {
		return k, nil
	}
	priv, pub, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		return vapidKeys{}, err
	}
	k = vapidKeys{Public: pub, Private: priv}
	b, err := json.Marshal(k)
	if err != nil {
		return vapidKeys{}, err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return vapidKeys{}, err
	}
	if err := os.Rename(tmp, path); err != nil {
		return vapidKeys{}, err
	}
	log.Printf("vapid keys generated (%s)", path)
	return k, nil
}

// handlePushKey는 브라우저 구독에 필요한 VAPID 공개키를 돌려줍니다.
func (s *server) handlePushKey(w http.ResponseWriter, r *http.Request, _ string, _ session) {
	if s.vapid.Public == "" {
		s.writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "push_unavailable"})
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]string{"key": s.vapid.Public})
}

// handlePushSubscribe는 브라우저 PushSubscription을 저장합니다. (인증 필수 — apiAuthed 체인)
func (s *server) handlePushSubscribe(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		s.writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "no_store"})
		return
	}
	var body struct {
		Endpoint string `json:"endpoint"`
		Keys     struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body); err != nil ||
		body.Endpoint == "" || body.Keys.P256dh == "" || body.Keys.Auth == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "error"})
		return
	}
	if err := s.store.upsertPushSub(body.Endpoint, body.Keys.P256dh, body.Keys.Auth); err != nil {
		log.Printf("push subscribe failed: %v", err)
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handlePushUnsubscribe는 구독을 제거합니다.
func (s *server) handlePushUnsubscribe(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		s.writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "no_store"})
		return
	}
	var body struct {
		Endpoint string `json:"endpoint"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body); err != nil || body.Endpoint == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "error"})
		return
	}
	if err := s.store.deletePushSub(body.Endpoint); err != nil {
		log.Printf("push unsubscribe failed: %v", err)
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
