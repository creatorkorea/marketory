import type { SupabaseClient } from "@supabase/supabase-js";
import type { Reply } from "../requests/recovery";

export async function api(client: SupabaseClient, actor: string, path: string, signal: AbortSignal, key?: string, mutation?: { method: "POST" | "PATCH"; body: Record<string, unknown> }): Promise<Reply> {
  signal.throwIfAborted();
  const { data, error } = await client.auth.getSession();
  signal.throwIfAborted();
  if (error || !data.session) return { status: 401, body: { code: "UNAUTHENTICATED" } };
  if (data.session.user.id !== actor) throw new DOMException("Account changed", "AbortError");
  const headers = new Headers({ Authorization: `Bearer ${data.session.access_token}` });
  if (key) { headers.set("Idempotency-Key", key); headers.set("Content-Type", "application/json"); }
  const response = await fetch(`/api/backend/${path}`, {
    method: key ? mutation?.method ?? "POST" : "GET", headers, ...(key ? { body: JSON.stringify(mutation?.body ?? {}) } : {}), cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(22000)]),
  });
  const body = await response.json();
  return { status: response.status, body };
}
