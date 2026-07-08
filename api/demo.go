package main

import (
	"sync"
	"time"
)

// PANEL_DEMO=true 환경변수를 설정하면 디스코드 봇이나 게임 서버 없이도 패널을 체험할 수 있습니다.
// 실제 서버 파일 대신 아래 함수들이 반환하는 샘플 데이터를 사용하므로,
// UI의 모든 화면이 정상적으로 렌더링 되는지 확인할 수 있습니다.
//
// 데모 분기는 cfg.demo 플래그로 처리하며, 각 핸들러의 실제 로직은 건드리지 않습니다.
// 데모 전용 콘텐츠는 이 파일 한 곳에서만 정의하며, 다른 곳에서는 demoStatus() 등으로 호출만 합니다.

// 데모 모드에서 로그인할 때 사용할 6자리 숫자코드 입니다.
const demoLoginCode = "000000"

func demoStatus() statusFile {
	// 서버의 성능 지표 샘플값
	return statusFile{
		TS:    float64(time.Now().UnixMilli()),
		Count: 2,
		TPS:   20,
		Mspt:  8.4,
		Players: []player{
			{Name: "Steve", UUID: "00000000-0000-0000-0000-0000000000a1", Ping: 32},
			{Name: "Alex", UUID: "00000000-0000-0000-0000-0000000000a2", Ping: 47},
		},
	}
}

func demoRecords() recordsFile {
	return recordsFile{MaxConcurrent: 7}
}

// demoPerfCurrent는 web/lib/api.ts의 PerfCurrent 타입과 필드가 1:1로 맞아야 합니다.
// 필드가 빠지면 성능 탭이 undefined.toFixed()로 크래시합니다.
func demoPerfCurrent() map[string]any {
	now := float64(time.Now().UnixMilli())
	return map[string]any{
		"ts":         now,
		"tps":        20.0,
		"mspt":       8.4,
		"mspt_p95":   14.2,
		"mspt_p99":   18.9,
		"mspt_max":   31.4,
		"period_p95": 14.2,
		"period_max": 42.0,
		"spikes_50":  1.0,
		"spikes_100": 0.0,
		"count":      2.0,
		"players": []player{
			{Name: "Steve", UUID: "00000000-0000-0000-0000-0000000000a1", Ping: 32},
			{Name: "Alex", UUID: "00000000-0000-0000-0000-0000000000a2", Ping: 47},
		},
		"dims": []map[string]any{
			{"name": "minecraft:overworld", "chunks": 289.0, "entities": 142.0},
			{"name": "minecraft:the_nether", "chunks": 25.0, "entities": 8.0},
			{"name": "minecraft:the_end", "chunks": 0.0, "entities": 0.0},
		},
	}
}

// 데모 채팅은 첫 요청 시각에 시드를 한 번만 생성해 in-memory로 유지합니다.
// 호출마다 time.Now() 기준으로 ID를 재생성하면 폴링 커서(since=last_id)보다 큰 ID가
// 계속 만들어져 같은 메시지가 2초마다 반복 전달되므로, ID/TS를 고정해야 합니다.
var (
	demoChatOnce sync.Once
	demoChatMu   sync.Mutex
	demoChatMsgs []chatMsg
)

func demoChatSeed() {
	now := time.Now().UnixMilli()
	mk := func(off int64, source, user, text string) chatMsg {
		return chatMsg{ID: now - off, TS: now - off, Source: source, User: user, Text: text}
	}
	demoChatMsgs = []chatMsg{
		mk(60000, "game", "Steve", "데모 채팅입니다 — 게임에서 보낸 메시지"),
		mk(30000, "discord", "Alex", "Hello from Discord!"),
		mk(10000, "web", "Guest", "웹 패널에서 보낸 메시지"),
		mk(5000, "game", "Steve", "게임에서 보낸 두 번째 메시지"),
		mk(2000, "discord", "Alex", "Discord에서 보낸 두 번째 메시지"),
		mk(1000, "web", "Notch", "오프라인 상태에서 웹 패널에서 보낸 메시지"),
	}
}

// demoChat은 데모 채팅 메시지의 복사본을 반환합니다.
func demoChat() []chatMsg {
	demoChatOnce.Do(demoChatSeed)
	demoChatMu.Lock()
	defer demoChatMu.Unlock()
	out := make([]chatMsg, len(demoChatMsgs))
	copy(out, demoChatMsgs)
	return out
}

// demoChatAppend는 데모 모드에서 웹으로 보낸 메시지를 스토어에 추가해 피드에 바로 반영합니다.
func demoChatAppend(user, text string) {
	demoChatOnce.Do(demoChatSeed)
	demoChatMu.Lock()
	defer demoChatMu.Unlock()
	id := time.Now().UnixMilli()
	if n := len(demoChatMsgs); n > 0 && id <= demoChatMsgs[n-1].ID {
		id = demoChatMsgs[n-1].ID + 1 // 같은 ms에 연속 전송돼도 ID는 단조 증가해야 커서가 어긋나지 않음
	}
	demoChatMsgs = append(demoChatMsgs, chatMsg{ID: id, TS: id, Source: "web", User: user, Text: text})
	if len(demoChatMsgs) > 300 {
		demoChatMsgs = demoChatMsgs[len(demoChatMsgs)-300:]
	}
}

// 타임라인 탭에 표시할 타임라인 이벤트 목록
// 이전 날짜의 완료 시간과 첫 방문 뱃지 예시도 함께 포함합니다.
func demoTimeline() []timelineEntry {
	// KST 시간대 기준으로 표시하기 위해 FixedZone을 사용합니다.
	kst := time.FixedZone("KST", 9*3600)
	now := time.Now().UnixMilli()

	const min = int64(60000)
	const hour = 60 * min
	const day = 24 * hour

	const a1 = "00000000-0000-0000-0000-0000000000a1" // Steve (접속 중)
	const a2 = "00000000-0000-0000-0000-0000000000a2" // Alex (접속 중)

	const a3 = "00000000-0000-0000-0000-0000000000a3" // Notch (오프라인)

	mk := func(id, ts int64, uuid, name, event string, first bool) timelineEntry {
		return timelineEntry{
			ID: id, Ts: ts, TsKst: time.UnixMilli(ts).In(kst).Format("2006-01-02 15:04:05"),
			UUID: uuid, Name: name, Event: event, IsFirst: first,
		}
	}

	// 샘플 타임라인 이벤트 데이터 (최근 2일간)
	return []timelineEntry{
		mk(1, now-2*day-3*hour, a3, "Notch", "join", true), // 그제 — Notch 첫 방문(완료)
		mk(2, now-2*day-1*hour, a3, "Notch", "leave", false),
		mk(3, now-day-5*hour, a1, "Steve", "join", false), // 어제 — Steve(완료)
		mk(4, now-day-3*hour-20*min, a1, "Steve", "leave", false),
		mk(5, now-day-4*hour, a2, "Alex", "join", true), // 어제 — Alex 첫 방문(완료)
		mk(6, now-day-2*hour, a2, "Alex", "leave", false),
		mk(7, now-6*hour, a1, "Steve", "join", false), // 오늘 — Steve 완료 세션
		mk(8, now-4*hour-12*min, a1, "Steve", "leave", false),
		mk(9, now-68*min, a1, "Steve", "join", false), // 오늘 — Steve 진행중(online)
		mk(10, now-23*min, a2, "Alex", "join", false), // 오늘 — Alex 진행중(online)
	}
}
