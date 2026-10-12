import { afterEach, expect, it, vi } from "vitest";
import { readAccess } from "../lib/api/access-read";

afterEach(() => vi.useRealTimers());
const ok = { status: 200, body: { data: {} } };
it("recovers temporary failures with bounded delays", async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockResolvedValueOnce({ status: 503, body: {} })
    .mockRejectedValueOnce(new TypeError("network")).mockResolvedValue(ok);
  const retry = vi.fn();
  const pending = readAccess(read, new AbortController().signal, retry);
  await vi.advanceTimersByTimeAsync(1999);
  expect(read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(4001);
  expect(await pending).toEqual(ok);
  expect(read).toHaveBeenCalledTimes(3);
  expect(retry.mock.calls).toEqual([[1], [2]]);
});
it.each([401, 403, 404, 429, 500])("does not repeat terminal status %s", async status => {
  const read = vi.fn().mockResolvedValue({ status, body: {} });
  expect((await readAccess(read, new AbortController().signal)).status).toBe(status);
  expect(read).toHaveBeenCalledTimes(1);
});
it("stops after three unavailable responses", async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockResolvedValue({ status: 504, body: {} });
  const pending = readAccess(read, new AbortController().signal);
  await vi.runAllTimersAsync();
  expect((await pending).status).toBe(504);
  expect(read).toHaveBeenCalledTimes(3);
});
it("cancels backoff when the account or page changes", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const read = vi.fn().mockResolvedValue({ status: 502, body: {} });
  const pending = readAccess(read, controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  await rejected;
  await vi.runAllTimersAsync();
  expect(read).toHaveBeenCalledTimes(1);
});
