package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
)

// layoutSchemaVersion는 서버가 생성하는 기본 레이아웃의 스키마 버전이다(additive-only).
const layoutSchemaVersion = 1

// maxLayoutBytes는 저장/수신 레이아웃의 바이트 상한(폭탄 방지).
const maxLayoutBytes = 256 * 1024

// Layout은 한 서버의 페이지 구성이다. 증분 1은 theme/meta/tabs만 소비하고 screen은
// 원문 보존(증분 2의 제네릭 렌더러가 사용). 미지 필드는 additive-only로 무시한다.
type Layout struct {
	Version int             `json:"version"`
	Meta    json.RawMessage `json:"meta,omitempty"`
	Theme   json.RawMessage `json:"theme,omitempty"`
	Tabs    json.RawMessage `json:"tabs,omitempty"`
	Screen  json.RawMessage `json:"screen,omitempty"`
}

// parseLayout은 바이트를 검증한다. panic 금지 — 손상/악성 입력은 error로 거부.
func parseLayout(b []byte) (Layout, error) {
	if len(b) == 0 || len(b) > maxLayoutBytes {
		return Layout{}, errors.New("layout: empty or too large")
	}
	var l Layout
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields() // 최상위는 알려진 필드만(관대함은 하위 트리에서)
	if err := dec.Decode(&l); err != nil {
		// 알 수 없는 최상위 필드는 additive-only 위반이 아니라 손상으로 간주하지 않기 위해
		// 관대 디코드로 재시도(상위 필드 무시).
		var l2 Layout
		if e2 := json.Unmarshal(b, &l2); e2 != nil {
			return Layout{}, fmt.Errorf("layout: %w", e2)
		}
		l = l2
	}
	if l.Version < 1 || l.Version > layoutSchemaVersion {
		return Layout{}, fmt.Errorf("layout: unsupported version %d", l.Version)
	}
	return l, nil
}

// defaultLayout은 현행 UI를 표현한 번들 기본 레이아웃이다(파일 부재 시 반환).
// 회귀 0 요건: 여기의 theme/tabs가 현행 기본과 동일해야 한다.
// tabs enabled 기본은 web/components/Panel.tsx의 tabPrefs 초기값(perf·timeline 모두 true)과
// 일치하므로 enabled 필드를 두지 않는다(전부 노출).
func defaultLayout() []byte {
	return []byte(`{
  "version": 1,
  "meta": { "title": "" },
  "theme": { "mode": "auto" },
  "tabs": [
    { "id": "chat",     "label": {"ko":"채팅","en":"Chat"} },
    { "id": "perf",     "label": {"ko":"성능","en":"Perf"} },
    { "id": "timeline", "label": {"ko":"타임라인","en":"Timeline"} }
  ]
}`)
}

type layoutStore interface {
	get() ([]byte, error)
	put([]byte) error
}

// fileLayoutStore는 단일 파일 구현(Phase 1). 미래 호스팅은 이 인터페이스로 DB 교체.
type fileLayoutStore struct{ path string }

func newFileLayoutStore(path string) *fileLayoutStore { return &fileLayoutStore{path} }

func (s *fileLayoutStore) get() ([]byte, error) {
	b, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return defaultLayout(), nil
		}
		return nil, err
	}
	if _, err := parseLayout(b); err != nil {
		// 손상 파일은 기본으로 폴백(운영 중 편집 실수로 앱이 죽지 않게).
		return defaultLayout(), nil
	}
	return b, nil
}

func (s *fileLayoutStore) put(b []byte) error {
	if _, err := parseLayout(b); err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// handleLayoutGet은 현재 서버의 레이아웃(또는 기본)을 반환한다. 인증 불필요.
func (s *server) handleLayoutGet(w http.ResponseWriter, r *http.Request) {
	b, err := s.layout.get()
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "layout"})
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(b)
}

// handleLayoutPut은 레이아웃을 검증 후 원자적으로 저장한다. 루프백 리스너에만
// 등록되어 인터넷에서 도달 불가하다(Phase 1 로컬 관리; 미래 호스팅은 인증 뒤로 이동).
func (s *server) handleLayoutPut(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		w.Header().Set("Allow", "PUT")
		s.writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method"})
		return
	}
	b, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxLayoutBytes))
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "too_large_or_bad"})
		return
	}
	if err := s.layout.put(b); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_layout"})
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
