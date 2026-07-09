# Contributing

**한국어** · English below

## 한국어

### 환영합니다

이 프로젝트는 개인 취미 프로젝트로, 혼자 유지보수하고 있습니다. 기여는 언제든
환영하며, 이슈·PR에 대한 지원은 여력이 닿는 대로(best-effort) 진행됩니다. 응답이
늦더라도 양해해 주세요.

### 기여 방법

1. 저장소를 **fork** 합니다.
2. `dev` 브랜치에서 새 브랜치를 만들어 작업합니다.
3. `dev`를 대상으로 **Pull Request**를 엽니다. `main`은 릴리스 전용 브랜치이며,
   필수 CI 체크를 통과한 PR로만 병합됩니다.
4. 버그 신고와 기능 제안은 GitHub 이슈 템플릿을 이용해 주세요
   ([버그 신고](.github/ISSUE_TEMPLATE/bug_report.md) ·
   [기능 제안](.github/ISSUE_TEMPLATE/feature_request.md)).
5. 질문도 이슈로 남겨 주시면 됩니다.

### 요구사항 (받아들여지는 기여)

- **Go 코드**는 `gofmt`, `go vet`, `go build`(api/)를 통과해야 합니다.
- **웹 코드**는 `npm run lint`, `tsc --noEmit`, `npm run build`(web/)를 통과해야
  합니다.
- 시크릿이나 개인 경로를 포함하지 마세요(CI에서 gitleaks가 검사합니다).
- 의존성은 최소한으로 유지하고 버전을 고정합니다(업데이트는 Renovate가 관리합니다).

### 테스트 정책

주요 기능이 새로 추가되면, 그 기능에 대한 테스트를 자동화된 테스트 스위트에
**반드시(MUST)** 추가해야 합니다. Go 테스트는 `api/*_test.go`에 위치하며(퍼즈
테스트 포함), `go test ./...`로 실행합니다. 테스트 없이 기능을 추가하는 PR은
리뷰 과정에서 테스트 추가를 요청받게 되며, 이는 PR 체크리스트를 통해 코드
리뷰에서 확인합니다.

### 커밋·PR 스타일

- 커밋은 간결하고 원자적으로 작성해 주세요. 유지보수자는 한국어 제목을 사용하지만,
  외부 기여자는 영어로 작성해도 무방합니다.
- PR 설명은 한국어·영어 병기를 권장하지만, 영어만 작성해도 받아들여집니다.

### 버그 신고

- 일반 버그는 GitHub 이슈로 신고해 주세요.
- **보안 취약점은 [.github/SECURITY.md](.github/SECURITY.md)의 절차를 따라 주세요.**
  비공개 신고 경로로 접수하며, **공개 이슈로 열지 말아 주세요.**

## English

### Welcome

This is a personal hobby project, maintained solo. Contributions are welcome,
and support for issues and PRs is best-effort. Please bear with delayed replies.

### How to contribute

1. **Fork** the repository.
2. Create a branch from `dev` and do your work there.
3. Open a **Pull Request** targeting `dev`. `main` is release-only and merges
   via PR only after the required CI checks pass.
4. File bug reports and feature requests using the GitHub issue templates
   ([bug report](.github/ISSUE_TEMPLATE/bug_report.md) ·
   [feature request](.github/ISSUE_TEMPLATE/feature_request.md)).
5. Questions are welcome as issues too.

### Requirements (acceptable contributions)

- **Go code** must pass `gofmt`, `go vet`, and `go build` (api/).
- **Web code** must pass `npm run lint`, `tsc --noEmit`, and `npm run build`
  (web/).
- Do not include secrets or personal paths (gitleaks runs in CI).
- Keep dependencies minimal and pinned (Renovate manages updates).

### Test policy

As major new functionality is added, tests for it MUST be added to the automated
test suite. Go tests live in `api/*_test.go` (including fuzz tests) and run via
`go test ./...`. PRs that add functionality without tests will be asked to add
them; this is checked in code review via the PR checklist.

### Commit and PR style

- Keep commits concise and atomic. The maintainer uses Korean subjects, but
  English is perfectly fine for external contributors.
- Bilingual KO/EN PR descriptions are appreciated, but English-only is accepted.

### Reporting

- Report normal bugs as GitHub issues.
- **For security vulnerabilities, follow [.github/SECURITY.md](.github/SECURITY.md).**
  Use the private reporting URL and do NOT open public issues.
