import { describe, expect, it } from "vitest";
import { kstInput, parseKst, marketPayload } from "../lib/markets/form";
describe("market form", () => {
  it("interprets Korea time independently of the browser timezone", () => {
    expect(parseKst("2026-11-01 09:30")).toBe("2026-11-01T00:30:00.000Z");
    expect(kstInput("2026-10-31T23:30:00Z")).toBe("2026-11-01 08:30");
    expect(() => parseKst("2026-02-30 12:00")).toThrow();
    expect(() => parseKst("2026-11-01 25:00")).toThrow();
  });
  it("rejects empty dates, decimals and invalid evaluation totals", () => {
    const f = new FormData();
    expect(() => marketPayload(f)).toThrow();
    for (const [k, v] of Object.entries({
      name: "테스트",
      venue: "서울",
      start: "2026-10-10 10:00",
      end: "2026-10-11 10:00",
      event: "2026-10-12 18:00",
      capacity: "3.5",
      fee: "0",
      criteria: "품질:90",
      reason: "등록",
    }))
      f.set(k, v);
    expect(() => marketPayload(f)).toThrow();
    f.set("capacity", "3");
    expect(() => marketPayload(f)).toThrow();
    f.set("criteria", "품질:60\n적합성:40");
    expect(marketPayload(f).evaluation_policy_json.criteria).toHaveLength(2);
  });
});
