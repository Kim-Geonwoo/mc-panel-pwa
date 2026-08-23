#!/usr/bin/env bash
# mc_sv-panel 빌드: Next.js 정적 익스포트(web/out) + Go 바이너리(api/mc_sv-panel).
# 아래 PATH·GOPATH 설정은 유지보수자 환경(~/.local 유저 레벨 설치) 기준이다.
# 시스템에 Node·Go가 이미 있다면 이 줄들을 지우고 써도 된다.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
export PATH="$HOME/.local/node/bin:$HOME/.local/go/bin:$PATH"
export GOPATH="$HOME/go" GOCACHE="$HOME/.cache/go-build"

echo "[build] web → static export (web/out)"
cd "$HERE/web"
npm ci --no-audit --no-fund
npm run build

echo "[build] api → Go binary (api/mc_sv-panel)"
cd "$HERE/api"
go build -o mc_sv-panel .

echo "[build] done."
echo "        then restart your panel service, e.g.: systemctl --user restart mc-panel-api"
