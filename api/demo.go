package main

import "time"

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

func demoPerfCurrent() map[string]any {
	now := float64(time.Now().UnixMilli())
	return map[string]any{
		"ts":         now,
		"tps":        20.0,
		"mspt":       8.4,
		"mspt_p95":   14.2,
		"count":      2.0,
		"spikes_100": 0.0,
	}
}

// 채팅 샘플 데이터
func demoChat() []chatMsg {
	now := time.Now().UnixMilli()
	return []chatMsg{
		{ID: now - 60000, TS: now - 60000, Source: "game", User: "Steve", Text: "데모 채팅입니다 — 게임에서 보낸 메시지"},
		{ID: now - 30000, TS: now - 30000, Source: "discord", User: "Alex", Text: "Hello from Discord!"},
		{ID: now - 10000, TS: now - 10000, Source: "web", User: "Guest", Text: "웹 패널에서 보낸 메시지"},
		{ID: now - 5000, TS: now - 5000, Source: "game", User: "Steve", Text: "게임에서 보낸 두 번째 메시지"},
		{ID: now - 2000, TS: now - 2000, Source: "discord", User: "Alex", Text: "Discord에서 보낸 두 번째 메시지"},
		{ID: now - 1000, TS: now - 1000, Source: "web", User: "Notch", Text: "오프라인 상태에서 웹 패널에서 보낸 메시지"},
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
