#!/usr/bin/env bash
# demo/run-demo.sh — 현재 main 소스를 그대로 빌드해 데모 모드로 실행하는 얇은 런처.
# 저장소 루트의 build.sh와 api 바이너리를 재사용하므로 코드 중복이 없다(anti-drift):
# 기능이 바뀌면 이 데모에도 자동으로 반영된다. 어느 디렉터리에서 실행해도 동작한다.
set -euo pipefail

# 스크립트 위치로 저장소 루트를 확정한다(현재 작업 디렉터리와 무관).
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"

BIN="$REPO/api/mc_sv-panel"
STATIC="$REPO/web/out"
URL="http://127.0.0.1:8081"

# 데모가 실제 데이터에 절대 손대지 않도록 격리된 임시 데이터 경로를 쓴다.
# 데모 모드는 in-memory 샘플 데이터만 쓰므로 실제로 파일을 남기지 않지만, 방어적으로 분리한다.
TMP="$(mktemp -d)"
mkdir -p "$TMP/bridge" "$TMP/mc"

PANEL_PID=""
cleanup() {
  # 백그라운드 패널을 종료하고 임시 데이터를 정리한다.
  if [[ -n "$PANEL_PID" ]] && kill -0 "$PANEL_PID" 2>/dev/null; then
    kill "$PANEL_PID" 2>/dev/null || true
    wait "$PANEL_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup INT TERM EXIT

# 1) 현재 main 소스를 빌드한다(web/out 정적 익스포트 + api 바이너리).
#    build.sh는 마지막에 "서비스 재시작" 힌트를 출력하지만, 데모 실행에는 해당하지 않으니 무시한다.
echo "[demo] build: 저장소 루트 build.sh 재사용"
"$REPO/build.sh"

# 2) 데모 모드로 패널을 실행한다. 헬스 리스너도 데모 전용 포트로 옮겨
#    같은 호스트에서 돌고 있을지 모를 운영 인스턴스(:8099)와 충돌하지 않게 한다.
echo "[demo] run: $URL (로그인 코드 000000)"
PANEL_DEMO=true \
PANEL_LISTEN=127.0.0.1:8081 \
PANEL_STATIC_DIR="$STATIC" \
PANEL_HEALTH_LISTEN=127.0.0.1:8098 \
PANEL_BRIDGE_DIR="$TMP/bridge" \
PANEL_MC_DATA_DIR="$TMP/mc" \
  "$BIN" &
PANEL_PID=$!

echo
echo "  데모 패널이 실행 중입니다 / Demo panel is running:"
echo "    URL        : $URL"
echo "    로그인 코드 / login code : 000000"
echo "  종료하려면 Ctrl-C 를 누르세요 / press Ctrl-C to stop."
echo

# 패널 프로세스가 끝날 때까지 대기한다(Ctrl-C 시 trap이 정리를 맡는다).
wait "$PANEL_PID"
