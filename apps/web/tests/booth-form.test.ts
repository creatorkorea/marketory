import { describe, expect, it } from "vitest";
import { boothPayload, draftPayload, type Board } from "../lib/booths/form";

function form(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}
const board = {
  project: { version: 4 },
  applications: [
    { application_id: "a", version: 2 },
    { application_id: "b", version: 3 },
  ],
  booths: [{ booth_id: "x" }, { booth_id: "y" }],
} as Board;
describe("booth form contracts", () => {
  it("keeps unknown table capacity null", () => {
    expect(
      boothPayload(
        form({ booth_no: " A-1 ", reason: "신규 등록", status: "AVAILABLE" }),
        4,
      ),
    ).toMatchObject({
      booth_no: "A-1",
      table_capacity: null,
      expected_version: 4,
    });
  });
  it("rejects fractional and negative capacity", () => {
    for (const table_capacity of ["-1", "1.5", "abc", "2147483648"])
      expect(() =>
        boothPayload(
          form({
            booth_no: "A-1",
            reason: "등록",
            status: "AVAILABLE",
            table_capacity,
          }),
          4,
        ),
      ).toThrow("정수");
  });
  it("requires a booth number and reason", () => {
    expect(() => boothPayload(form({}), 4)).toThrow();
  });
  it("creates only selected changes, including swaps, with application versions", () => {
    expect(draftPayload(board, { a: "y", b: "x" }, "자리 교환")).toEqual({
      expected_version: 4,
      reason: "자리 교환",
      items: [
        { application_id: "a", booth_id: "y", expected_application_version: 2 },
        { application_id: "b", booth_id: "x", expected_application_version: 3 },
      ],
    });
    expect(
      draftPayload(board, { a: "x", b: "" }, "부분 배정").items,
    ).toHaveLength(1);
  });
  it("rejects duplicate booth targets and stale application selections", () => {
    expect(() => draftPayload(board, { a: "x", b: "x" }, "배정")).toThrow(
      "중복",
    );
    expect(() => draftPayload(board, { missing: "x" }, "배정")).toThrow("최신");
  });
  it("allows an empty change set to clear draft", () => {
    expect(draftPayload(board, {}, "초안 비우기").items).toEqual([]);
  });
});
