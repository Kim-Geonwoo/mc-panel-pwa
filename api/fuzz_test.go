package main

// M14: 보안 관련 순수·결정론적 함수에 대한 Go 네이티브 퍼즈 테스트.
//
// OpenSSF Scorecard의 Fuzzing 체크는 `FuzzXxx(f *testing.F)` 형태로 `f.Fuzz`를
// 사용하는 Go 네이티브 퍼즈 타깃을 자동 인식합니다. 여기서는 게임 화면·타이밍 공격·
// 푸시 구독 등 보안에 직접 닿는 순수 함수들을 대상으로, 단순한 참조 구현이나 불변식을
// 퍼즈 본문에서 검증합니다. 시드 코퍼스는 일반 `go test`에서도 실행되며, 어떤 입력에도
// 패닉하지 않아야 합니다.

import (
	"strings"
	"testing"
	"unicode/utf8"
)

// FuzzSanitizeText는 sanitizeText가 제어 문자·§·줄바꿈을 제거/치환하고, 유효한 UTF-8을
// 유지하며(룬을 쪼개지 않음), 룬 길이를 늘리지 않고, 절대 패닉하지 않음을 검증합니다.
func FuzzSanitizeText(f *testing.F) {
	seeds := []string{
		"",
		"hello",
		"  trim me  ",
		"안녕하세요",
		"a\nb\rc\td",
		"§ccolored§r",
		"\x00\x01\x1f\x7f\x80\x9f",
		strings.Repeat("x", 4096),
		"\xff\xfe invalid utf8 \x80",
		"mix \x00 §k 값 \n end",
	}
	for _, s := range seeds {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, s string) {
		out := sanitizeText(s)

		if !utf8.ValidString(out) {
			t.Fatalf("sanitizeText(%q) = %q: not valid UTF-8", s, out)
		}
		for _, r := range out {
			if r < 0x20 {
				t.Fatalf("sanitizeText(%q) = %q: contains control rune %#U", s, out, r)
			}
			if r == 0x7f || (r >= 0x80 && r <= 0x9f) {
				t.Fatalf("sanitizeText(%q) = %q: contains C1/DEL rune %#U", s, out, r)
			}
			if r == 0x00a7 {
				t.Fatalf("sanitizeText(%q) = %q: contains § (section sign)", s, out)
			}
			if r == '\n' || r == '\r' || r == '\t' {
				t.Fatalf("sanitizeText(%q) = %q: contains newline/tab rune %#U", s, out, r)
			}
		}
		// 출력은 입력 룬의 부분집합(치환/삭제/트림)이므로 룬 길이가 늘어날 수 없습니다.
		if utf8.RuneCountInString(out) > utf8.RuneCountInString(s) {
			t.Fatalf("sanitizeText(%q): out rune len %d > in rune len %d",
				s, utf8.RuneCountInString(out), utf8.RuneCountInString(s))
		}
		// 앞뒤 공백이 트림되었는지(멱등성의 일부).
		if out != strings.TrimSpace(out) {
			t.Fatalf("sanitizeText(%q) = %q: not fully trimmed", s, out)
		}
	})
}

// FuzzSubtleNE는 상수 시간 부등호 비교 subtleNE가 평범한 `a != b`와 항상 동일한 값을
// 내는지(정확성 오라클) 검증합니다. 절대 패닉하지 않아야 합니다.
func FuzzSubtleNE(f *testing.F) {
	pairs := [][2]string{
		{"", ""},
		{"a", ""},
		{"123456", "123456"},
		{"123456", "123457"},
		{"12345", "123456"},
		{"안녕", "안녕"},
		{"안녕", "안뇽"},
		{"\x00", "\x00"},
		{"\xff\xfe", "\xff\xff"},
		{strings.Repeat("k", 1000), strings.Repeat("k", 1000)},
	}
	for _, p := range pairs {
		f.Add(p[0], p[1])
	}
	f.Fuzz(func(t *testing.T, a, b string) {
		if got, want := subtleNE(a, b), a != b; got != want {
			t.Fatalf("subtleNE(%q, %q) = %v, want %v (a != b)", a, b, got, want)
		}
	})
}

// FuzzParsePushEvents는 parsePushEvents 결과가 {"server","join"}의 부분집합이고,
// 중복이 없으며, 둘 다 있으면 server가 join보다 먼저 오는지 검증합니다. 절대 패닉 금지.
func FuzzParsePushEvents(f *testing.F) {
	seeds := []string{
		"",
		"server",
		"join",
		"server,join",
		"join,server",
		"SERVER, Join",
		"  server ,, join ,server ",
		"foo,bar,baz",
		"join,join,server,server",
		"\x00,§,server,\n",
	}
	for _, s := range seeds {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, v string) {
		out := parsePushEvents(v)

		seen := map[string]bool{}
		serverIdx, joinIdx := -1, -1
		for i, e := range out {
			if e != "server" && e != "join" {
				t.Fatalf("parsePushEvents(%q) = %v: unexpected token %q", v, out, e)
			}
			if seen[e] {
				t.Fatalf("parsePushEvents(%q) = %v: duplicate token %q", v, out, e)
			}
			seen[e] = true
			switch e {
			case "server":
				serverIdx = i
			case "join":
				joinIdx = i
			}
		}
		if serverIdx >= 0 && joinIdx >= 0 && serverIdx > joinIdx {
			t.Fatalf("parsePushEvents(%q) = %v: server must precede join", v, out)
		}
	})
}

// FuzzCapRunes는 capRunes가 유효한 UTF-8을 유지하고, 룬을 쪼개지 않으며, 룬 개수를 n으로
// 제한하고, n이 충분히 크면 원본을 그대로 돌려주는지 검증합니다.
//
// capRunes의 계약은 n >= 0 입니다(호출부는 항상 양의 상수를 넘깁니다). 구현은 n < 0 이면
// r[:n] 슬라이싱에서 패닉하므로, 지원 범위(n >= 0)로 정규화한 뒤 검증합니다. 음수 n을
// 시드로 넣어 정규화 경로도 함께 밟습니다.
func FuzzCapRunes(f *testing.F) {
	type seed struct {
		s string
		n int
	}
	seeds := []seed{
		{"", 0},
		{"hello", 3},
		{"hello", 5},
		{"hello", 10},
		{"hello", 0},
		{"안녕하세요", 2},
		{"안녕하세요", 100},
		{"a\x00b", 2},
		{"emoji 😀 tail", 7},
		{strings.Repeat("z", 5000), 128},
		{"neg", -1},
		{"", -5},
	}
	for _, s := range seeds {
		f.Add(s.s, s.n)
	}
	f.Fuzz(func(t *testing.T, s string, n int) {
		// 계약상 지원 범위로 정규화(구현은 음수 n에서 패닉하도록 설계됨).
		if n < 0 {
			n = 0
		}
		out := capRunes(s, n)

		inRunes := []rune(s)
		// 룬 개수는 절대 n을 넘지 않습니다.
		if rc := utf8.RuneCountInString(out); rc > n {
			t.Fatalf("capRunes(%q, %d) = %q: rune count %d > n", s, n, out, rc)
		}
		if len(inRunes) <= n {
			// n이 입력 룬 개수 이상이면 원본을 그대로(바이트까지) 돌려줍니다.
			// 이때 입력이 유효하지 않은 UTF-8이면 출력도 그대로 유효하지 않을 수 있습니다.
			if out != s {
				t.Fatalf("capRunes(%q, %d) = %q: expected unchanged input", s, n, out)
			}
		} else {
			// 절단 경로: string(r[:n])로 재인코딩되므로 항상 유효한 UTF-8이며
			// 입력 룬의 앞 n개와 정확히 일치해야 합니다(룬을 쪼개지 않음).
			if !utf8.ValidString(out) {
				t.Fatalf("capRunes(%q, %d) = %q: truncated output not valid UTF-8", s, n, out)
			}
			if want := string(inRunes[:n]); out != want {
				t.Fatalf("capRunes(%q, %d) = %q, want rune-prefix %q", s, n, out, want)
			}
		}
	})
}

// FuzzHasTopic은 hasTopic이 간단한 참조 구현(콤마 분리 후 트림 멤버십)과 항상 일치하고
// 절대 패닉하지 않는지 검증합니다.
func FuzzHasTopic(f *testing.F) {
	type seed struct {
		csv, topic string
	}
	seeds := []seed{
		{"", ""},
		{"server", "server"},
		{"server,join", "join"},
		{" server , join ", "join"},
		{"server,join", "chat"},
		{"a,,b", ""},
		{",", ""},
		{"안녕,값", "값"},
		{"x,y,z", "y"},
		{"\x00,\n", "\x00"},
	}
	for _, s := range seeds {
		f.Add(s.csv, s.topic)
	}
	f.Fuzz(func(t *testing.T, csv, topic string) {
		// 인라인 참조 구현: 콤마로 나누고 각 조각을 트림하여 topic과 일치 여부 확인.
		want := false
		for _, part := range strings.Split(csv, ",") {
			if strings.TrimSpace(part) == topic {
				want = true
				break
			}
		}
		if got := hasTopic(csv, topic); got != want {
			t.Fatalf("hasTopic(%q, %q) = %v, want %v", csv, topic, got, want)
		}
	})
}
