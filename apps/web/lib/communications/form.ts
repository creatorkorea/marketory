export const typeLabels = {
  SELECTION: "선정 안내",
  WAITING: "대기 안내",
  REJECTION: "탈락 안내",
  CONFIRM: "참가확정 안내",
  BOOTH: "부스 안내",
  NEED_INFO: "보완 요청 안내",
  NOTICE: "일반 안내",
};
export type Kind = keyof typeof typeLabels;
export const statusLabels: Record<string, string> = {
  DRAFT: "초안",
  READY: "승인 완료",
  QUEUED: "발송 대기",
  SENDING: "발송 중",
  SENT: "제공사 접수 완료",
  FAILED: "발송 실패",
  UNKNOWN: "결과 확인 필요",
};
export const outcomeLabels = {
  ACCEPTED: "제공사 접수 확인",
  NOT_ACCEPTED: "미접수 확인",
  INCONCLUSIVE: "확인 불가",
};
export type Outcome = keyof typeof outcomeLabels;
export type Target = {
  application_id: string;
  shop_name: string;
  status: string;
  notification_email: string;
  has_booth: boolean;
};
export type Message = {
  communication_id: string;
  project_id: string;
  application_id: string;
  type: Kind;
  subject: string;
  body: string;
  recipient_snapshot: string;
  send_status: string;
  version: number;
  content_version: number;
  approved_version: number | null;
  approved_at: string | null;
  sent_at: string | null;
  queued_at?: string | null;
  queued_by?: string | null;
  failure_reason: string | null;
  supersedes_id: string | null;
  superseded_at: string | null;
  created_at: string;
  allowed_actions: string[];
  attempts: {
    attempt_id: string;
    attempt_no: number;
    status: string;
    provider_message_id: string | null;
    error_code: string | null;
    error_message?: string | null;
    started_at: string;
    completed_at: string | null;
  }[];
  resolutions: {
    resolution_id: string;
    attempt_id: string;
    outcome: Outcome;
    evidence_ref: string;
    reason: string;
    resolved_at: string;
    resolved_by: string;
  }[];
};
export type MessageList = {
  items: Message[];
  total: number;
  limit: number;
  offset: number;
  project: { project_id: string; name: string };
  delivery_enabled: boolean;
};
export class FormError extends Error {
  constructor(
    public field: string,
    message: string,
  ) {
    super(message);
  }
}
export function required(
  value: string,
  field: string,
  label: string,
  max = 2000,
) {
  if (!value.trim()) throw new FormError(field, `${label}을 입력해 주세요.`);
  if (value.length > max)
    throw new FormError(
      field,
      `${max.toLocaleString("ko-KR")}자 이내로 입력해 주세요.`,
    );
  return value.trim();
}
export function kindsFor(target?: Target): Kind[] {
  if (!target || ["DRAFT", "CANCELLED"].includes(target.status)) return [];
  return (Object.keys(typeLabels) as Kind[]).filter(
    (kind) =>
      kind === "NOTICE" ||
      ({
        SELECTION: "APPROVED",
        WAITING: "WAITING",
        REJECTION: "REJECTED",
        CONFIRM: "CONFIRMED",
        BOOTH: "CONFIRMED",
        NEED_INFO: "NEED_INFO",
      }[kind] === target.status &&
        (kind !== "BOOTH" || target.has_booth)),
  );
}
export function revisionPayload(
  message: Message,
  subject: string,
  body: string,
  reason: string,
) {
  return {
    expected_version: message.version,
    subject: required(subject, "subject", "제목", 200),
    body: required(body, "body", "본문", 50000),
    reason: required(reason, "reason", "처리 사유"),
  };
}
export function resolutionPayload(
  message: Message,
  outcome: Outcome,
  evidence: string,
  reason: string,
) {
  const attempt = message.attempts.at(-1);
  if (message.send_status !== "UNKNOWN" || !attempt)
    throw new FormError(
      "evidence",
      "현재 결과 확인이 필요한 발송 시도가 없어요.",
    );
  return {
    expected_version: message.version,
    attempt_id: attempt.attempt_id,
    method: "MANUAL_EVIDENCE",
    outcome,
    evidence_ref: required(evidence, "evidence", "확인 근거"),
    reason: required(reason, "reason", "처리 사유"),
  };
}
export function listQuery(values: {
  limit?: string | string[];
  offset?: string | string[];
}) {
  const limit = [10, 20, 50].includes(Number(values.limit))
    ? Number(values.limit)
    : 20;
  const offset =
    /^\d+$/.test(String(values.offset)) &&
    Number.isSafeInteger(Number(values.offset))
      ? Number(values.offset)
      : 0;
  return `limit=${limit}&offset=${offset}`;
}
