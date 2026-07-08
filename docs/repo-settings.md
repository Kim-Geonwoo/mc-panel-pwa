# 레포 설정 체크리스트

코드 밖(GitHub 설정)에 있는 전제들이라, 레포를 포크/이전하거나 새로 세팅할 때
아래를 재현해야 CI·자동화가 문서대로 동작한다.

## 브랜치·머지 규칙

- [ ] 기본 브랜치 `main` 유지 (작업은 `dev` → PR로만 `main` 병합)
- [ ] `main` 룰셋(Repository rules) 활성:
  - `pull_request` 필수 (직접 push 금지)
  - `required_status_checks`: **Go API (vet · fmt · build)** · **Next.js (typecheck · build)** · **Analyze (go)** · **Analyze (javascript-typescript)**
  - `non_fast_forward`(force-push 차단) · `deletion` 차단
  - bypass 대상 없음 (소유자도 우회 불가)
- [ ] Allow auto-merge 활성 — Renovate `platformAutomerge`의 전제

## 보안 기능

- [ ] Secret scanning + Push protection 활성 (공개 레포 무료)
- [ ] Code scanning: **CodeQL default setup** 활성 — 분석 브랜치에 `dev` 포함 확인
- [ ] Private vulnerability reporting 활성 (SECURITY.md가 이 경로를 안내)
- [ ] Dependabot alerts는 꺼도 무방 (Renovate + OSV/Trivy가 담당)

## 봇·앱

- [ ] Renovate GitHub App 설치 (`renovate.json`이 설정 소스)
- [ ] Copilot code review 사용 가능하면 PR 자동 리뷰 활성
- [ ] Actions 권한: 기본 `contents: read` (워크플로별 `permissions:`가 최소권한을 명시)

## 운영 전제 (레포 밖)

- 프로덕션은 `main` 머지 후 서버에서 `build.sh` → `systemctl --user restart dc-panel-api`
- 봇(비공개)은 별도 코드베이스 — 패널과는 루프백 내부 API(`/internal/*`)와
  0600 공유 파일로만 연동
