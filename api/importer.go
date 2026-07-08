package main

// 파일 임포터: 전환기 동안 봇이 계속 쓰는 chat.json/timeline.json을 주기적으로 DB에
// 반영합니다. 봇 계약(파일 형식·id 부여·원자적 rename 쓰기)은 그대로 두므로 봇 수정
// 없이 저장소만 SQLite로 바뀝니다. 첫 실행 시 파일 전체를 들여와 1회 마이그레이션을
// 겸합니다. M3(웹 중심 전환)에서 봇이 API로 직접 넣게 되면 이 임포터는 제거됩니다.
//
// 파일의 id는 임포트 커서(어디까지 들여왔는지)로만 쓰고, DB에는 자동 증가 id로
// 넣습니다 — id 권위는 DB 하나입니다. 웹 메시지는 API가 직접 DB에 넣으므로,
// 파일 id를 그대로 보존하면 봇 카운터와 DB 카운터가 충돌해 메시지가 유실됩니다.
// 마지막으로 들여온 파일 id는 meta에 저장해 재시작해도 중복 임포트하지 않습니다.
// 파일의 최대 id가 커서보다 작으면 봇 카운터가 리셋된 것으로 보고 경고 후 커서를
// 되감습니다(자동 id 부여라 재삽입돼도 유실은 없고, 최악의 경우 중복 표시).

import (
	"log"
	"os"
	"time"
)

const (
	metaChatImportID     = "chat_import_id"
	metaTimelineImportID = "timeline_import_id"
)

// runImporter는 2초 주기로 두 파일의 mtime을 보고 바뀐 것만 들여옵니다.
// stop이 닫히면 종료합니다. 타임라인 retention 정리는 1시간에 한 번 수행합니다.
func (s *server) runImporter(stop <-chan struct{}) {
	t := time.NewTicker(2 * time.Second)
	defer t.Stop()
	var chatMtime, tlMtime int64
	lastPrune := time.Time{} // 시작 직후 한 번 정리하고 이후 1시간 간격
	for {
		select {
		case <-stop:
			return
		case <-t.C:
		}
		chatMtime = s.importChat(chatMtime)
		tlMtime = s.importTimeline(tlMtime)
		if time.Since(lastPrune) > time.Hour {
			lastPrune = time.Now()
			cutoff := time.Now().AddDate(0, 0, -s.cfg.timelineRetentionDays).UnixMilli()
			if n, err := s.store.pruneTimeline(cutoff); err != nil {
				log.Printf("timeline prune failed: %v", err)
			} else if n > 0 {
				log.Printf("timeline prune: removed %d events older than %d days", n, s.cfg.timelineRetentionDays)
			}
		}
	}
}

// importChat은 chat.json이 바뀌었으면 새 메시지(id > 커서)를 DB에 넣습니다.
// 반환값은 다음 호출에 넘길 mtime입니다. 실패 시 이전 mtime을 돌려줘 다음 틱에 재시도합니다.
func (s *server) importChat(prevMtime int64) int64 {
	fi, err := os.Stat(s.cfg.chatJSON)
	if err != nil {
		return prevMtime // 파일이 아직 없음(봇 미기동) — 정상
	}
	mt := fi.ModTime().UnixNano()
	if mt == prevMtime {
		return prevMtime
	}
	var all []chatMsg
	if err := readJSON(s.cfg.chatJSON, &all); err != nil {
		log.Printf("chat import: read failed: %v", err)
		return prevMtime
	}
	cursor := s.store.metaInt(metaChatImportID)
	var maxID int64
	for _, m := range all {
		if m.ID > maxID {
			maxID = m.ID
		}
	}
	if maxID > 0 && maxID < cursor {
		log.Printf("chat import: id counter reset detected (file max %d < cursor %d) — rewinding cursor", maxID, cursor)
		cursor = 0
	}
	n := 0
	for _, m := range all {
		if m.ID <= cursor {
			continue
		}
		if _, err := s.store.insertChatAuto(m.TS, m.Source, m.UUID, m.User, m.Text); err != nil {
			log.Printf("chat import: insert failed at file id %d: %v", m.ID, err)
			return prevMtime
		}
		n++
	}
	if maxID > cursor {
		if err := s.store.setMetaInt(metaChatImportID, maxID); err != nil {
			log.Printf("chat import: cursor persist failed: %v", err)
			return prevMtime
		}
	}
	if n > 0 {
		log.Printf("chat import: %d new messages (cursor %d)", n, maxID)
	}
	return mt
}

// importTimeline은 timeline.json이 바뀌었으면 새 이벤트(id > 커서)를 DB에 넣습니다.
func (s *server) importTimeline(prevMtime int64) int64 {
	fi, err := os.Stat(s.cfg.timelineJSON)
	if err != nil {
		return prevMtime
	}
	mt := fi.ModTime().UnixNano()
	if mt == prevMtime {
		return prevMtime
	}
	var all []timelineEntry
	if err := readJSON(s.cfg.timelineJSON, &all); err != nil {
		log.Printf("timeline import: read failed: %v", err)
		return prevMtime
	}
	cursor := s.store.metaInt(metaTimelineImportID)
	var maxID int64
	for _, e := range all {
		if e.ID > maxID {
			maxID = e.ID
		}
	}
	if maxID > 0 && maxID < cursor {
		log.Printf("timeline import: id counter reset detected (file max %d < cursor %d) — rewinding cursor", maxID, cursor)
		cursor = 0
	}
	// 첫 실행(마이그레이션)·카운터 리셋 재임포트는 과거 이벤트 대량 삽입 — 접속 알림 억제
	notify := !(cursor == 0 && len(all) > 1)
	n := 0
	for _, e := range all {
		if e.ID <= cursor {
			continue
		}
		if _, err := s.store.insertTimelineAuto(e.Ts, e.TsKst, e.UUID, e.Name, e.Event, e.IsFirst); err != nil {
			log.Printf("timeline import: insert failed at file id %d: %v", e.ID, err)
			return prevMtime
		}
		if notify && e.Event == "join" {
			s.notifyJoin(e.Name, e.IsFirst) // 봇 폴백 경로에서도 접속 알림 유지
		}
		n++
	}
	if maxID > cursor {
		if err := s.store.setMetaInt(metaTimelineImportID, maxID); err != nil {
			log.Printf("timeline import: cursor persist failed: %v", err)
			return prevMtime
		}
	}
	if n > 0 {
		log.Printf("timeline import: %d new events (cursor %d)", n, maxID)
	}
	return mt
}
