# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Instead, report
privately through GitHub Security Advisories:

- **Report a vulnerability:** https://github.com/Kim-Geonwoo/mc-panel-pwa/security/advisories/new
- Or: Repository → **Security** tab → **Report a vulnerability**

### Disclosure process and timeline

1. **Acknowledgement** within **3 business days** of your report.
2. **Assessment and triage** within **7 days**, with a severity estimate and
   an initial remediation plan.
3. **Fix and coordinated disclosure**: we aim to release a fix within **30 days**
   for high/critical issues. Once the fix is released, the advisory is published
   publicly with credit to the reporter (if you want it), following a
   **90-day coordinated disclosure** cap.

There is no bug-bounty program; this is a personal project, but every report is
taken seriously and handled on the timeline above.

## How this project is hardened

- **Secret scanning**: GitHub native secret scanning + push protection, plus
  [gitleaks](workflows/gitleaks.yml) in CI (all-branch pushes) and as a local pre-commit hook.
- **SAST**: CodeQL (GitHub code scanning, default setup) for Go and JavaScript/TypeScript.
- **SCA**: [OSV-Scanner](workflows/osv-scanner.yml) (OSV.dev) over Go modules
  and the npm tree, plus [Trivy](workflows/trivy.yml) for filesystem + config —
  both upload SARIF to the repository Security tab.
- **Dependencies**: [Renovate](../renovate.json) keeps deps current. Patch/minor
  updates auto-merge **only after CI passes** and a **3-day release cooldown**
  (blunts hijacked/yanked-release windows); majors are reviewed manually.
- **Supply chain**: every GitHub Action is pinned to a commit SHA (Renovate
  `helpers:pinGitHubActionDigests`); workflows run with least-privilege
  `permissions:` (read-only by default, write scopes only where required).
- **Runtime**: the API binds to loopback **by default** behind a tunnel; sessions
  are server-side and revocable; all ingress text is sanitized before use. Failed
  logins are logged and can alert a Discord webhook (`PANEL_ALERT_WEBHOOK`) on
  brute-force patterns. Bot-facing internal endpoints live only on the loopback
  health listener and are never registered on the internet-exposed listener.

> Note: self-hosted CI runners are intentionally **not** used — on a public
> repository a fork PR could run arbitrary code on the runner. CI uses
> GitHub-hosted (ephemeral) runners only.
