# 릴리스 태그 서명 (Release Tag Signing)

**한국어** | [English below](#english)

이 프로젝트의 릴리스 태그(v*)는 유지보수자의 전용 SSH 키(Ed25519)로 암호학적으로
서명됩니다. 릴리스는 빌드 산출물 없이 소스 전용 git 태그로 배포되므로, 태그 서명이
곧 릴리스 서명입니다.

## 서명 공개키

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGJeJs8teL2NxovCnJcLC4XffQ/uHV/qVkZiuErgIqbi mc-panel-pwa tag signing (maintainer)
```

## 검증 방법

```bash
git clone https://github.com/Kim-Geonwoo/mc-panel-pwa && cd mc-panel-pwa
git config gpg.ssh.allowedSignersFile docs/allowed_signers
git verify-tag v0.1.0
# 출력에 "Good \"git\" signature" 가 표시되면 검증 성공
```

허용 서명자 목록은 [docs/allowed_signers](allowed_signers)에 있으며, 이 파일과
공개키의 진본성은 저장소 이력(서명 도입 커밋과 그 이후의 보호된 main 브랜치)으로
보증됩니다.

## 컨테이너 이미지 서명

릴리스 태그마다 게시되는 GHCR 이미지(`ghcr.io/kim-geonwoo/mc-panel-pwa`)는
cosign keyless(OIDC)로 digest 기준 서명되며 SLSA provenance 증명이 함께 게시된다.
검증:

```bash
cosign verify ghcr.io/kim-geonwoo/mc-panel-pwa:latest \
  --certificate-identity-regexp "^https://github.com/Kim-Geonwoo/mc-panel-pwa/" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

---

## English

Release tags (v*) of this project are cryptographically signed with the
maintainer's dedicated SSH key (Ed25519). Releases are source-only git tags
(no built artifacts), so the tag signature is the release signature.

### Signing public key

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGJeJs8teL2NxovCnJcLC4XffQ/uHV/qVkZiuErgIqbi mc-panel-pwa tag signing (maintainer)
```

### How to verify

```bash
git clone https://github.com/Kim-Geonwoo/mc-panel-pwa && cd mc-panel-pwa
git config gpg.ssh.allowedSignersFile docs/allowed_signers
git verify-tag v0.1.0
# "Good \"git\" signature" indicates successful verification
```

The allowed-signers list lives in [docs/allowed_signers](allowed_signers); its
authenticity is anchored by the repository history (the commit introducing
signing and the protected main branch thereafter).

### Container image signing

GHCR images published per release tag (`ghcr.io/kim-geonwoo/mc-panel-pwa`) are
signed by digest with cosign keyless (OIDC) and shipped with SLSA provenance
attestations. Verify:

```bash
cosign verify ghcr.io/kim-geonwoo/mc-panel-pwa:latest \
  --certificate-identity-regexp "^https://github.com/Kim-Geonwoo/mc-panel-pwa/" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```
