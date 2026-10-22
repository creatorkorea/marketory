import { describe, expect, it, vi } from "vitest";
import { relay } from "../lib/api/relay";

const base = "https://api.example.test";
const req = (path: string, init: RequestInit = {}) =>
  new Request(`https://app.example.test/api/backend/${path}`, {
    ...init,
    headers: { Authorization: "Bearer test-token", ...init.headers },
  });
describe("backend relay trust boundary", () => {
  it("relays 공통 안내 and all recovery operations with private pagination", async () => {
    const id = "12345678-1234-4123-8123-123456789abc";
    const fetcher = vi.fn().mockImplementation(async (url) => Response.json({url:String(url)}));
    for (const path of [`projects/${id}/announcements`, `applications/${id}/market-notices`]) {
      const reply = await relay(req(path+'?limit=5&offset=5&actor=other'), path.split('/'), base, fetcher);
      expect(reply.status).toBe(200);
      expect((await reply.json()).url).toBe(`${base}/api/${path}?limit=5&offset=5`);
      expect(reply.headers.get('cache-control')).toContain('no-store');
    }
    for (const op of ['create','revise','approve','publish','unpublish']) {
      const path = op === 'create' ? `projects/${id}/announcements` : `announcements/${id}/${op}`;
      expect((await relay(req(path,{method:'POST',headers:{'Idempotency-Key':id},body:'{}'}),path.split('/'),base,fetcher)).status).toBe(200);
      const lookup = `me/requests/announcements.${op}/${id}`;
      expect((await relay(req(lookup),lookup.split('/'),base,fetcher)).status).toBe(200);
    }
    const path = `applications/${id}/market-notices`;
    expect((await relay(new Request('https://app.example.test/'+path),path.split('/'),base,fetcher)).status).toBe(401);
    expect((await relay(req(`announcements/${id}/send`,{method:'POST'}),['announcements',id,'send'],base,fetcher)).status).toBe(404);
  });
  it("relays owner notices and explicit publication mutations without widening query access", async () => {
    const id = "12345678-1234-4123-8123-123456789abc";
    const fetcher = vi.fn().mockImplementation(async (url) => Response.json({ url: String(url) }));
    const reply = await relay(req(`applications/${id}/notices?limit=5&offset=5&actor=other`), ["applications", id, "notices"], base, fetcher);
    expect(reply.status).toBe(200);
    expect((await reply.json()).url).toBe(`${base}/api/applications/${id}/notices?limit=5&offset=5`);
    for (const action of ["publish", "unpublish"]) {
      const result = await relay(req(`communications/${id}/${action}`, {method: "POST", headers: {"Content-Type": "application/json", "Idempotency-Key": id, Origin: "https://app.example.test"}, body: JSON.stringify({expected_version: 1, reason: "확인"})}), ["communications", id, action], base, fetcher);
      expect(result.status).toBe(200);
    }
  });
  it("exposes only GET public catalog with pagination and without credentials", async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ data: [], has_more: false }));
    const response = await relay(req("public/projects?limit=12&offset=12&status=DRAFT"), ["public", "projects"], base, fetcher);
    expect(response.status).toBe(200);
    expect(String(fetcher.mock.calls[0][0])).toBe(`${base}/api/public/projects?limit=12&offset=12`);
    expect(fetcher.mock.calls[0][1].headers.get("authorization")).toBeNull();
    expect((await relay(new Request("https://app.example.test/api/backend/public/projects"), ["public", "projects"], base, fetcher)).status).toBe(200);
    expect((await relay(req("public/projects", { method: "POST" }), ["public", "projects"], base, fetcher)).status).toBe(404);
  });
  it("allows public policy without credentials, drops bearer, and restricts seller pagination", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: {} }));
    expect(
      (
        await relay(
          req("attachments/policy"),
          ["attachments", "policy"],
          base,
          fetcher,
        )
      ).status,
    ).toBe(200);
    expect(fetcher.mock.calls[0][1].headers.get("authorization")).toBeNull();
    const pid = "12345678-1234-4123-8123-123456789abc";
    const r = await relay(
      req(
        `me/applications?limit=10&offset=0&project_id=${pid}&seller_id=other`,
      ),
      ["me", "applications"],
      base,
      async (url) => Response.json({ url: String(url) }),
    );
    expect((await r.json()).url).toBe(
      `https://api.example.test/api/me/applications?limit=10&offset=0&project_id=${pid}`,
    );
    expect(
      (
        await relay(
          req(`attachments/uploads/${pid}`, { method: "PUT" }),
          ["attachments", "uploads", pid],
          base,
          fetcher,
        )
      ).status,
    ).toBe(404);
  });
  it("relays project updates with the original key and preserves pagination", async () => {
    const pid = "12345678-1234-4123-8123-123456789abc";
    const response = await relay(
      req(`projects/${pid}`, {
        method: "PATCH",
        headers: { "Idempotency-Key": pid },
        body: JSON.stringify({ name: "마켓", expected_version: 1 }),
      }),
      ["projects", pid],
      base,
      async (_url, init) =>
        Response.json({
          data: JSON.parse(init?.body as string),
          key: (init?.headers as Headers).get("Idempotency-Key"),
        }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { name: "마켓", expected_version: 1 },
      key: pid,
    });
    const list = await relay(
      req("projects?limit=20&offset=20&secret=drop"),
      ["projects"],
      base,
      async (url) => Response.json({ url: String(url) }),
    );
    expect(await list.json()).toEqual({
      url: "https://api.example.test/api/projects?limit=20&offset=20",
    });
  });
  it("accepts the configured public origin when the server uses an internal hostname", async () => {
    const request = new Request(
      "http://localhost:3000/api/backend/auth/bootstrap",
      {
        method: "POST",
        body: "{}",
        headers: {
          Authorization: "Bearer test-token",
          Origin: "http://127.0.0.1:3000",
          "Idempotency-Key": "12345678-1234-4123-8123-123456789abc",
        },
      },
    );
    const result = await relay(
      request,
      ["auth", "bootstrap"],
      base,
      async () => Response.json({ data: { profile_required: true } }),
      "http://127.0.0.1:3000",
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ data: { profile_required: true } });
  });
  it.each(["https://evil.test", "http://localhost:3000", "null"])(
    "rejects %s even with spoofed forwarded headers",
    async (origin) => {
      const request = new Request(
        "http://localhost:3000/api/backend/auth/bootstrap",
        {
          method: "POST",
          body: "{}",
          headers: {
            Authorization: "Bearer test-token",
            Origin: origin,
            Host: "evil.test",
            "X-Forwarded-Host": "evil.test",
            "Idempotency-Key": "12345678-1234-4123-8123-123456789abc",
          },
        },
      );
      const result = await relay(
        request,
        ["auth", "bootstrap"],
        base,
        async () => Response.json({ data: {} }),
        "http://127.0.0.1:3000",
      );
      expect(result.status).toBe(403);
    },
  );
  it.each([
    "admin/users",
    "../me",
    "https://evil.test",
    "me/requests/unknown/a",
  ])("blocks non-allowlisted path %s", async (path) => {
    const fetcher = vi.fn();
    expect(
      (await relay(req("me"), path.split("/"), base, fetcher)).status,
    ).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("requires a bearer and blocks cross-origin writes", async () => {
    expect(
      (
        await relay(
          new Request("https://app.example.test/api/backend/me"),
          ["me"],
          base,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await relay(
          req("auth/bootstrap", {
            method: "POST",
            body: "{}",
            headers: { Origin: "https://evil.test" },
          }),
          ["auth", "bootstrap"],
          base,
        )
      ).status,
    ).toBe(403);
  });
  it("forwards only approved credentials and prevents cached private responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: {} }));
    const result = await relay(
      req("me", { headers: { Cookie: "secret=hidden" } }),
      ["me"],
      base,
      fetcher,
    );
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toContain("no-store");
    const options = fetcher.mock.calls[0][1];
    expect(options.headers.get("cookie")).toBeNull();
    expect(options.headers.get("authorization")).toBe("Bearer test-token");
    expect(options.redirect).toBe("error");
  });
  it("converts provider html/network errors to a safe uncertain response", async () => {
    const response = await relay(
      req("me"),
      ["me"],
      base,
      async () => new Response("private debug dump", { status: 502 }),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private debug");
  });
});

describe("communications relay", () => {
  const id = "12345678-1234-4123-8123-123456789abc";
  it("relays only supported message operations and their recovery lookups", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(async () => Response.json({ data: {} }));
    for (const action of [
      "generate",
      "approve",
      "send",
      "retry",
      "revise",
      "resolve",
    ]) {
      const path =
        action === "generate"
          ? "communications/generate"
          : `communications/${id}/${action}`;
      expect(
        (
          await relay(
            req(path, {
              method: "POST",
              headers: { "Idempotency-Key": id },
              body: "{}",
            }),
            path.split("/"),
            base,
            fetcher,
          )
        ).status,
      ).toBe(200);
      const lookup = `me/requests/communications.${action}/${id}`;
      expect(
        (await relay(req(lookup), lookup.split("/"), base, fetcher)).status,
      ).toBe(200);
    }
    const invalid = `communications/${id}/dispatch`;
    expect(
      (
        await relay(
          req(invalid, { method: "POST" }),
          invalid.split("/"),
          base,
          fetcher,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await relay(
          req(`communications/${id}`, { method: "PATCH" }),
          ["communications", id],
          base,
          fetcher,
        )
      ).status,
    ).toBe(404);
  });
  it("preserves only list pagination and allows authenticated detail/targets", async () => {
    const path = `projects/${id}/communications`;
    const r = await relay(
      req(`${path}?limit=10&offset=20&recipient=secret`),
      path.split("/"),
      base,
      async (url) => Response.json({ url: String(url) }),
    );
    expect((await r.json()).url).toBe(
      `https://api.example.test/api/${path}?limit=10&offset=20`,
    );
    for (const allowed of [
      `communications/${id}`,
      `projects/${id}/communication-targets`,
    ]) {
      expect(
        (
          await relay(req(allowed), allowed.split("/"), base, async () =>
            Response.json({}),
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await relay(
            new Request(`https://app.example.test/${allowed}`),
            allowed.split("/"),
            base,
          )
        ).status,
      ).toBe(401);
    }
  });
});
