import { FormError } from "../markets/form";
export { FormError };
export type Seller = {
  seller_id: string;
  user_id: string;
  name: string;
  shop_name: string;
  owner_name: string;
  phone: string;
  business_no: string | null;
  sns_url: string | null;
  base_category: string;
  base_product_desc: string;
  version: number;
};
export type PublicProject = {
  project_id: string;
  name: string;
  venue: string;
  event_date: string;
  recruit_start_at: string;
  recruit_end_at: string;
  event_end_at: string;
  status: string;
  accepting_applications?: boolean;
  policy_version: number;
  policy_json: {
    allowed_categories: string[];
    restricted_items: string[];
    photo_required: boolean;
    business_required: boolean;
    participation_fee_krw: number;
    consent_version: string;
    consent_text: string;
  };
  booth_policy_json: { description: string };
};
export type Attachment = {
  attachment_id: string;
  file_type: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
};
export type Application = {
  booth?: {
    booth_id: string;
    booth_no: string;
    zone: string | null;
    electricity_available: boolean;
    fire_allowed: boolean;
    cold_storage_available: boolean;
    vehicle_access: boolean;
    table_capacity: number | null;
    confirmed_at: string;
  } | null;
  confirm_due_at?: string | null;
  confirmed_at?: string | null;
  application_id: string;
  project_id: string;
  status: string;
  version: number;
  revision_no: number;
  product_name: string;
  product_desc: string;
  price_range: string;
  category: string;
  electricity_required: boolean;
  table_count: number;
  fire_required: boolean;
  cold_storage_required: boolean;
  vehicle_entry_required: boolean;
  request_note: string;
  project: PublicProject;
  attachments: Attachment[];
  allowed_actions: string[];
  pending_uploads?: PendingUpload[];
  info_requests_json?: { field: string; reason: string }[];
  info_due_at?: string | null;
  submitted_at?: string | null;
  receipt_no?: string | null;
};
export type UploadPolicy = {
  max_size_bytes: number;
  max_product_images: number;
  max_business_documents: number;
  product_image_mime_types: string[];
  business_document_mime_types: string[];
  upload_origin?: string;
};
export type PendingUpload = {
  upload_intent_id: string;
  field_code: string;
  original_name: string;
  expires_at: string;
  application_version: number;
  revision_no: number;
};
export function trustedUploadUrl(value: string, origin: string | undefined) {
  if (!origin)
    throw new Error(
      "파일 전송 주소를 확인하지 못했습니다. 미완료 선택을 해제하고 다시 시도해 주세요.",
    );
  const url = new URL(value),
    trusted = new URL(origin);
  if (
    url.origin !== trusted.origin ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      ))
  )
    throw new Error(
      "허용되지 않은 파일 전송 주소입니다. 미완료 선택을 해제해 주세요.",
    );
  return url.href;
}
export const applicationLabels: Record<string, string> = {
  DRAFT: "작성 중",
  SUBMITTED: "접수 완료",
  NEED_INFO: "보완 필요",
  REVIEWING: "검토 중",
  APPROVED: "선정",
  WAITING: "대기",
  REJECTED: "탈락",
  CONFIRMED: "참가 확정",
  CANCELLED: "취소",
};
export function internalReturn(value?: string) {
  return value &&
    /^\/p\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/apply$/i.test(
      value,
    )
    ? value
    : undefined;
}
const text = (f: FormData, name: string) => String(f.get(name) ?? "").trim();
export function profilePayload(f: FormData) {
  const required = (name: string) => {
    const v = text(f, name);
    if (!v) throw new FormError(name, "필수 항목을 입력해 주세요.");
    return v;
  };
  const phone = required("phone");
  if (!/^\+?[0-9 ()-]{8,25}$/.test(phone))
    throw new FormError("phone", "연락 가능한 전화번호를 입력해 주세요.");
  const business = text(f, "business_no").replaceAll("-", "");
  if (business && !/^\d{10}$/.test(business))
    throw new FormError("business_no", "사업자번호 10자리를 입력해 주세요.");
  const sns = text(f, "sns_url");
  if (sns) {
    try {
      if (!["https:", "http:"].includes(new URL(sns).protocol))
        throw new Error();
    } catch {
      throw new FormError("sns_url", "http 또는 https 주소를 입력해 주세요.");
    }
  }
  return {
    name: required("name"),
    shop_name: required("shop_name"),
    owner_name: required("owner_name"),
    phone,
    business_no: business || null,
    sns_url: sns || null,
    base_category: text(f, "base_category") || null,
    base_product_desc: text(f, "base_product_desc") || null,
  };
}
export const applicationFields = [
  "product_name",
  "product_desc",
  "price_range",
  "category",
  "electricity_required",
  "table_count",
  "fire_required",
  "cold_storage_required",
  "vehicle_entry_required",
  "request_note",
] as const;
export function canEditField(app: Application, field: string) {
  return (
    app.allowed_actions.includes("update") &&
    (app.status === "DRAFT" ||
      (app.status === "NEED_INFO" &&
        !!app.info_requests_json?.some((r) => r.field === field)))
  );
}
export function applicationPayload(f: FormData, app: Application) {
  const body: Record<string, unknown> = { expected_version: app.version };
  for (const field of applicationFields) {
    if (!canEditField(app, field)) continue;
    if (field.endsWith("_required")) body[field] = f.has(field);
    else if (field === "table_count") {
      const value = text(f, field);
      if (
        !/^\d+$/.test(value) ||
        !Number.isSafeInteger(Number(value)) ||
        Number(value) > 100
      )
        throw new FormError(
          field,
          "테이블 개수는 0~100 사이 정수로 입력해 주세요.",
        );
      body[field] = Number(value);
    } else body[field] = text(f, field);
  }
  return body;
}
export function validateSubmit(app: Application) {
  if (app.pending_uploads?.length)
    throw new FormError(
      "product_images",
      "미완료 파일 선택을 해제한 뒤 제출해 주세요.",
    );
  for (const field of [
    "product_name",
    "product_desc",
    "price_range",
    "category",
  ] as const)
    if (!app[field]?.trim())
      throw new FormError(
        field,
        "제출 전에 필수 항목을 입력하고 저장해 주세요.",
      );
  if (!app.project.policy_json.allowed_categories.includes(app.category))
    throw new FormError(
      "category",
      "이 마켓에서 모집하는 카테고리를 선택해 주세요.",
    );
  if (
    app.project.policy_json.photo_required &&
    !app.attachments.some(
      (a) =>
        a.file_type === "product_images" || a.file_type === "PRODUCT_IMAGE",
    )
  )
    throw new FormError("product_images", "상품 사진을 연결해 주세요.");
  if (
    app.project.policy_json.business_required &&
    !app.attachments.some(
      (a) =>
        a.file_type === "business_document" || a.file_type === "BUSINESS_DOC",
    )
  )
    throw new FormError("business_document", "사업자 증빙을 연결해 주세요.");
}
export function validateFiles(
  files: readonly Pick<File, "size" | "type" | "name">[],
  field: "product_images" | "business_document",
  policy: UploadPolicy,
  existing: number,
) {
  const limit =
    field === "product_images"
      ? policy.max_product_images
      : policy.max_business_documents;
  const mimes =
    field === "product_images"
      ? policy.product_image_mime_types
      : policy.business_document_mime_types;
  if (existing + files.length > limit)
    throw new FormError(field, `최대 ${limit}개까지 연결할 수 있습니다.`);
  for (const file of files)
    if (
      file.size <= 0 ||
      file.size > policy.max_size_bytes ||
      !mimes.includes(file.type)
    )
      throw new FormError(
        field,
        `${file.name}: 파일 형식과 크기를 확인해 주세요. 최대 ${(policy.max_size_bytes / 1048576).toLocaleString("ko-KR")} MiB입니다.`,
      );
}
export function kstDisplay(value?: string | null) {
  if (!value) return "미정";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
