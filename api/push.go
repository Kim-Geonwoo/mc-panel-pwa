package main

// 웹 푸시(VAPID): 서버 다운/복구·플레이어 접속을 설치형 PWA에 알립니다.
// VAPID 키는 최초 실행 시 자동 생성해 bridge 디렉토리에 보관(0600)합니다 —
// 키가 바뀌면 기존 구독이 전부 무효가 되므로 반드시 재사용해야 합니다.
// 구독은 SQLite(push_subs)에 저장하고, 404/410 응답을 받은 구독은 제거합니다.

import (
	"encoding/json"
	"log"
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
