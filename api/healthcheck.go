package main

// 컨테이너 HEALTHCHECK 모드: `mc_sv-panel healthcheck`로 실행하면 자기 자신의
// 루프백 헬스 리스너(/healthz)를 조회해 종료 코드로 결과를 알립니다.
// distroless 이미지에는 셸·curl이 없으므로 메인 바이너리를 exec-form으로
// 재사용하는 것이 가장 작은 해법입니다. (Trivy DS-0026)

import (
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

// runHealthcheck는 /healthz가 200이면 0, 아니면 1을 돌려줍니다.
func runHealthcheck() int {
	addr := getenv("PANEL_HEALTH_LISTEN", "127.0.0.1:8099")
	if strings.HasPrefix(addr, ":") {
		addr = "127.0.0.1" + addr // ":8099"처럼 호스트 생략 시 루프백으로
	}
	c := &http.Client{Timeout: 3 * time.Second}
	resp, err := c.Get("http://" + addr + "/healthz")
	if err != nil {
		fmt.Fprintf(os.Stderr, "healthcheck: %v\n", err)
		return 1
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		fmt.Fprintf(os.Stderr, "healthcheck: status %d\n", resp.StatusCode)
		return 1
	}
	return 0
}
