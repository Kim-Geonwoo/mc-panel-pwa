## 무엇을·왜 / What & why

<!-- 변경 내용과 동기를 간단히 적어 주세요. / Briefly describe the change and the motivation. -->

## 변경 사항 / Changes

-

## 체크리스트 / Checklist

- [ ] `gofmt` 통과, `go vet` 통과, `go build` 성공 (api/) / `gofmt` clean, `go vet` passes, `go build` succeeds (api/)
- [ ] `npm run lint`·`tsc --noEmit` 통과, `npm run build` 성공 (web/) / `npm run lint` and `tsc --noEmit` pass, `npm run build` succeeds (web/)
- [ ] 시크릿·개인 경로 추가 없음 (gitleaks 통과) / No secrets or personal paths added (gitleaks clean)
- [ ] 설정 변경 시 문서·`.env.example` 갱신 / Docs / `.env.example` updated if config changed
