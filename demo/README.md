# 데모 실행 키트 / Demo run kit

**한국어** · English below

## 한국어

이 폴더는 별도의 백엔드(디스코드 봇·게임 서버) 없이 패널을 그대로 체험할 수 있는
**데모 실행 키트**입니다. 데모 모드(`PANEL_DEMO=true`)로 띄우면 내장 샘플 데이터가
제공되며, 로그인 코드는 **`000000`** 입니다.

이 키트는 새 코드를 담지 않는 **얇은 런처**입니다. 저장소 루트의 `build.sh`와 데모 소스
(`api/demo.go`)를 그대로 재사용하므로, 항상 **현재 main 소스**를 빌드해 실행합니다.
따라서 기능이 바뀌면 데모에도 자동으로 반영되며, CI의 `demo-smoke` 게이트가 데모가
계속 동작함을 보장합니다.

### 실행 방법 (두 가지)

**1) 네이티브 실행** — Go·Node 툴체인이 준비된 환경에서:

```bash
./run-demo.sh
# http://127.0.0.1:8081 접속 — 로그인 코드: 000000
# 종료: Ctrl-C
```

`run-demo.sh`는 저장소 루트를 스스로 찾으므로 어느 디렉터리에서 실행해도 됩니다. 빌드
후 데모 모드로 패널을 띄우고, 실제 데이터에 손대지 않도록 격리된 임시 경로를 사용합니다.

**2) Docker 실행** — 툴체인 설치 없이:

```bash
docker compose up --build
# http://127.0.0.1:8081 접속 — 로그인 코드: 000000
```

## English

This folder is a **demo run kit** that lets you try the panel as-is, with no
separate backend (Discord bot or game server). Started in demo mode
(`PANEL_DEMO=true`) it serves built-in sample data, and the login code is
**`000000`**.

The kit is a **thin launcher** that contains no new code. It reuses the
repository-root `build.sh` and the demo source (`api/demo.go`), so it always
builds and runs the **current main source**. Feature changes are therefore
reflected in the demo automatically, and CI's `demo-smoke` gate keeps the demo
working.

### How to run (two ways)

**1) Native** — on an environment with the Go and Node toolchains:

```bash
./run-demo.sh
# open http://127.0.0.1:8081  — login code: 000000
# stop: Ctrl-C
```

`run-demo.sh` resolves the repository root by itself, so it runs from any
directory. It builds, launches the panel in demo mode, and uses isolated
temporary paths so real data is never touched.

**2) Docker** — with no toolchain installed:

```bash
docker compose up --build
# open http://127.0.0.1:8081  — login code: 000000
```
