const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const privateHeaders = {
  "Cache-Control": "private, no-store",
  Pragma: "no-cache",
};
function error(status: number, code: string) {
  return Response.json(
    { code, request_id: crypto.randomUUID() },
    { status, headers: privateHeaders },
  );
}

export async function relay(
  request: Request,
  segments: string[],
  base: string | undefined,
  fetcher: typeof fetch = fetch,
  appOrigin?: string,
): Promise<Response> {
  const path = segments.join("/");
  const project = segments[0] === "projects" && uuid.test(segments[1] ?? "");
  const application =
    segments[0] === "applications" && uuid.test(segments[1] ?? "");
  const attachment =
    segments[0] === "attachments" && uuid.test(segments[1] ?? "");
  const publicRead =
    request.method === "GET" &&
    (path === "attachments/policy" ||
      (segments.length === 3 &&
        segments[0] === "public" &&
        segments[1] === "projects" &&
        uuid.test(segments[2])));
  const allowed =
    (request.method === "POST" && path === "auth/bootstrap") ||
    publicRead ||
    (path === "me/seller" &&
      ["GET", "POST", "PATCH"].includes(request.method)) ||
    (path === "me/applications" && request.method === "GET") ||
    (path === "applications" && request.method === "POST") ||
    (application &&
      segments.length === 2 &&
      ["GET", "PATCH"].includes(request.method)) ||
    (application &&
      segments.length === 3 &&
      request.method === "POST" &&
      [
        "submit",
        "resubmit",
        "cancel",
        "validate",
        "confirm",
        "start-review",
        "request-info",
        "extend-info",
        "decision",
        "extend-confirmation",
        "notes",
      ].includes(segments[2])) ||
    (segments.length === 3 &&
      segments[0] === "review" &&
      segments[1] === "applications" &&
      uuid.test(segments[2]) &&
      request.method === "GET") ||
    (["attachments/upload-url", "attachments/complete"].includes(path) &&
      request.method === "POST") ||
    (attachment &&
      segments.length === 3 &&
      ((segments[2] === "detach" && request.method === "POST") ||
        (segments[2] === "download" && request.method === "GET"))) ||
    (segments.length === 4 &&
      segments[0] === "attachments" &&
      segments[1] === "uploads" &&
      uuid.test(segments[2]) &&
      segments[3] === "abandon" &&
      request.method === "POST") ||
    (path === "projects" && ["GET", "POST"].includes(request.method)) ||
    (project &&
      segments.length === 2 &&
      ["GET", "PATCH"].includes(request.method)) ||
    (project &&
      segments.length === 3 &&
      request.method === "GET" &&
      [
        "settings",
        "members",
        "applications",
        "application-summary",
        "booths",
      ].includes(segments[2])) ||
    (project &&
      segments.length === 3 &&
      request.method === "POST" &&
      [
        "status",
        "members",
        "booths",
        "booth-draft",
        "booth-confirm",
        "booth-release",
      ].includes(segments[2])) ||
    (project &&
      segments.length === 4 &&
      segments[2] === "booths" &&
      uuid.test(segments[3]) &&
      request.method === "PATCH") ||
    (request.method === "GET" &&
      (path === "me" ||
        (segments.length === 4 &&
          segments[0] === "me" &&
          segments[1] === "requests" &&
          [
            "auth.bootstrap",
            "projects.update",
            "projects.create",
            "projects.status",
            "projects.members",
            "sellers.save",
            "applications.create",
            "applications.update",
            "applications.submit",
            "applications.resubmit",
            "applications.cancel",
            "applications.confirm",
            "reviews.start",
            "reviews.request_info",
            "reviews.extend_info",
            "reviews.decision",
            "reviews.extend_confirmation",
            "reviews.note",
            "booths.create",
            "booths.update",
            "booths.draft",
            "booths.confirm",
            "booths.release",
            "attachments.issue",
            "attachments.complete",
            "attachments.detach",
            "attachments.abandon",
          ].includes(segments[2]) &&
          uuid.test(segments[3]))));
  if (!allowed) return error(404, "NOT_FOUND");
  const authorization = request.headers.get("authorization");
  if (
    !publicRead &&
    (!authorization ||
      authorization.length > 8192 ||
      !/^Bearer \S+$/.test(authorization))
  )
    return error(401, "UNAUTHENTICATED");
  const origin = request.headers.get("origin");
  // Next may reconstruct request.url with an internal hostname. Trust only the
  // configured public origin, never client-supplied Host/Forwarded headers.
  if (
    request.method !== "GET" &&
    origin &&
    origin !== (appOrigin ?? new URL(request.url).origin)
  )
    return error(403, "FORBIDDEN");
  if (!base) return error(503, "API_UNAVAILABLE");
  const headers = new Headers({ Accept: "application/json" });
  if (!publicRead && authorization) headers.set("Authorization", authorization);
  let body: string | undefined;
  if (["POST", "PATCH"].includes(request.method)) {
    const key = request.headers.get("idempotency-key");
    if (!key || !uuid.test(key)) return error(422, "INVALID_REQUEST_KEY");
    const maxBytes = path === "auth/bootstrap" ? 1024 : 65536;
    if (Number(request.headers.get("content-length")) > maxBytes)
      return error(413, "BODY_TOO_LARGE");
    body = await request.text();
    if (new TextEncoder().encode(body).length > maxBytes)
      return error(413, "BODY_TOO_LARGE");
    try {
      const parsed = JSON.parse(body);
      if (
        !parsed ||
        Array.isArray(parsed) ||
        typeof parsed !== "object" ||
        (path === "auth/bootstrap" && Object.keys(parsed).length)
      )
        return error(422, "INVALID_BODY");
    } catch {
      return error(422, "INVALID_BODY");
    }
    headers.set("Idempotency-Key", key);
    headers.set("Content-Type", "application/json");
  }
  try {
    const target = new URL(`/api/${path}`, base);
    if (
      (["projects", "me/applications"].includes(path) ||
        (project && segments.length === 3 && segments[2] === "applications")) &&
      request.method === "GET"
    ) {
      const query = new URL(request.url).searchParams;
      for (const key of ["limit", "offset"])
        if (query.has(key)) target.searchParams.set(key, query.get(key)!);
      if (path === "me/applications" && query.has("project_id"))
        target.searchParams.set("project_id", query.get("project_id")!);
      if (project && segments[2] === "applications")
        for (const key of ["status", "category"])
          if (query.has(key)) target.searchParams.set(key, query.get(key)!);
    }
    const upstream = await fetcher(target, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
    });
    if (!upstream.headers.get("content-type")?.includes("application/json"))
      return error(503, "API_UNAVAILABLE");
    const data = await upstream.json();
    const response = Response.json(data, {
      status: upstream.status,
      headers: privateHeaders,
    });
    const retry = upstream.headers.get("retry-after");
    if (retry && /^\d{1,2}$/.test(retry))
      response.headers.set("Retry-After", retry);
    return response;
  } catch {
    return error(503, "API_UNAVAILABLE");
  }
}
