#!/usr/bin/env bash
# mc_sv-panel 빌드: Next.js 정적 익스포트(web/out) + Go 바이너리(api/mc_sv-panel).
# Node와 Go는 ~/.local 아래 유저 레벨로 설치되어 있다(시스템 Node 런타임 불필요).
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
echo "        then restart your panel service, e.g.: systemctl --user restart dc-panel-api"
