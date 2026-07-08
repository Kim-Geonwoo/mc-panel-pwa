package main

// 웹 푸시: VAPID 키 자동 생성·재사용과 구독 저장·정리를 고정합니다.

import (
	"os"
	"path/filepath"
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
