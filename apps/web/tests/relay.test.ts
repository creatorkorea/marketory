import { describe, expect, it, vi } from "vitest";
import { relay } from "../lib/api/relay";

const base = "https://api.example.test";
const req = (path: string, init: RequestInit = {}) => new Request(`https://app.example.test/api/backend/${path}`, { ...init, headers: { Authorization: "Bearer test-token", ...init.headers } });
describe("backend relay trust boundary", () => {
  it.each(["admin/users", "../me", "https://evil.test", "me/requests/unknown/a"])("blocks non-allowlisted path %s", async (path) => {
    const fetcher = vi.fn();
    expect((await relay(req("me"), path.split("/"), base, fetcher)).status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("requires a bearer and blocks cross-origin writes", async () => {
    expect((await relay(new Request("https://app.example.test/api/backend/me"), ["me"], base)).status).toBe(401);
    expect((await relay(req("auth/bootstrap", { method: "POST", body: "{}", headers: { Origin: "https://evil.test" } }), ["auth", "bootstrap"], base)).status).toBe(403);
  });
  it("forwards only approved credentials and prevents cached private responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: {} }));
    const result = await relay(req("me", { headers: { Cookie: "secret=hidden" } }), ["me"], base, fetcher);
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toContain("no-store");
    const options = fetcher.mock.calls[0][1];
    expect(options.headers.get("cookie")).toBeNull();
    expect(options.headers.get("authorization")).toBe("Bearer test-token");
    expect(options.redirect).toBe("error");
  });
  it("converts provider html/network errors to a safe uncertain response", async () => {
    const response = await relay(req("me"), ["me"], base, async () => new Response("private debug dump", { status: 502 }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private debug");
  });
});
