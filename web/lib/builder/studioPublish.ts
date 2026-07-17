// 발행 사전검사와 발행 에러 → 안내 문구 키 매핑 — 순수 함수(단위 테스트 대상).
// 사전검사는 서버(parseLayout과 동일 계약)가 400으로 거부할 드래프트를 발행 전에
// 걸러 발행 버튼을 비활성화하기 위한 것이다. 한도는 schema.ts의 상한과 짝을 이룬다.
import { LayoutPutError, UnauthorizedError } from "../api";
import { countNodes, maxDepth } from "./editOps";
import { parseLayout, type Block, type Layout } from "./schema";

const NODE_LIMIT = 500;
const DEPTH_LIMIT = 20;

export type PublishCheck = { ok: true } | { ok: false; reasonKey: string };

// 발행 가능 여부를 판정한다. 실패 시 reasonKey는 i18n 사전의 studio.check.* 키.
// screen과 각 탭 content 블록을 개별 트리로 검사한다(parseLayout의 계수 방식과 동일).
export function validateForPublish(l: Layout): PublishCheck {
  const trees: Block[] = [];
  if (l.screen) trees.push(l.screen);
  for (const tab of l.tabs ?? []) for (const c of tab.content ?? []) trees.push(c);
  for (const b of trees) {
    if (countNodes(b) > NODE_LIMIT) return { ok: false, reasonKey: "studio.check.nodes" };
    if (maxDepth(b) > DEPTH_LIMIT) return { ok: false, reasonKey: "studio.check.depth" };
  }
  // 구조·타입·길이 등 나머지 계약 위반의 안전망 — UI 입력 검증을 뚫은 값을 잡는다.
  if (!parseLayout(l)) return { ok: false, reasonKey: "studio.check.schema" };
  return { ok: true };
}

// putLayout 실패를 안내 문구 키로 바꾼다. 미지의 오류(네트워크 등)는 일반 실패로 수렴.
export function publishErrorKey(e: unknown): string {
  if (e instanceof UnauthorizedError) return "studio.publish.errAuth";
  if (e instanceof LayoutPutError) {
    if (e.status === 403 && e.code === "demo") return "studio.publish.errDemo";
    if (e.status === 403) return "studio.publish.errForbidden";
    if (e.status === 400) return "studio.publish.errInvalid";
    if (e.status === 429) return "studio.publish.errSlowDown";
  }
  return "studio.publish.errFailed";
}
