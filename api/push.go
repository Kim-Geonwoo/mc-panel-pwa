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
	"strings"
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

// handlePushConfig는 클라이언트가 푸시를 구성하는 데 필요한 값을 한 번에 돌려줍니다:
// VAPID 공개키와 서버가 허용한 알림 종류 목록. 데모 모드·VAPID 미로드·활성 이벤트
// 0개 중 하나라도 해당하면 빈 응답({"key":"","events":[]})을 200으로 돌려주어, UI가
// 푸시 관련 화면을 숨길지 스스로 판단하게 합니다(503로 오류 처리하지 않습니다).
func (s *server) handlePushConfig(w http.ResponseWriter, r *http.Request, _ string, _ session) {
	if s.cfg.demo || s.vapid.Public == "" || len(s.cfg.pushEvents) == 0 {
		s.writeJSON(w, http.StatusOK, map[string]any{"key": "", "events": []string{}})
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"key": s.vapid.Public, "events": s.cfg.pushEvents})
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
		Topics []string `json:"topics"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body); err != nil ||
		body.Endpoint == "" || body.Keys.P256dh == "" || body.Keys.Auth == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "error"})
		return
	}
	topics := s.normalizeTopics(body.Topics)
	if err := s.store.upsertPushSub(body.Endpoint, body.Keys.P256dh, body.Keys.Auth, topics); err != nil {
		log.Printf("push subscribe failed: %v", err)
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// normalizeTopics는 클라이언트가 요청한 구독 종류를 서버가 허용한 활성 이벤트와
// 교집합해 CSV로 정규화합니다. 요청이 비었거나 유효한 종류가 하나도 없으면 활성 전체를
// 구독합니다. 저장 순서는 활성 목록 순서("server" 먼저, "join")로 고정됩니다.
func (s *server) normalizeTopics(req []string) string {
	want := make(map[string]bool, len(req))
	for _, t := range req {
		want[strings.ToLower(strings.TrimSpace(t))] = true
	}
	out := make([]string, 0, len(s.cfg.pushEvents))
	for _, ev := range s.cfg.pushEvents { // 이미 "server","join" 순으로 정렬됨
		if len(req) == 0 || want[ev] {
			out = append(out, ev)
		}
	}
	if len(out) == 0 { // 요청이 활성 이벤트와 전혀 겹치지 않으면 활성 전체로 대체
		out = append(out, s.cfg.pushEvents...)
	}
	return strings.Join(out, ",")
}

// hasTopic는 CSV로 저장된 구독 종류에 topic이 포함되는지 검사합니다.
func hasTopic(csv, topic string) bool {
	for _, t := range strings.Split(csv, ",") {
		if strings.TrimSpace(t) == topic {
			return true
		}
	}
	return false
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

// sendPushAll은 topic을 구독한 구독에 알림을 비동기 발송합니다. 404/410 구독은 제거합니다.
func (s *server) sendPushAll(topic, title, body string) {
	go s.sendPushAllSync(topic, title, body)
}

func (s *server) sendPushAllSync(topic, title, body string) {
	if s.store == nil || s.vapid.Private == "" {
		return
	}
	// 서버 설정에서 해당 알림 종류가 꺼져 있으면 아무것도 보내지 않습니다.
	if !s.cfg.pushEventEnabled(topic) {
		return
	}
	subs, err := s.store.pushSubs()
	if err != nil || len(subs) == 0 {
		return
	}
	payload, _ := json.Marshal(map[string]string{"title": title, "body": body})
	for _, sub := range subs {
		// 이 종류를 구독하지 않은 사용자는 건너뜁니다.
		if !hasTopic(sub.Topics, topic) {
			continue
		}
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
			s.sendPushAll("server", "마크서버", "서버가 응답하지 않습니다 (다운 감지)")
		case "up":
			s.sendPushAll("server", "마크서버", "서버가 다시 온라인입니다")
		}
	}
}

// notifyJoin은 플레이어 접속 푸시를 보냅니다. 재접속 도배를 막기 위해 30초 쿨다운.
// join 알림이 서버 설정에서 꺼져 있으면 쿨다운을 건드리지 않고 즉시 반환합니다 —
// 나중에 다시 켰을 때 첫 접속이 쿨다운에 걸려 조용히 삼켜지지 않도록.
func (s *server) notifyJoin(name string, isFirst bool) {
	if !s.cfg.pushEventEnabled("join") {
		return
	}
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
		s.sendPushAll("join", "마크서버", name+" 님이 처음으로 접속했습니다")
	} else {
		s.sendPushAll("join", "마크서버", name+" 님이 접속했습니다")
	}
}
