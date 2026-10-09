import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let pending: Promise<SupabaseClient | null> | undefined;
export function getAuthClient(): Promise<SupabaseClient | null> {
  if (!pending) pending = initialize().catch(() => { pending = undefined; return null; });
  return pending;
}
async function initialize(): Promise<SupabaseClient | null> {
  const response = await fetch("/api/auth/config", { cache: "no-store", signal: AbortSignal.timeout(8000) });
  const config = await response.json();
  if (!response.ok || typeof config.url !== "string" || !config.url.startsWith("https://") || typeof config.key !== "string" || !config.key.startsWith("sb_publishable_")) return null;
  return createClient(config.url, config.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(15000)]) }) },
  });
}

export function authError(error: { status?: number; code?: string } | null, verifying = false): string {
  if (error?.status === 429 || error?.code === "over_email_send_rate_limit") return "요청이 많습니다. 잠시 기다린 뒤 다시 시도해 주세요.";
  if (verifying && error?.status && error.status < 500) return "인증번호가 올바르지 않거나 만료됐습니다. 가장 최근에 받은 번호를 확인해 주세요.";
  return "인증 서비스에 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.";
}
