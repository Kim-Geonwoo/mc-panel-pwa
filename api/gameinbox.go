package main

// 게임 인박스: 웹 채팅을 게임에 전달하기 위해 API가 쓰는 큐 파일입니다.
// (README 후속 과제 — RCON 전권 자격증명을 인터넷 노출 API로 옮기지 않기 위해,
// status/perf에서 검증된 KubeJS 파일 채널의 역방향을 씁니다)
// 서버 측 KubeJS 스크립트(web_to_game.js)가 1초 주기로 이 파일을 읽어 tellraw로
// 표시합니다. 단일 작성자 = API. id는 DB 메시지 id 그대로(단조 증가) — KubeJS는
// 마지막으로 표시한 id만 기억하면 됩니다. 게임이 꺼져 있으면 최신 50개 창 밖의
// 메시지는 유실되지만, 웹·디스코드에는 이미 전달된 뒤라 허용합니다.

import (
	"encoding/json"
	"os"
	"time"
)

type gameInboxEntry struct {
	ID   int64  `json:"id"`
	Ts   int64  `json:"ts"`
	User string `json:"user"`
	Text string `json:"text"`
}

// gameInboxFile은 큐 파일의 최상위 형태입니다. KubeJS의 JsonIO.read가 최상위
// JSON 배열에는 null을 반환해(객체만 지원 — 배포 검증에서 확인) 객체로 감쌉니다.
type gameInboxFile struct {
	Messages []gameInboxEntry `json:"messages"`
}

const gameInboxCap = 50

// appendGameInbox는 메시지를 큐 파일에 추가합니다(read-modify-write + 원자적 rename).
// 파일 손상은 빈 큐로 간주하고 새로 시작합니다 — 전달은 best-effort입니다.
func (s *server) appendGameInbox(id int64, user, text string) error {
	var f gameInboxFile
	_ = readJSON(s.cfg.gameInbox, &f) // 없거나 깨져 있으면 빈 큐
	f.Messages = append(f.Messages, gameInboxEntry{ID: id, Ts: time.Now().UnixMilli(), User: user, Text: text})
	if len(f.Messages) > gameInboxCap {
		f.Messages = f.Messages[len(f.Messages)-gameInboxCap:]
	}
	b, err := json.Marshal(f)
	if err != nil {
		return err
	}
	tmp := s.cfg.gameInbox + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.cfg.gameInbox)
}
