export type Reply = { status: number; body: Record<string, unknown> };
export type RequestState = "checking" | "succeeded" | "unresolved" | "reauth" | "forbidden" | "expired" | "review" | "conflict" | "failed";
export type Recovery = { state: RequestState; body?: Record<string, unknown>; attempt?: number };
type Options = {
  execute: () => Promise<Reply>; lookup: () => Promise<Reply>; signal: AbortSignal;
  resume?: boolean; automatic?: boolean; onState?: (state: Recovery) => void;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
};

export function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}

function classify(reply: Reply): Recovery {
  const { status, body } = reply;
  if (status === 401) return { state: "reauth", body };
  if (status === 403 || status === 404) return { state: "forbidden", body };
  if (status === 410) return { state: "expired", body };
  if (body.code === "NEEDS_OPERATOR_REVIEW") return { state: "review", body };
  if (status === 202 || status >= 500 || status === 429 || body.code === "REQUEST_IN_PROGRESS") return { state: "unresolved", body };
  if (status === 409) return { state: "conflict", body };
  if (status >= 200 && status < 300 && body.data && typeof body.data === "object") return { state: "succeeded", body };
  return { state: status >= 400 ? "failed" : "unresolved", body };
}

export async function recover(options: Options): Promise<Recovery> {
  const { execute, lookup, signal, sleep = wait, onState = () => {} } = options;
  const call = async (fn: () => Promise<Reply>): Promise<Reply> => {
    signal.throwIfAborted();
    try { const result = await fn(); signal.throwIfAborted(); return result; }
    catch (error) { signal.throwIfAborted(); if (error instanceof DOMException && error.name === "AbortError") throw error; return { status: 503, body: {} }; }
  };
  const check = async (): Promise<Recovery> => {
    const reply = await call(lookup);
    if (reply.status === 200 && (reply.body.outcome === "SUCCEEDED" || reply.body.outcome === "FAILED")) {
      if (typeof reply.body.http_status !== "number" || !reply.body.response || typeof reply.body.response !== "object") return { state: "unresolved" };
      return classify({ status: reply.body.http_status, body: reply.body.response as Record<string, unknown> });
    }
    // Only an explicit UNRESOLVED permits the original idempotent mutation again.
    if (reply.status === 202 && reply.body.code === "UNRESOLVED") return classify(await call(execute));
    return classify(reply);
  };
  onState({ state: "checking", attempt: 0 });
  let result = options.resume ? await check() : classify(await call(execute));
  if (options.automatic !== false) {
    for (const [index, milliseconds] of [2000, 4000, 8000].entries()) {
      if (result.state !== "unresolved") break;
      onState({ state: "checking", attempt: index + 1 });
      await sleep(milliseconds, signal);
      signal.throwIfAborted();
      result = await check();
    }
  }
  onState(result);
  return result;
}
