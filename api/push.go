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
	"time"

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

// sendPushAll은 모든 구독에 알림을 비동기 발송합니다. 404/410 구독은 제거합니다.
func (s *server) sendPushAll(title, body string) {
	go s.sendPushAllSync(title, body)
}

func (s *server) sendPushAllSync(title, body string) {
	if s.store == nil || s.vapid.Private == "" {
		return
	}
	subs, err := s.store.pushSubs()
	if err != nil || len(subs) == 0 {
		return
	}
	payload, _ := json.Marshal(map[string]string{"title": title, "body": body})
	for _, sub := range subs {
		resp, err := webpush.SendNotification(payload, &webpush.Subscription{
			Endpoint: sub.Endpoint,
			Keys:     webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
		}, &webpush.Options{
			VAPIDPublicKey:  s.vapid.Public,
			VAPIDPrivateKey: s.vapid.Private,
			Subscriber:      "https://github.com/Kim-Geonwoo/mc-panel-pwa",
			TTL:             60,
		})
		if err != nil {
			log.Printf("push send failed (%s): %v", sub.Endpoint, err)
			continue
		}
		if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone {
			_ = s.store.deletePushSub(sub.Endpoint) // 만료·해지된 구독 정리
		}
		_ = resp.Body.Close()
	}
}

// statusEdge는 서버 온라인 판정의 에지(전이)를 디바운스와 함께 계산합니다.
// 초기 상태가 확정되기 전(첫 전이)에는 발화하지 않아 부팅 시 오알림을 막습니다.
type statusEdge struct {
	inited  bool
	stable  bool // 마지막으로 확정된 상태
	cand    bool // 전이 후보 상태
	candCnt int  // 후보 연속 관측 수
}

// feed는 샘플을 넣고 확정된 전이가 있으면 "down"/"up"을 돌려줍니다(없으면 "").
func (e *statusEdge) feed(up bool) string {
	if !e.inited {
		if up { // 첫 up 관측 시점부터 추적 시작 (그 전 down은 부팅 중)
			e.inited, e.stable, e.cand = true, true, true
		}
		return ""
	}
	if up == e.stable {
		e.cand, e.candCnt = e.stable, 0
		return ""
	}
	if up != e.cand {
		e.cand, e.candCnt = up, 0
	}
	e.candCnt++
	if e.candCnt >= 2 { // 2연속 샘플로 확정 (일시 파일 지연 오탐 방지)
		e.stable, e.candCnt = up, 0
		if up {
			return "up"
		}
		return "down"
	}
	return ""
}

// runStatusWatcher는 5초마다 status.json의 신선도로 서버 상태를 감시해
// 다운/복구 전이에 푸시를 보냅니다.
func (s *server) runStatusWatcher(stop <-chan struct{}) {
	edge := &statusEdge{}
	t := time.NewTicker(5 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-stop:
			return
		case <-t.C:
		}
		var st statusFile
		_ = readJSON(s.cfg.statusJSON, &st)
		up := st.TS > 0 && (float64(time.Now().UnixMilli())-st.TS) < s.cfg.freshSec*1000
		switch edge.feed(up) {
		case "down":
			s.sendPushAll("마크서버", "서버가 응답하지 않습니다 (다운 감지)")
		case "up":
			s.sendPushAll("마크서버", "서버가 다시 온라인입니다")
		}
	}
}

// notifyJoin은 플레이어 접속 푸시를 보냅니다. 재접속 도배를 막기 위해 30초 쿨다운.
func (s *server) notifyJoin(name string, isFirst bool) {
	now := time.Now().Unix()
	s.pushMu.Lock()
	last := s.lastJoinPush
	if now-last < 30 {
		s.pushMu.Unlock()
		return
	}
	s.lastJoinPush = now
	s.pushMu.Unlock()
	if isFirst {
		s.sendPushAll("마크서버", name+" 님이 처음으로 접속했습니다")
	} else {
		s.sendPushAll("마크서버", name+" 님이 접속했습니다")
	}
}
