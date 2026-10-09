const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const privateHeaders = { "Cache-Control": "private, no-store", Pragma: "no-cache" };
function error(status: number, code: string) { return Response.json({ code, request_id: crypto.randomUUID() }, { status, headers: privateHeaders }); }

export async function relay(request: Request, segments: string[], base: string | undefined, fetcher: typeof fetch = fetch): Promise<Response> {
  const path = segments.join("/");
  const allowed = (request.method === "POST" && path === "auth/bootstrap") ||
    (request.method === "GET" && (path === "me" || (segments.length === 4 && segments[0] === "me" && segments[1] === "requests" &&
      ["auth.bootstrap", "projects.update"].includes(segments[2]) && uuid.test(segments[3]))));
  if (!allowed) return error(404, "NOT_FOUND");
  const authorization = request.headers.get("authorization");
  if (!authorization || authorization.length > 8192 || !/^Bearer \S+$/.test(authorization)) return error(401, "UNAUTHENTICATED");
  const origin = request.headers.get("origin");
  if (request.method !== "GET" && origin && origin !== new URL(request.url).origin) return error(403, "FORBIDDEN");
  if (!base) return error(503, "API_UNAVAILABLE");
  const headers = new Headers({ Authorization: authorization, Accept: "application/json" });
  let body: string | undefined;
  if (request.method === "POST") {
    const key = request.headers.get("idempotency-key");
    if (!key || !uuid.test(key)) return error(422, "INVALID_REQUEST_KEY");
    // This relay exposes only bootstrap's empty object, never arbitrary writes.
    if (Number(request.headers.get("content-length")) > 1024) return error(413, "BODY_TOO_LARGE");
    body = await request.text();
    if (body.length > 1024) return error(413, "BODY_TOO_LARGE");
    try { const parsed = JSON.parse(body); if (!parsed || Array.isArray(parsed) || typeof parsed !== "object" || Object.keys(parsed).length) return error(422, "INVALID_BODY"); }
    catch { return error(422, "INVALID_BODY"); }
    headers.set("Idempotency-Key", key); headers.set("Content-Type", "application/json");
  }
  try {
    const upstream = await fetcher(new URL(`/api/${path}`, base), {
      method: request.method, headers, body, cache: "no-store", redirect: "error",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
    });
    if (!upstream.headers.get("content-type")?.includes("application/json")) return error(503, "API_UNAVAILABLE");
    const data = await upstream.json();
    const response = Response.json(data, { status: upstream.status, headers: privateHeaders });
    const retry = upstream.headers.get("retry-after");
    if (retry && /^\d{1,2}$/.test(retry)) response.headers.set("Retry-After", retry);
    return response;
  } catch { return error(503, "API_UNAVAILABLE"); }
}
