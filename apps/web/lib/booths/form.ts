import { FormError } from "../markets/form";
export { FormError };

export type Booth = {
  booth_id: string;
  project_id: string;
  booth_no: string;
  zone: string | null;
  electricity_available: boolean;
  fire_allowed: boolean;
  cold_storage_available: boolean;
  vehicle_access: boolean;
  table_capacity: number | null;
  note: string | null;
  status: "AVAILABLE" | "BLOCKED";
  version: number;
};
export type ConfirmedApp = {
  application_id: string;
  version: number;
  shop_name: string;
  product_name: string;
  category: string;
  electricity_required: boolean;
  fire_required: boolean;
  cold_storage_required: boolean;
  vehicle_entry_required: boolean;
  table_count: number;
};
export type Assignment = {
  assignment_id: string;
  application_id: string;
  booth_id: string;
  confirmed: boolean;
  version: number;
  input_application_version: number;
  input_booth_version: number;
  reason: string;
  assigned_at: string;
  confirmed_at: string | null;
  released_at: string | null;
  release_reason: string | null;
};
export type Board = {
  project: {
    project_id: string;
    name: string;
    status: string;
    event_end_at: string;
    version: number;
  };
  role: "OPERATOR" | "REVIEWER";
  can_manage: boolean;
  booths: Booth[];
  applications: ConfirmedApp[];
  assignments: Assignment[];
  drafts: Assignment[];
  history: Assignment[];
  candidates: {
    application_id: string;
    booth_id: string;
    compatible: boolean;
    conflicts: string[];
    warnings: string[];
  }[];
  unassigned_count: number;
};
export const resourceLabels = {
  electricity_available: "전기 사용 가능",
  fire_allowed: "화기 사용 가능",
  cold_storage_available: "냉장 보관 가능",
  vehicle_access: "차량 진입 가능",
} as const;
export function requireReason(reason: string) {
  if (!reason.trim() || reason.trim().length > 2000)
    throw new FormError("reason", "처리 사유를 1~2,000자로 입력해 주세요.");
  return reason.trim();
}
export function boothPayload(
  form: FormData,
  version: number,
): Record<string, unknown> {
  const text = (key: string) => String(form.get(key) ?? "").trim();
  if (!text("booth_no"))
    throw new FormError("booth_no", "부스 번호를 입력해 주세요.");
  const capacity = text("table_capacity");
  if (
    capacity &&
    (!/^\d+$/.test(capacity) ||
      !Number.isSafeInteger(Number(capacity)) ||
      Number(capacity) > 2147483647)
  )
    throw new FormError(
      "table_capacity",
      "테이블 수용 개수를 0~2,147,483,647 사이 정수로 입력해 주세요.",
    );
  const status = text("status");
  if (!["AVAILABLE", "BLOCKED"].includes(status))
    throw new FormError("status", "부스 상태를 선택해 주세요.");
  return {
    expected_version: version,
    reason: requireReason(text("reason")),
    booth_no: text("booth_no"),
    zone: text("zone") || null,
    electricity_available: form.get("electricity_available") === "on",
    fire_allowed: form.get("fire_allowed") === "on",
    cold_storage_available: form.get("cold_storage_available") === "on",
    vehicle_access: form.get("vehicle_access") === "on",
    table_capacity: capacity === "" ? null : Number(capacity),
    note: text("note") || null,
    status,
  };
}
export function savedSelection(board: Board): Record<string, string> {
  return Object.fromEntries(
    board.drafts.map((item) => [item.application_id, item.booth_id]),
  );
}
export function selectionKey(selection: Record<string, string>) {
  return JSON.stringify(
    Object.entries(selection)
      .filter(([, value]) => value)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}
export function draftPayload(
  board: Board,
  selections: Record<string, string>,
  reason: string,
) {
  const seen = new Set<string>();
  const items = Object.entries(selections)
    .filter(([, value]) => value)
    .map(([application_id, booth_id]) => {
      const app = board.applications.find(
        (item) => item.application_id === application_id,
      );
      if (!app || !board.booths.some((item) => item.booth_id === booth_id))
        throw new FormError(
          "selection",
          "최신 셀러와 부스를 확인한 뒤 다시 선택해 주세요.",
        );
      if (seen.has(booth_id))
        throw new FormError(
          "selection",
          "같은 부스를 중복 선택했어요. 셀러별로 다른 부스를 선택해 주세요.",
        );
      seen.add(booth_id);
      return {
        application_id,
        booth_id,
        expected_application_version: app.version,
      };
    });
  return {
    expected_version: board.project.version,
    reason: requireReason(reason),
    items,
  };
}
