package main

import "time"

// 데모 모드(PANEL_DEMO=true)에서는 mc_sv-panel을 비공개 디스코드 봇이나 게임 서버 없이
// 독립 쇼케이스로 구동할 수 있다. 봇/KubeJS가 기록하는 파일 읽기는 모두 아래의
// 인프로세스 샘플 데이터로 대체된다. UI가 전 구간 렌더링되도록 의도적으로 얇게 만든
// 골격이며, main.go의 요청 핸들러를 건드리지 않고 나중에 더 풍부한 데모 콘텐츠를 얹을 수 있다.
//
// 핸들러는 cfg.demo로 분기하며, 데모가 무엇을 서빙할지는 이 파일에서만 정의한다.
// 전용 데모 빌드/브랜치가 PANEL_DEMO=true를 설정한다.

// demoLoginCode는 데모 모드일 때 POST /api/login이 받아들이는 코드다(실제 코드를 갱신하는
// 봇이 없으므로). 누구나 라이브 데모를 시도할 수 있도록 명백한 값으로 둔다.
const demoLoginCode = "000000"

func demoStatus() statusFile {
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

func demoChat() []chatMsg {
	now := time.Now().UnixMilli()
	return []chatMsg{
		{ID: now - 60000, TS: now - 60000, Source: "game", User: "Steve", Text: "데모 채팅입니다 — 게임에서 보낸 메시지"},
		{ID: now - 30000, TS: now - 30000, Source: "discord", User: "Alex", Text: "Hello from Discord!"},
		{ID: now - 10000, TS: now - 10000, Source: "web", User: "Guest", Text: "웹 패널에서 보낸 메시지"},
	}
}

// demoTimeline — sample connection events for the timeline tab in PANEL_DEMO.
// Consistent with demoStatus (Steve, Alex are "online" → open sessions today),
// plus a few completed sessions on earlier KST days and a first-visit badge.
func demoTimeline() []timelineEntry {
	kst := time.FixedZone("KST", 9*3600)
	now := time.Now().UnixMilli()
	const min = int64(60000)
	const hour = 60 * min
	const day = 24 * hour
	const a1 = "00000000-0000-0000-0000-0000000000a1" // Steve (online)
	const a2 = "00000000-0000-0000-0000-0000000000a2" // Alex (online)
	const a3 = "00000000-0000-0000-0000-0000000000a3" // Notch (offline)
	mk := func(id, ts int64, uuid, name, event string, first bool) timelineEntry {
		return timelineEntry{
			ID: id, Ts: ts, TsKst: time.UnixMilli(ts).In(kst).Format("2006-01-02 15:04:05"),
			UUID: uuid, Name: name, Event: event, IsFirst: first,
		}
	}
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
