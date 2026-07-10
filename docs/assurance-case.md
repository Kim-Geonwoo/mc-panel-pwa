# 보안 보증 논증 (Security Assurance Case)

**한국어** | [English below](#english)

이 문서는 mc-panel-pwa가 자신의 보안 요구사항을 왜 충족한다고 판단하는지에 대한
논증(assurance case)입니다. 요구사항 → 위협 → 완화 → 검증의 사슬로 구성하며,
[SECURITY.md](../.github/SECURITY.md)의 운영 정책을 보완합니다.

## 1. 보안 요구사항

| ID | 요구사항 |
|----|----------|
| R1 | 인증된 사용자만 패널 기능(채팅·현황·푸시)에 접근할 수 있다 |
| R2 | 세션·로그인 자격은 예측 불가능해야 하며 유출 시 폭발 반경이 작아야 한다 |
| R3 | 신뢰할 수 없는 입력(채팅·쿼리)이 게임 서버·타 사용자·브라우저를 해치지 못한다 |
| R4 | 비밀값(토큰·키)은 저장소·클라이언트에 노출되지 않는다 |
| R5 | 전송 구간은 도청·변조로부터 보호된다 |
| R6 | 공급망(의존성·CI·이미지)의 변조를 조기에 탐지한다 |

## 2. 신뢰 경계와 위협 모델

```
[브라우저(PWA)] --TLS1.3--> [리버스 프록시] --루프백--> [Go API :127.0.0.1]
                                                          |--루프백--> [MC 서버 RCON]
                                                          |--TLS--> [Discord 웹훅 / Web Push]
```

주요 위협: 자격 추측·무차별 대입(R1·R2), 세션 탈취(R2), 채팅을 통한 제어문자/명령
주입 및 XSS(R3), 저장소를 통한 비밀 유출(R4), 중간자 공격(R5), 악성 의존성·이미지
변조(R6).

## 3. 논증 — 완화와 검증

- **R1 (인증)**: 모든 API는 세션 미들웨어 뒤에 있으며, 로그인은 게임 내에서 전달되는
  일회용 6자리 코드로만 가능하다(대역외 인증). 미인증 요청 거부는 핸들러 테스트로
  검증된다.
- **R2 (자격 강도)**: 로그인 코드·세션 ID는 `crypto/rand`로 생성하고 코드 검증은
  상수시간 비교(`crypto/subtle`)를 사용한다(타이밍 부채널 차단 — 퍼즈 테스트
  `FuzzSubtleNE`로 의미 보존 검증). 코드는 짧은 TTL로 회전하고, 실패 시도는 레이트
  리밋과 경보(알림)로 이어진다. 세션은 만료·정리(purge) 로직을 가지며 테스트로
  검증된다.
- **R3 (입력 처리)**: 채팅 입력은 `sanitizeText`가 제어문자·`§`(마인크래프트 포맷
  코드)·개행을 제거하고 rune 단위 길이 제한을 적용한다 — 불변식은 퍼즈 테스트
  (`FuzzSanitizeText`, `FuzzCapRunes`)로 검증(크래셔 0). 브라우저 측은 엄격한
  CSP(`default-src 'self'`, `frame-ancestors 'none'`)와 `nosniff`·`X-Frame-Options:
  DENY` 헤더가 적용된다.
- **R4 (비밀 관리)**: 런타임 비밀은 저장소 밖 설정 파일(0600)에만 존재한다. 저장소는
  gitleaks(CI)·GitHub 시크릿 스캐닝·푸시 보호로 상시 감시된다.
- **R5 (전송 보호)**: 공개 구간은 TLS 1.3(HSTS 2년)이고, API는 루프백에만 바인딩되어
  프록시 뒤에서만 도달 가능하다. RCON은 루프백 전용이다. 외부로 나가는 호출(웹훅·
  푸시)은 TLS이며 인증서 검증을 우회하지 않는다(`InsecureSkipVerify` 부재 확인).
  Web Push는 RFC 8291(ECDH P-256 + HKDF-SHA-256)을 표준 라이브러리로 사용한다.
- **R6 (공급망)**: 의존성은 락파일·digest로 고정되고(renovate가 갱신), CodeQL·Trivy·
  OSV-Scanner가 매 변경·주간 주기로 스캔한다. 도달성 분석(govulncheck)을 실제 대응에
  사용한 사례: Go 툴체인 1.26.5 고정으로 GO-2026-5856(crypto/tls) 해소.

## 4. 잔여 위험 (정직한 한계)

- 단독 유지보수자라 독립적 2인 코드리뷰가 없다 — CodeQL·테스트(문장 커버리지 80%
  수준)·퍼징·Scorecard로 부분 보완하지만 동등하지는 않다.
- 외부 침투 테스트는 수행된 적 없다. 취약점 신고는 [SECURITY.md](../.github/SECURITY.md)의
  비공개 채널로 받는다.
- 세션 토큰은 브라우저 `localStorage`에 보관된다 — XSS가 성립하면 토큰이 유출될 수
  있는 트레이드오프로, 현재는 엄격한 CSP와 이스케이프된 렌더링(주입 지점 부재)으로
  완화한다. httpOnly 쿠키 전환을 장기 과제로 검토한다.
- 가용성은 베스트에포트다(취미 프로젝트).

---

## English

This is the assurance case for why mc-panel-pwa believes it meets its security
requirements, structured as requirements → threats → mitigations → validation.
It complements the operational policy in [SECURITY.md](../.github/SECURITY.md).

### 1. Security requirements

| ID | Requirement |
|----|-------------|
| R1 | Only authenticated users may use panel features (chat, status, push) |
| R2 | Session/login credentials are unpredictable with a small blast radius |
| R3 | Untrusted input (chat, queries) cannot harm the game server, other users, or browsers |
| R4 | Secrets (tokens, keys) never appear in the repository or the client |
| R5 | Transport is protected against eavesdropping and tampering |
| R6 | Supply-chain tampering (dependencies, CI, images) is detected early |

### 2. Trust boundaries and threat model

Browser (PWA) → TLS 1.3 → reverse proxy → loopback → Go API (127.0.0.1), which
talks to the Minecraft server over loopback RCON and to Discord webhooks / Web
Push over TLS. Principal threats: credential guessing and brute force (R1, R2),
session theft (R2), control-character/command injection and XSS via chat (R3),
secret leakage through the repository (R4), man-in-the-middle (R5), and
malicious dependencies or image tampering (R6).

### 3. The argument — mitigations and validation

- **R1 (authentication)**: every API sits behind session middleware; login is
  possible only with a one-time 6-digit code delivered in-game (out-of-band).
  Rejection of unauthenticated requests is covered by handler tests.
- **R2 (credential strength)**: login codes and session IDs come from
  `crypto/rand`; code checks use constant-time comparison (`crypto/subtle`,
  semantics fuzz-verified by `FuzzSubtleNE`). Codes rotate on a short TTL;
  failures feed a rate limiter with alerting. Session expiry/purge logic is
  test-covered.
- **R3 (input handling)**: chat input passes `sanitizeText` (strips control
  characters, Minecraft `§` format codes, newlines; rune-capped) — invariants
  fuzz-verified (`FuzzSanitizeText`, `FuzzCapRunes`, 0 crashers). The browser
  side is protected by a strict CSP (`default-src 'self'`,
  `frame-ancestors 'none'`), `nosniff`, and `X-Frame-Options: DENY`.
- **R4 (secrets)**: runtime secrets live only in a config file outside the
  repository (mode 0600). The repository is continuously watched by gitleaks
  (CI) and GitHub secret scanning with push protection.
- **R5 (transport)**: the public edge is TLS 1.3 with two-year HSTS; the API
  binds to loopback only, reachable solely through the proxy. RCON is
  loopback-only. Outbound calls (webhooks, push) use TLS with default
  certificate verification (no `InsecureSkipVerify` anywhere). Web Push follows
  RFC 8291 (ECDH P-256 + HKDF-SHA-256) via standard libraries.
- **R6 (supply chain)**: dependencies are pinned via lockfiles and image
  digests (renovate keeps them fresh); CodeQL, Trivy, and OSV-Scanner run on
  every change and weekly. Reachability analysis (govulncheck) drives real
  response — e.g., pinning the Go toolchain to 1.26.5 resolved GO-2026-5856
  (crypto/tls).

### 4. Residual risks (honest limits)

- A solo maintainer means no independent two-person review; CodeQL, an ~80%
  statement-coverage test suite, fuzzing, and Scorecard partially compensate
  but are not equivalent.
- No external penetration test has been performed. Vulnerability reports are
  received through the private channel in [SECURITY.md](../.github/SECURITY.md).
- Session tokens live in browser `localStorage` — a trade-off that would expose
  them to a successful XSS; currently mitigated by the strict CSP and escaped
  rendering (no injection sinks). Migrating to httpOnly cookies is under
  consideration as a longer-term improvement.
- Availability is best-effort (hobby project).
