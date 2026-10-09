export const statusLabels: Record<string, string> = {
  DRAFT: "초안",
  RECRUITING: "모집 공개",
  REVIEWING: "심사 중",
  CLOSED: "운영 확정",
  COMPLETED: "종료",
};
export class FormError extends Error {
  constructor(
    public field: string,
    message: string,
  ) {
    super(message);
  }
}
export function kstInput(value: string) {
  return new Date(new Date(value).getTime() + 9 * 3600000)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
}
export function parseKst(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value))
    throw new Error("YYYY-MM-DD HH:mm 형식으로 입력해 주세요.");
  const date = new Date(`${value.replace(" ", "T")}:00+09:00`);
  if (
    !Number.isFinite(date.getTime()) ||
    kstInput(date.toISOString()) !== value
  )
    throw new Error("실제 날짜와 시간을 입력해 주세요.");
  return date.toISOString();
}
export function marketPayload(f: FormData) {
  const str = (key: string) => String(f.get(key) ?? "").trim();
  const required = (key: string) => {
    const v = str(key);
    if (!v) throw new FormError(key, "필수 항목을 입력해 주세요.");
    return v;
  };
  const integer = (key: string, min: number, max: number) => {
    const s = required(key);
    const n = Number(s);
    if (!/^\d+$/.test(s) || !Number.isSafeInteger(n) || n < min || n > max)
      throw new FormError(
        key,
        `${min.toLocaleString("ko-KR")}~${max.toLocaleString("ko-KR")} 사이 정수를 입력해 주세요.`,
      );
    return n;
  };
  const time = (key: string) => {
    try {
      return parseKst(str(key));
    } catch (e) {
      throw new FormError(key, (e as Error).message);
    }
  };
  const name = required("name"),
    venue = required("venue");
  const start = time("start"),
    end = time("end"),
    event = time("event");
  if (start >= end)
    throw new FormError("end", "모집 시작 이후로 설정해 주세요.");
  if (end > event)
    throw new FormError("event", "모집 마감 이후로 설정해 주세요.");
  const capacity = integer("capacity", 1, 100000),
    fee = integer("fee", 0, 100000000);
  const criteria = required("criteria")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.+):\s*(\d+)$/);
      if (!match || !match[1].trim())
        throw new FormError(
          "criteria",
          "항목명:비중 형식으로 한 줄에 하나씩 입력해 주세요.",
        );
      return { code: match[1].trim(), weight: Number(match[2]) };
    });
  if (
    criteria.length > 20 ||
    criteria.some(
      (c) => c.code.length > 80 || c.weight < 1 || c.weight > 100,
    ) ||
    criteria.reduce((n, c) => n + c.weight, 0) !== 100 ||
    new Set(criteria.map((c) => c.code)).size !== criteria.length
  )
    throw new FormError(
      "criteria",
      "중복 없는 심사 항목을 입력하고 비중 합계를 100으로 맞춰 주세요. (최대 20개)",
    );
  const lines = (key: string) =>
    str(key)
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean);
  return {
    name,
    venue,
    event_date: str("event").slice(0, 10),
    recruit_start_at: start,
    recruit_end_at: end,
    event_end_at: event,
    target_team_count: capacity,
    reason: required("reason"),
    policy_json: {
      schema_version: 1,
      allowed_categories: lines("categories"),
      restricted_items: lines("restricted"),
      business_required: f.has("business"),
      photo_required: f.has("photo"),
      participation_fee_krw: fee,
      consent_version: str("consentVersion"),
      consent_text: str("consent"),
    },
    booth_policy_json: { schema_version: 1, description: str("booth") },
    evaluation_policy_json: { schema_version: 1, criteria },
  };
}
export type Market = ReturnType<typeof marketPayload> & {
  project_id: string;
  version: number;
  policy_version: number;
  status: string;
  can_manage?: boolean;
};
