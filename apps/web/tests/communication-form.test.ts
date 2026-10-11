import { describe, expect, it } from "vitest";
import {
  kindsFor,
  listQuery,
  revisionPayload,
  resolutionPayload,
  type Message,
  type Target,
} from "../lib/communications/form";
const target: Target = {
  application_id: "app",
  shop_name: "공방",
  status: "CONFIRMED",
  notification_email: "seller@example.test",
  has_booth: false,
};
describe("communication inputs", () => {
  it("limits kinds by current target status and active booth", () => {
    expect(kindsFor(target)).toEqual(["CONFIRM", "NOTICE"]);
    expect(kindsFor({ ...target, has_booth: true })).toContain("BOOTH");
    expect(kindsFor({ ...target, status: "CANCELLED" })).toEqual([]);
    expect(kindsFor({ ...target, status: "APPROVED" })).toEqual([
      "SELECTION",
      "NOTICE",
    ]);
  });
  it("validates edited content and carries the reviewed version", () => {
    const m = { version: 5 } as Message;
    expect(revisionPayload(m, " 제목 ", " 본문 ", " 수정 ")).toEqual({
      expected_version: 5,
      subject: "제목",
      body: "본문",
      reason: "수정",
    });
    expect(() => revisionPayload(m, " ", "본문", "수정")).toThrow("제목");
    expect(() => revisionPayload(m, "제목", "본문", " ")).toThrow("처리 사유");
    expect(() => revisionPayload(m, "a".repeat(201), "본문", "수정")).toThrow(
      "200",
    );
  });
  it("requires evidence and anchors manual resolution to latest attempt", () => {
    const m = {
      version: 4,
      send_status: "UNKNOWN",
      attempts: [{ attempt_id: "old" }, { attempt_id: "current" }],
    } as Message;
    expect(
      resolutionPayload(m, "INCONCLUSIVE", "provider record", "확인"),
    ).toEqual({
      expected_version: 4,
      attempt_id: "current",
      method: "MANUAL_EVIDENCE",
      outcome: "INCONCLUSIVE",
      evidence_ref: "provider record",
      reason: "확인",
    });
    expect(() => resolutionPayload(m, "ACCEPTED", " ", "확인")).toThrow("근거");
    expect(() =>
      resolutionPayload(
        { ...m, send_status: "SENT" },
        "ACCEPTED",
        "기록",
        "확인",
      ),
    ).toThrow("시도");
  });
  it("bounds pagination and excludes unrelated URL values", () => {
    expect(listQuery({ limit: "50", offset: "100" })).toBe(
      "limit=50&offset=100",
    );
    expect(listQuery({ limit: "999", offset: "-1" })).toBe("limit=20&offset=0");
  });
});
