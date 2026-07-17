package main

import (
	"bytes"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestParseLayout(t *testing.T) {
	if _, err := parseLayout([]byte(`{"version":1,"meta":{"title":"x"}}`)); err != nil {
		t.Fatalf("valid layout rejected: %v", err)
	}
	for _, bad := range []string{``, `{`, `[]`, `null`, `{"version":"x"}`, `{"version":999}`} {
		if _, err := parseLayout([]byte(bad)); err == nil {
			t.Errorf("bad layout accepted: %q", bad)
		}
	}
}

func TestDefaultLayoutValid(t *testing.T) {
	if _, err := parseLayout(defaultLayout()); err != nil {
		t.Fatalf("defaultLayout is invalid: %v", err)
	}
}

func TestHandleLayoutGet(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "layout.json")

	// 파일 없음 → 기본 레이아웃(200 + 유효 JSON)
	s := &server{layout: newFileLayoutStore(p)}
	rec := httptest.NewRecorder()
	s.handleLayoutGet(rec, httptest.NewRequest("GET", "/api/layout", nil))
	if rec.Code != 200 {
		t.Fatalf("default: code %d", rec.Code)
	}
	if _, err := parseLayout(rec.Body.Bytes()); err != nil {
		t.Fatalf("default body invalid: %v", err)
	}

	// 저장된 레이아웃 반환
	if err := newFileLayoutStore(p).put([]byte(`{"version":1,"meta":{"title":"custom"}}`)); err != nil {
		t.Fatalf("put: %v", err)
	}
	rec2 := httptest.NewRecorder()
	s.handleLayoutGet(rec2, httptest.NewRequest("GET", "/api/layout", nil))
	if rec2.Code != 200 || !bytes.Contains(rec2.Body.Bytes(), []byte("custom")) {
		t.Fatalf("stored not returned: %d %s", rec2.Code, rec2.Body)
	}

	// 손상 파일 → 기본 폴백(앱이 죽지 않음)
	if err := os.WriteFile(p, []byte("{corrupt"), 0o600); err != nil {
		t.Fatal(err)
	}
	rec3 := httptest.NewRecorder()
	s.handleLayoutGet(rec3, httptest.NewRequest("GET", "/api/layout", nil))
	if rec3.Code != 200 {
		t.Fatalf("corrupt fallback: code %d", rec3.Code)
	}
	if _, err := parseLayout(rec3.Body.Bytes()); err != nil {
		t.Fatalf("corrupt fallback body invalid: %v", err)
	}
}
