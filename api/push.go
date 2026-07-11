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

// pushHTTP는 푸시 발송에 재사용하는 단일 HTTP 클라이언트입니다. 타임아웃이 없으면
// 응답 없는 푸시 엔드포인트 하나가 직렬 발송 루프를 무한정 붙잡을 수 있습니다.
var pushHTTP = &http.Client{Timeout: 10 * time.Second}

// loadOrCreateVAPID는 저장된 키를 읽고, 없으면 새로 생성해 원자적으로 기록합니다.
func loadOrCreateVAPID(path string) (vapidKeys, error) {
	var k vapidKeys
	if err := readJSON(path, &k); err == nil && k.Public != "" && k.Private != "" {
		return k, nil
	}
	// 파일이 존재하는데(genuinely-absent가 아님) 읽히지 않으면 재생성은 곧 키 회전이며
	// 기존 구독이 전부 무효화됩니다. 조용히 넘기지 않고 경고를 남깁니다(최초 실행은 무경고).
	if _, statErr := os.Stat(path); statErr == nil {
		log.Printf("vapid: 기존 키 파일(%s)을 읽을 수 없어 재생성합니다 — 키가 회전되어 모든 기존 구독이 무효화됩니다", path)
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
	// 서버가 나중에 이 엔드포인트로 POST하므로(블라인드 SSRF 표면), https만 허용합니다.
	if !strings.HasPrefix(body.Endpoint, "https://") {
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
			HTTPClient:      pushHTTP, // 응답 없는 엔드포인트가 직렬 루프를 막지 않도록 10초 타임아웃
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

// 점검 인지 다운 알림에 쓰는 상수.
const (
	// maintWindow는 점검 마커를 유효하다고 볼 최대 나이입니다. 이보다 오래된 마커는
	// 점검이 아닌 것으로 간주해(stale-marker 가드) 알림을 영구히 억제하지 않습니다.
	maintWindow = 30 * time.Minute
	// maintProblemWait는 점검 중 다운을 문제로 승격하기까지 기다리는 시간입니다.
	// 계획된 재시작 창(약 55~90초)을 넉넉히 넘긴 뒤에만 알립니다.
	maintProblemWait = 120 * time.Second
)

// maintenanceActive는 점검 마커 파일이 존재하고 그 수정 시각이 now 기준 maintWindow
// 이내이면 점검 중으로 판정합니다. 파일이 없거나 오래됐으면 점검 아님(false)입니다.
func maintenanceActive(path string, now time.Time) bool {
	fi, err := os.Stat(path)
	if err != nil {
		return false
	}
	return now.Sub(fi.ModTime()) <= maintWindow
}

// pushDecision은 다운 감시기가 이번 틱에 보낼 푸시 종류입니다.
type pushDecision int

const (
	pushNone    pushDecision = iota // 아무것도 보내지 않음
	pushDown                        // 일반 다운 알림(점검 아님)
	pushProblem                     // 점검 중 문제 알림(다운이 2분 이상 지속)
	pushUp                          // 복구 알림
)

// downNotifier는 다운/복구 전이에 어떤 푸시를 보낼지 결정하는 순수 상태기입니다.
// I/O·시계에 의존하지 않으며(now·maintActive를 주입받음) 단위 테스트가 쉽습니다.
// runStatusWatcher가 실제 시계·마커 검사·sendPushAll에 연결합니다.
type downNotifier struct {
	pending  bool      // 점검 중 다운이 억제되어 승격을 관찰하는 중
	downAt   time.Time // 다운이 처음 감지된 시각(pending일 때 유효)
	notified bool      // 이번 다운에 대해 문제 알림을 이미 보냄
	downSent bool      // 이번 다운에 다운 계열 알림(일반/문제)을 실제로 보냄 — 복구 알림 발송 조건
}

func (n *downNotifier) reset() {
	n.pending, n.downAt, n.notified, n.downSent = false, time.Time{}, false, false
}

// step은 이번 틱의 에지 이벤트("", "down", "up")와 주입된 now·maintActive로 보낼 푸시를
// 결정합니다. 에지 없는 틱("")에서도 점검 중 억제된 다운이 maintProblemWait를 넘겼는지
// 검사해 문제 알림을 한 번만 승격합니다.
func (n *downNotifier) step(edge string, now time.Time, maintActive bool) pushDecision {
	switch edge {
	case "down":
		if maintActive {
			// 점검 창 안의 다운 → 즉시 알리지 않고 승격 대기 상태로 둡니다.
			n.pending, n.downAt, n.notified, n.downSent = true, now, false, false
			return pushNone
		}
		// 점검 아님 → 기존과 동일하게 즉시 다운 알림.
		n.pending, n.notified, n.downSent = false, false, true
		return pushDown
	case "up":
		sent := n.downSent
		n.reset()
		if sent { // 다운을 실제로 알린 경우에만 복구를 알립니다(조용히 억제된 다운은 조용히 복구).
			return pushUp
		}
		return pushNone
	default: // "" — 전이 없음. 점검 중 억제된 다운의 승격만 검사.
		if n.pending && !n.notified && now.Sub(n.downAt) >= maintProblemWait {
			n.notified, n.downSent = true, true
			return pushProblem
		}
		return pushNone
	}
}

// runStatusWatcher는 5초마다 status.json의 신선도로 서버 상태를 감시해
// 다운/복구 전이에 푸시를 보냅니다. 정기 점검 창(maintMarker) 안의 다운은 즉시 알리지
// 않고, 다운이 maintProblemWait 이상 이어질 때만 문제로 승격해 알립니다.
func (s *server) runStatusWatcher(stop <-chan struct{}) {
	edge := &statusEdge{}
	notifier := &downNotifier{}
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
		now := time.Now()
		up := st.TS > 0 && (float64(now.UnixMilli())-st.TS) < s.cfg.freshSec*1000
		switch notifier.step(edge.feed(up), now, maintenanceActive(s.cfg.maintMarker, now)) {
		case pushDown:
			s.sendPushAll("server", "마크서버", "서버가 응답하지 않습니다 (다운 감지)")
		case pushProblem:
			s.sendPushAll("server", "마크서버", "정기 점검 중 문제가 발생했습니다 — 서버가 2분 이상 응답하지 않습니다")
		case pushUp:
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
