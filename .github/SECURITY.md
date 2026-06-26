# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Instead, use
GitHub's private vulnerability reporting:

> Repository → **Security** tab → **Report a vulnerability**

You'll get an acknowledgement as soon as possible. Once a fix is ready and
released, the report is disclosed publicly with credit (if you want it).

## How this project is hardened

- **Secret scanning**: GitHub native secret scanning + push protection, plus
  [gitleaks](.github/workflows/gitleaks.yml) in CI and as a local pre-commit hook.
- **SAST**: CodeQL (GitHub code scanning, default setup) for Go and JavaScript/TypeScript.
- **SCA**: [OSV-Scanner](.github/workflows/osv-scanner.yml) (OSV.dev) over Go modules
  and the npm tree, plus [Trivy](.github/workflows/trivy.yml) for filesystem + config.
- **Dependencies**: [Renovate](../renovate.json) keeps deps current. Patch/minor
  updates auto-merge **only after CI passes** and a **3-day release cooldown**
  (blunts hijacked/yanked-release windows); majors are reviewed manually.
- **Supply chain**: every GitHub Action is pinned to a commit SHA (Renovate
  `helpers:pinGitHubActionDigests`); workflows run with least-privilege
  `permissions:` (read-only by default, write scopes only where required).
- **Runtime**: the API binds to loopback behind a tunnel; sessions are
  server-side and revocable; all ingress text is sanitized before use.

> Note: self-hosted CI runners are intentionally **not** used — on a public
> repository a fork PR could run arbitrary code on the runner. CI uses
> GitHub-hosted (ephemeral) runners only.
