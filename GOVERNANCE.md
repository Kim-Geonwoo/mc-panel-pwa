# Governance

**한국어** · English below

## 한국어

### 모델

이 프로젝트는 **단독 유지보수자(solo-maintainer) 모델(BDFL, Benevolent Dictator
For Life)** 로 운영됩니다. 유지보수자(@Kim-Geonwoo)가 최종 의사결정을 내립니다.
이슈와 PR을 통한 의견 제시는 언제나 환영하며 진지하게 검토·반영합니다. 다만 개인
취미 프로젝트인 만큼 지원은 여력이 닿는 대로(best-effort) 이뤄집니다.

### 역할과 책임

- **유지보수자(Maintainer)**
  - PR 리뷰 및 병합
  - 릴리스 발행([SemVer](https://semver.org/lang/ko/) 태그)
  - [SECURITY.md](.github/SECURITY.md)에 명시된 타임라인에 따른 보안 대응
  - CI 유지 및 의존성 관리(Renovate 검토·승인)
- **기여자(Contributor)**
  - [CONTRIBUTING.md](CONTRIBUTING.md)의 절차를 따릅니다.
  - 기대할 수 있는 것: 이슈 트래커를 통한 응답(best-effort), 병합된 기여에 대한
    릴리스 노트 크레딧.

### 의사결정 절차

1. 변경은 `dev` 브랜치를 대상으로 하는 **PR**로 반영됩니다.
2. 필수 **CI 게이트**를 통과해야 합니다.
3. 릴리스는 `main`으로의 PR 병합을 통해 이뤄집니다.
4. 의견이 갈리는 사안은 유지보수자가 결정하며, 그 **사유를 해당 PR/이슈에 명시**합니다.

### 연속성 (접근 연속성과 버스 팩터)

- 모든 자산(코드, 문서, CI 설정)은 **MIT 라이선스**로 공개 GitHub 저장소에 있습니다.
  누구든지 **fork하여 이어갈 수 있습니다.**
- 이 프로젝트의 **버스 팩터(bus factor)는 1**이며, 이를 솔직하게 인정합니다.
- 이를 완화하기 위한 조치:
  - 완결된 공개 문서(README · CONTRIBUTING · SECURITY · 보안 보증 논증(assurance case))
  - 재현 가능한 빌드(의존성 버전 고정)
  - 개발에 **숨겨진 인프라가 필요 없음** — 공개 저장소만으로 전체 개발이 가능합니다.

## English

### Model

This is a **solo-maintainer project** run under a BDFL (Benevolent Dictator For
Life) model. The maintainer (@Kim-Geonwoo) makes final decisions. Input via
issues and PRs is always welcome and is seriously considered and incorporated.
As a personal hobby project, support is provided on a best-effort basis.

### Roles & responsibilities

- **Maintainer**
  - Review and merge PRs
  - Cut releases ([SemVer](https://semver.org/) tags)
  - Security response per the timelines in [SECURITY.md](.github/SECURITY.md)
  - CI and dependency upkeep (review/approve Renovate)
- **Contributors**
  - Follow [CONTRIBUTING.md](CONTRIBUTING.md).
  - What you can expect: a response via the issue tracker (best-effort), and
    credit in release notes for merged work.

### Decision process

1. Changes land via a **PR** targeting the `dev` branch.
2. They must pass the required **CI gates**.
3. Releases happen by merging a PR into `main`.
4. Disagreements are resolved by the maintainer's decision, **with reasons
   stated in the relevant PR/issue**.

### Continuity (access continuity & bus factor)

- All assets (code, docs, CI) live in the public GitHub repository under the
  **MIT license** — anyone can **fork and continue.**
- The **bus factor is 1**, and this is honestly acknowledged.
- Mitigations:
  - Complete public docs (README · CONTRIBUTING · SECURITY · the security
    assurance case)
  - A reproducible build (pinned dependencies)
  - **No hidden infrastructure is required to develop** — the public repository
    is sufficient for the full development workflow.
