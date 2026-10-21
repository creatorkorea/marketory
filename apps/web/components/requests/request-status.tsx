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
export function RequestStatus({ result, onRetry, onCurrent, business = false, subject = "마켓", loginHref = "/login" }: { result: Recovery; onRetry: () => void; onCurrent: () => void; business?: boolean; subject?: "마켓" | "신청" | "셀러 프로필" | "파일"; loginHref?: string }) {
  const businessCopy: Partial<Record<Recovery["state"], readonly [string,string]>> = {
    checking:["저장 결과를 확인하고 있어요.","같은 요청을 확인하고 있습니다. 화면을 닫아도 서버 작업은 취소되지 않습니다."],
    succeeded:["저장했어요.","최신 내용을 불러오고 있습니다."],
    conflict:["다른 변경이 있어 저장을 멈췄어요.","입력은 유지됩니다. 최신 내용을 확인한 뒤 변경 사항을 다시 검토해 주세요."],
    forbidden:[`${subject} 변경 권한이 없어요.`,"권한이 변경되었을 수 있습니다. 관리자에게 확인해 주세요."],
    failed:["저장하지 못했어요.",typeof result.body?.message === "string" ? result.body.message : "입력과 현재 이용 조건을 확인해 주세요."],
    expired:["요청 결과 보관기간이 지났어요.",`자동으로 다시 실행하지 않습니다. 현재 ${subject} 상태를 확인해 주세요.`],
  };
  const [title, description] = (business && businessCopy[result.state]) || copy[result.state];
  const pending = result.state === "checking" || result.state === "succeeded";
  return <div className="request-status">
    <Notice title={title} tone={pending ? "info" : "warning"}>
      <p>{description}</p>
      {result.state === "checking" && Boolean(result.attempt) && <p className="hint">잠시 후 같은 요청을 확인합니다. ({result.attempt}/3)</p>}
    </Notice>
    <div className="actions">
      {result.state === "unresolved" && <Button onClick={onRetry}>기존 요청 다시 확인</Button>}
      {["expired", "conflict", "failed"].includes(result.state) && <Button onClick={onCurrent}>{business ? `최신 ${subject} 확인` : "현재 계정 확인"}</Button>}
      {result.state === "reauth" && <ButtonLink href={loginHref} {...(business ? {target:"_blank",rel:"noopener"}: {})}>다시 로그인{business ? " (새 탭)" : ""}</ButtonLink>}
      {business && result.state === "reauth" && <Button onClick={onRetry}>로그인 후 결과 확인</Button>}
    </div>
  </div>;
}
