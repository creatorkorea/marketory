import { describe, it, expect } from "vitest";
import { announcementPayload } from "../lib/announcements/form";
describe("공통 안내 입력", () => {
  it("trims and validates audience, lengths, and version", () => {
    expect(
      announcementPayload(" 제목 ", " 본문 ", "CONFIRMED", " 사유 ", 2),
    ).toEqual({
      subject: "제목",
      body: "본문",
      audience: "CONFIRMED",
      reason: "사유",
      expected_version: 2,
    });
    for (const args of [
      [" ", "본문", "CONFIRMED", "사유"],
      ["제목", "본문", "INVALID", "사유"],
      ["x".repeat(201), "본문", "CONFIRMED", "사유"],
      ["제목", "x".repeat(50001), "CONFIRMED", "사유"],
    ]) {
      expect(() =>
        announcementPayload(...(args as [string, string, string, string])),
      ).toThrow();
    }
    expect(() =>
      announcementPayload("제목", "본문", "CONFIRMED", "사유", 0),
    ).toThrow();
  });
});
