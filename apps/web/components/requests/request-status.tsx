"use client";

import { Button, ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import type { Recovery } from "@/lib/requests/recovery";

const copy = {
  checking: ["계정을 확인하고 있어요.", "화면을 닫아도 서버에서 진행 중인 작업은 취소되지 않습니다."],
  succeeded: ["계정 확인을 마쳤어요.", "최신 계정 정보를 불러오고 있어요."],
  unresolved: ["처리 결과를 확인하지 못했어요.", "새 요청을 만들지 않고 기존 요청을 다시 확인할 수 있습니다."],
  reauth: ["다시 로그인이 필요해요.", "같은 계정으로 로그인하면 이전 요청을 이어서 확인합니다."],
  forbidden: ["이 계정을 확인할 수 없어요.", "현재 계정의 이용 권한을 확인해 주세요. 다른 계정으로 로그인할 수 있습니다."],
  expired: ["요청 결과 보관기간이 지났어요.", "이 요청을 다시 실행하지 않습니다. 현재 계정 상태를 확인해 주세요."],
  review: ["운영자의 확인이 필요해요.", "처리 결과가 확정되지 않았습니다. 반복 요청하지 말고 운영자에게 확인해 주세요."],
  conflict: ["요청 내용 확인이 필요해요.", "기존 요청과 내용이 달라 처리를 멈췄습니다. 현재 상태를 확인해 주세요."],
  failed: ["계정 확인을 완료하지 못했어요.", "입력 또는 서비스 상태를 확인해 주세요. 요청을 자동으로 반복하지 않습니다."],
} as const;
export function RequestStatus({ result, onRetry, onCurrent }: { result: Recovery; onRetry: () => void; onCurrent: () => void }) {
  const [title, description] = copy[result.state];
  const pending = result.state === "checking" || result.state === "succeeded";
  return <div className="request-status">
    <Notice title={title} tone={pending ? "info" : "warning"}>
      <p>{description}</p>
      {result.state === "checking" && Boolean(result.attempt) && <p className="hint">잠시 후 같은 요청을 확인합니다. ({result.attempt}/3)</p>}
    </Notice>
    <div className="actions">
      {result.state === "unresolved" && <Button onClick={onRetry}>기존 요청 다시 확인</Button>}
      {["expired", "conflict", "failed"].includes(result.state) && <Button onClick={onCurrent}>현재 계정 확인</Button>}
      {result.state === "reauth" && <ButtonLink href="/login">다시 로그인</ButtonLink>}
    </div>
  </div>;
}
