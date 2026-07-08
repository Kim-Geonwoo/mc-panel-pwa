package main

// 웹 푸시: VAPID 키 자동 생성·재사용과 구독 저장·정리를 고정합니다.

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

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

func TestPushSubscribeAPI(t *testing.T) {
	s, dir := newTestServer(t)
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
