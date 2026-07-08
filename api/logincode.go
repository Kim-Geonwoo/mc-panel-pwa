package main

// 로그인 코드 관리자: 6자리 코드를 API가 직접 생성·로테이션합니다. (README '패치 예정' §1)
// 기존에는 디스코드 봇이 코드를 생성해 auth.json에 써 두는 구조라 봇이 죽으면 로그인
// 자체가 불가능했습니다. 이제 API가 auth.json의 단일 작성자가 되고, 봇은 그 파일을
// 읽어 디스코드 임베드에 표시만 합니다. 파일 형식({"code","issued_ts"})은 봇 호환을
// 위해 그대로 유지합니다.

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"os"
	"time"
)

type authCodeFile struct {
	Code     string  `json:"code"`
	IssuedTs float64 `json:"issued_ts"` // unix초 — 봇의 기존 형식(float)과 호환
}

// runCodeRotator는 1분 주기로 auth.json을 점검해, 코드가 없거나 rotate 주기를 넘겼으면
// 새로 발급합니다. 재시작해도 파일의 issued_ts를 존중하므로 코드가 불필요하게 바뀌지
// 않고, 파일이 지워지면 다음 점검에서 자동 재발급됩니다. (봇의 기존 auth_loop과 동일한
// 점검 리듬이라 봇 임베드 갱신도 1분 안에 따라옵니다)
func (s *server) runCodeRotator(stop <-chan struct{}) {
	rotate := time.Duration(s.cfg.codeRotateSec) * time.Second
	check := func() {
		var cur authCodeFile
		_ = readJSON(s.cfg.authJSON, &cur)
		if cur.Code != "" && time.Since(time.Unix(int64(cur.IssuedTs), 0)) < rotate {
			return
		}
		if err := s.writeLoginCode(); err != nil {
			log.Printf("login code rotate failed: %v", err)
		}
	}
	check()
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		select {
		case <-stop:
			return
		case <-t.C:
			check()
		}
	}
}

// writeLoginCode는 새 6자리 코드를 생성해 auth.json에 원자적으로 기록합니다(0600).
// 코드 값 자체는 로그에 남기지 않습니다 — 표시는 디스코드 임베드(봇)의 몫입니다.
func (s *server) writeLoginCode() error {
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return err
	}
	b, err := json.Marshal(authCodeFile{Code: fmt.Sprintf("%06d", n.Int64()), IssuedTs: float64(time.Now().Unix())})
	if err != nil {
		return err
	}
	tmp := s.cfg.authJSON + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, s.cfg.authJSON); err != nil {
		return err
	}
	log.Printf("login code rotated (interval %ds)", s.cfg.codeRotateSec)
	return nil
}
