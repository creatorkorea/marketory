import { FormError, parseKst } from "../markets/form";
import { applicationLabels, type Application } from "../seller/form";
export { FormError, applicationLabels };

export type ReviewApplication = Omit<Application, "project"> & {
  project: {
    project_id: string;
    name: string;
    status: string;
    event_end_at: string;
    target_team_count: number;
    policy_json: { allowed_categories: string[] };
  };
  seller: {
    shop_name: string;
    owner_name: string;
    phone: string;
    email: string;
  };
  role: "OPERATOR" | "REVIEWER";
  capacity: { occupied: number; target: number };
  waiting_rank?: number | null;
  confirm_due_at?: string | null;
  notes: {
    note_id: string;
    body: string;
    created_at: string;
    author_id: string;
  }[];
  history: {
    history_id: string;
    from_status: string;
    to_status: string;
    reason: string;
    created_at: string;
  }[];
  notice_drafts?: { kind: string; body: string; created_at: string }[];
};
export const reviewActions: Record<
  string,
  { label: string; route: string; operation: string }
> = {
  start_review: {
    label: "수동 검토 시작",
    route: "start-review",
    operation: "reviews.start",
  },
  request_info: {
    label: "보완 요청",
    route: "request-info",
    operation: "reviews.request_info",
  },
  extend_info: {
    label: "보완기한 연장",
    route: "extend-info",
    operation: "reviews.extend_info",
  },
  approve: { label: "선정", route: "decision", operation: "reviews.decision" },
  wait: { label: "대기", route: "decision", operation: "reviews.decision" },
  reject: { label: "탈락", route: "decision", operation: "reviews.decision" },
  promote: {
    label: "대기자 선정",
    route: "decision",
    operation: "reviews.decision",
  },
  extend_confirmation: {
    label: "참가확정 기한 연장",
    route: "extend-confirmation",
    operation: "reviews.extend_confirmation",
  },
  confirm: {
    label: "참가확정 대리 기록",
    route: "confirm",
    operation: "applications.confirm",
  },
  note: { label: "내부 메모 저장", route: "notes", operation: "reviews.note" },
};
export const reviewFields: Record<string, string> = {
  product_name: "상품명",
  product_desc: "상품 소개",
  price_range: "가격대",
  category: "카테고리",
  electricity_required: "전기 필요",
  table_count: "테이블 개수",
  fire_required: "화기 사용",
  cold_storage_required: "냉장 보관",
  vehicle_entry_required: "차량 진입",
  request_note: "요청 사항",
  product_images: "상품 사진",
  business_document: "사업자 증빙",
};
export function reviewQuery(
  input: Record<string, string | string[] | undefined>,
) {
  const q = new URLSearchParams();
  if (
    typeof input.status === "string" &&
    input.status !== "DRAFT" &&
    applicationLabels[input.status]
  )
    q.set("status", input.status);
  if (typeof input.category === "string" && input.category.trim())
    q.set("category", input.category.trim().slice(0, 100));
  const limit = [10, 20, 50].includes(Number(input.limit))
    ? Number(input.limit)
    : 20;
  const n = Number(input.offset ?? 0);
  q.set("limit", String(limit));
  q.set(
    "offset",
    String(
      Number.isSafeInteger(n) && n >= 0 && n <= 1000000
        ? Math.floor(n / limit) * limit
        : 0,
    ),
  );
  return q.toString();
}
export function reviewPayload(
  action: string,
  form: FormData,
  app: ReviewApplication,
): Record<string, unknown> {
  const text = (key: string) => String(form.get(key) ?? "").trim();
  const payload: Record<string, unknown> = { expected_version: app.version };
  if (action === "note") {
    if (!text("body") || text("body").length > 4000)
      throw new FormError("body", "메모를 1~4,000자로 입력해 주세요.");
    return { ...payload, body: text("body") };
  }
  if (!text("reason"))
    throw new FormError("reason", "처리 사유를 입력해 주세요.");
  payload.reason = text("reason");
  if (["approve", "promote", "wait", "reject"].includes(action))
    payload.decision =
      action === "wait"
        ? "WAITING"
        : action === "reject"
          ? "REJECTED"
          : "APPROVED";
  if (
    [
      "request_info",
      "extend_info",
      "approve",
      "promote",
      "extend_confirmation",
    ].includes(action)
  ) {
    let deadline: string;
    try {
      deadline = parseKst(text("deadline"));
    } catch (e) {
      throw new FormError("deadline", (e as Error).message);
    }
    if (
      Date.parse(deadline) <= Date.now() ||
      Date.parse(deadline) >= Date.parse(app.project.event_end_at)
    )
      throw new FormError(
        "deadline",
        "현재 이후, 행사 종료 이전의 기한을 입력해 주세요.",
      );
    const old =
      action === "extend_info"
        ? app.info_due_at
        : action === "extend_confirmation"
          ? app.confirm_due_at
          : null;
    if (old && Date.parse(deadline) <= Date.parse(old))
      throw new FormError("deadline", "기존 기한보다 늦게 설정해 주세요.");
    payload[
      action === "request_info" || action === "extend_info"
        ? "info_due_at"
        : "confirm_due_at"
    ] = deadline;
  }
  if (action === "request_info") {
    const fields = [...new Set(form.getAll("fields").map(String))];
    if (!fields.length || fields.some((f) => !reviewFields[f]))
      throw new FormError("fields", "보완할 항목을 하나 이상 선택해 주세요.");
    payload.fields = fields;
  }
  if (action === "wait") {
    const rank = Number(text("rank"));
    if (!/^\d+$/.test(text("rank")) || !Number.isSafeInteger(rank) || rank < 1)
      throw new FormError("rank", "대기 순위를 1 이상의 정수로 입력해 주세요.");
    payload.waiting_rank = rank;
  }
  return payload;
}
