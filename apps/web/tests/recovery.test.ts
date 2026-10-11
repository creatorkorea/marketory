import { describe, expect, it, vi } from "vitest";
import { recover, type Reply } from "../lib/requests/recovery";
import { pendingKey } from "../lib/requests/pending";

const unresolved: Reply = { status: 202, body: { code: "UNRESOLVED" } };
const success: Reply = { status: 200, body: { data: { user_id: "actor" } } };
const signal = () => new AbortController().signal;

describe("uncertain request recovery", () => {
  it("waits 2/4/8 seconds and reuses the original operation; then requires manual action", async () => {
    const execute = vi.fn().mockResolvedValue({ status: 503, body: {} });
    const lookup = vi.fn().mockResolvedValue(unresolved);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await recover({ execute, lookup, sleep, signal: signal() });
    expect(result.state).toBe("unresolved");
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([2000, 4000, 8000]);
    expect(execute).toHaveBeenCalledTimes(4);
    expect(lookup).toHaveBeenCalledTimes(3);
  });
  it("finds a committed response without executing it again", async () => {
    const execute = vi.fn().mockRejectedValue(new TypeError("network"));
    const lookup = vi.fn().mockResolvedValue({ status: 200, body: {
      outcome: "SUCCEEDED", http_status: 200, response: success.body,
    } });
    const result = await recover({ execute, lookup, sleep: async () => {}, signal: signal() });
    expect(result.state).toBe("succeeded");
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it.each([
    [401, "UNAUTHENTICATED", "reauth"], [403, "FORBIDDEN", "forbidden"],
    [404, "NOT_FOUND", "forbidden"], [410, "REQUEST_RESULT_EXPIRED", "expired"],
    [409, "NEEDS_OPERATOR_REVIEW", "review"], [409, "IDEMPOTENCY_CONFLICT", "conflict"],
    [422, "VALIDATION_ERROR", "failed"],
  ])("stops on %s %s", async (status, code, state) => {
    const execute = vi.fn();
    const lookup = vi.fn().mockResolvedValue({ status, body: { code } });
    const sleep = vi.fn();
    expect((await recover({ execute, lookup, sleep, signal: signal(), resume: true })).state).toBe(state);
    expect(execute).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });
  it("unwraps stored failure instead of reporting lookup HTTP 200 as success", async () => {
    const lookup = async () => ({ status: 200, body: {
      outcome: "FAILED", http_status: 422, response: { code: "VALIDATION_ERROR" },
    } });
    expect((await recover({ execute: vi.fn(), lookup, signal: signal(), resume: true })).state).toBe("failed");
  });
  it("does not re-execute when lookup is unavailable or locked", async () => {
    const execute = vi.fn().mockResolvedValue(unresolved);
    await recover({ execute, lookup: async () => ({ status: 503, body: {} }), signal: signal(), sleep: async () => {} });
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("stops after abort and never treats cancellation as server failure", async () => {
    const controller = new AbortController();
    const execute = vi.fn().mockResolvedValue(unresolved);
    const lookup = vi.fn();
    await expect(recover({ execute, lookup, signal: controller.signal, sleep: async () => controller.abort() })).rejects.toMatchObject({ name: "AbortError" });
    expect(lookup).not.toHaveBeenCalled();
  });
  it("manual check does not restart the automatic timer cycle", async () => {
    const sleep = vi.fn();
    await recover({ execute: async () => unresolved, lookup: async () => unresolved, signal: signal(), resume: true, automatic: false, sleep });
    expect(sleep).not.toHaveBeenCalled();
  });
  it("keeps keys stable per actor and does not store email/token/body", () => {
    const entries = new Map<string, string>();
    const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value) };
    const a = pendingKey(storage, "actor-a");
    expect(pendingKey(storage, "actor-a")).toBe(a);
    expect(pendingKey(storage, "actor-b")).not.toBe(a);
    expect([...entries.values()].every((value) => /^[0-9a-f-]{36}$/.test(value))).toBe(true);
  });
});

describe("communication queue acceptance", () => {
  const accepted: Reply = {status:202,body:{data:{communication_id:"message-id",send_status:"QUEUED"}}};
  it("settles a queue acceptance without polling or promising delivery", async () => {
    const lookup=vi.fn();
    const result=await recover({execute:async()=>accepted,lookup,signal:signal()});
    expect(result.state).toBe("succeeded"); expect(lookup).not.toHaveBeenCalled();
  });
  it("settles the saved 202 result after response loss", async () => {
    const execute=vi.fn();
    const result=await recover({execute,lookup:async()=>({status:200,body:{outcome:"SUCCEEDED",http_status:202,response:accepted.body}}),signal:signal(),resume:true});
    expect(result.state).toBe("succeeded"); expect(execute).not.toHaveBeenCalled();
  });
  it("keeps generic and REQUEST_IN_PROGRESS 202 unresolved",async()=>{
    for(const body of [{data:{job:"pending"}},{code:"REQUEST_IN_PROGRESS",...accepted.body}]) {
      const result=await recover({execute:async()=>({status:202,body}),lookup:async()=>unresolved,signal:signal(),automatic:false});
      expect(result.state).toBe("unresolved");
    }
  });
});
