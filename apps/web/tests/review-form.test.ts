import { describe, expect, it } from "vitest";
import {
  reviewPayload,
  reviewQuery,
  type ReviewApplication,
} from "../lib/reviews/form";

const app = {
  version: 3,
  event_end_at: "2099-11-10T09:00:00Z",
  project: { event_end_at: "2099-11-10T09:00:00Z" },
  info_due_at: "2099-11-01T00:00:00Z",
} as unknown as ReviewApplication;
function form(values: Record<string, string>) {
  const f = new FormData();
  Object.entries(values).forEach(([k, v]) => f.set(k, v));
  return f;
}
describe("review input contracts", () => {
  it("requires a reason", () =>
    expect(() =>
      reviewPayload("approve", form({ deadline: "2099-11-02 09:00" }), app),
    ).toThrow("사유"));
  it("converts KST and sends only decision fields", () =>
    expect(
      reviewPayload(
        "approve",
        form({ reason: "검토 완료", deadline: "2099-11-02 09:00", rank: "9" }),
        app,
      ),
    ).toEqual({
      expected_version: 3,
      reason: "검토 완료",
      decision: "APPROVED",
      confirm_due_at: "2099-11-02T00:00:00.000Z",
    }));
  it("rejects event-end deadline", () =>
    expect(() =>
      reviewPayload(
        "approve",
        form({ reason: "승인", deadline: "2099-11-10 18:00" }),
        app,
      ),
    ).toThrow("행사 종료"));
  it("rejects shortening an info deadline", () =>
    expect(() =>
      reviewPayload(
        "extend_info",
        form({ reason: "연장", deadline: "2099-10-31 09:00" }),
        app,
      ),
    ).toThrow("기존 기한"));
  it("requires unique requested fields", () =>
    expect(() =>
      reviewPayload(
        "request_info",
        form({ reason: "보완", deadline: "2099-11-02 09:00" }),
        app,
      ),
    ).toThrow("항목"));
  it("requires positive waiting rank", () =>
    expect(() =>
      reviewPayload("wait", form({ reason: "대기", rank: "0" }), app),
    ).toThrow("순위"));
  it("retains non-sensitive filters and bounds offset", () =>
    expect(
      reviewQuery({
        status: "REVIEWING",
        category: "공예",
        offset: "20",
        q: "private",
      }),
    ).toBe("status=REVIEWING&category=%EA%B3%B5%EC%98%88&limit=20&offset=20"));
  it("rejects empty notes", () =>
    expect(() => reviewPayload("note", form({ body: "  " }), app)).toThrow(
      "메모",
    ));
});
