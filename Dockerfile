# syntax=docker/dockerfile:1
# mc_sv-panel 멀티스테이지 빌드.
# 기본값은 데모 모드(PANEL_DEMO=true)라 그대로 실행하면 공개 데모로 동작한다:
#   docker build -t mc-panel-pwa . && docker run --rm -p 8080:8080 mc-panel-pwa
#   → http://localhost:8080 (로그인 코드 000000)
# 실제 배포에서는 PANEL_DEMO=false와 데이터 경로 환경변수를 주입한다(.env.example 참고).

FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM golang:1.26-alpine@sha256:0178a641fbb4858c5f1b48e34bdaabe0350a330a1b1149aabd498d0699ff5fb2 AS api
WORKDIR /src/api
COPY api/go.mod api/go.sum ./
RUN go mod download
COPY api/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/mc_sv-panel .

# CGO 없는 정적 바이너리 + 정적 자산만 필요하므로 distroless(비루트)로 최소화
FROM gcr.io/distroless/static-debian12:nonroot@sha256:b7bb25d9f7c31d2bdd1982feb4dafcaf137703c7075dbe2febb41c24212b946f
WORKDIR /app
COPY --from=api /out/mc_sv-panel /app/mc_sv-panel
COPY --from=web /src/web/out /app/web/out
# 컨테이너 안에서는 루프백 기본값이 의미가 없으므로 :8080으로 연다(포트 노출은 -p가 결정)
ENV PANEL_LISTEN=:8080 \
    PANEL_HEALTH_LISTEN=127.0.0.1:8099 \
    PANEL_STATIC_DIR=/app/web/out \
    PANEL_DEMO=true
EXPOSE 8080
# 루프백 헬스 리스너를 메인 바이너리의 healthcheck 모드로 조회 (셸 없는 distroless라 exec-form)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3   CMD ["/app/mc_sv-panel", "healthcheck"]
USER nonroot
ENTRYPOINT ["/app/mc_sv-panel"]
