export type Audience = "CONFIRMED" | "ALL_APPLICANTS";
export type Announcement = {
  announcement_id: string;
  project_id: string;
  subject: string;
  body: string;
  audience: Audience;
  version: number;
  content_version: number;
  approved_version: number | null;
  allowed_actions: string[];
  publication: null | {
    subject: string;
    body: string;
    audience: Audience;
    content_version: number;
    published_at: string;
    withdrawn_at: string | null;
  };
};
export const audienceLabels = {
  CONFIRMED: "참가확정자",
  ALL_APPLICANTS: "전체 신청자",
};
export function announcementPayload(
  subject: string,
  body: string,
  audience: string,
  reason: string,
  version?: number,
) {
  subject = subject.trim();
  body = body.trim();
  reason = reason.trim();
  if (!subject || subject.length > 200)
    throw new Error("제목은 1~200자로 입력해 주세요.");
  if (!body || body.length > 50000)
    throw new Error("본문은 1~50,000자로 입력해 주세요.");
  if (!(audience in audienceLabels))
    throw new Error("공개 대상을 선택해 주세요.");
  if (!reason || reason.length > 500)
    throw new Error("처리 사유는 1~500자로 입력해 주세요.");
  if (version !== undefined && (!Number.isInteger(version) || version < 1))
    throw new Error("최신 안내를 다시 확인해 주세요.");
  return {
    subject,
    body,
    audience,
    reason,
    ...(version === undefined ? {} : { expected_version: version }),
  };
}
