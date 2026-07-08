package main

// 인증 이벤트 경보: 로그인 실패가 짧은 시간에 몰리거나 전역 레이트 리미터가 포화되면
// 디스코드 웹훅(PANEL_ALERT_WEBHOOK)으로 알립니다. 6자리 코드는 무차별 대입 시도가
// 누적될수록 위험하므로, 차단(레이트 리밋)만으로는 부족하고 시도가 일어나고 있다는
// 사실 자체를 운영자가 바로 알아야 합니다. 웹훅 미설정 시 로그로만 남깁니다.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
)

type alerter struct {
	mu        sync.Mutex
	webhook   string
	fails     []int64 // 최근 로그인 실패 시각(unix초)
	window    int64   // 실패 집계 윈도우(초)
	threshold int     // 윈도우 내 실패 경보 임계값
	cooldown  int64   // 경보 재발송 최소 간격(초) — 웹훅 스팸 방지
	lastSent  int64
	client    *http.Client
}

func newAlerter(webhook string) *alerter {
	return &alerter{
		webhook:   webhook,
		window:    600,
		threshold: 10,
		cooldown:  900,
		client:    &http.Client{Timeout: 5 * time.Second},
	}
}

// loginFail은 로그인 실패를 기록하고, 윈도우 내 실패가 임계값을 넘으면 경보를 보냅니다.
func (a *alerter) loginFail(ip string) {
	log.Printf("login failed from %s", ip)
	now := time.Now().Unix()
	a.mu.Lock()
	cut := now - a.window
	kept := a.fails[:0]
	for _, t := range a.fails {
		if t > cut {
			kept = append(kept, t)
		}
	}
	a.fails = append(kept, now)
	n := len(a.fails)
	fire := n >= a.threshold && now-a.lastSent >= a.cooldown
	if fire {
		a.lastSent = now
	}
	a.mu.Unlock()
	if fire {
		a.send(fmt.Sprintf("[mc_sv-panel] 로그인 실패 %d회/%d분 — 마지막 IP %s. 무차별 대입 가능성을 확인하세요.",
			n, a.window/60, ip))
	}
}

// rateLimited는 레이트 리미터 차단을 기록합니다. 전역 리미터 포화는 IP를 바꿔 가며
// 시도하는 분산 공격의 신호이므로 즉시 경보 대상입니다.
func (a *alerter) rateLimited(scope, ip string) {
	log.Printf("login rate-limited (%s) from %s", scope, ip)
	if scope != "global" {
		return
	}
	now := time.Now().Unix()
	a.mu.Lock()
	fire := now-a.lastSent >= a.cooldown
	if fire {
		a.lastSent = now
	}
	a.mu.Unlock()
	if fire {
		a.send("[mc_sv-panel] 전역 로그인 리미터 포화 — 분산 IP 무차별 대입 가능성. 로그인 코드 로테이션 상태를 확인하세요.")
	}
}

// send는 경보를 로그로 남기고, 웹훅이 설정돼 있으면 디스코드로도 전송합니다.
// 요청 처리 경로를 막지 않도록 웹훅 전송은 비동기로 합니다.
func (a *alerter) send(msg string) {
	log.Printf("ALERT: %s", msg)
	if a.webhook == "" {
		return
	}
	go func() {
		body, _ := json.Marshal(map[string]string{"content": msg})
		resp, err := a.client.Post(a.webhook, "application/json", bytes.NewReader(body))
		if err != nil {
			log.Printf("alert webhook failed: %v", err)
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode >= 300 {
			log.Printf("alert webhook status %d", resp.StatusCode)
		}
	}()
}
