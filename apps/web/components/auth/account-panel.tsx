"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { internalReturn } from "@/lib/seller/form";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthClient } from "@/lib/auth/client";
import { api } from "@/lib/api/client";
import { recover, type Recovery } from "@/lib/requests/recovery";
import { pendingKey, pendingStorageName } from "@/lib/requests/pending";
import { Button, ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { RequestStatus } from "@/components/requests/request-status";

type Profile = { user_id: string; email: string; account_role: string; global_role: string; profile_required: boolean };
export function AccountPanel({ returnTo }: { returnTo?: string }) {
  const router = useRouter();
  const destination = internalReturn(returnTo);
  const loginHref = destination ? `/login?returnTo=${encodeURIComponent(destination)}` : "/login";
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [actor, setActor] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [result, setResult] = useState<Recovery>({ state: "checking" });
  const [storageError, setStorageError] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const active = useRef<AbortController | null>(null);
  const account = useRef<string | null>(null);
  const running = useRef(false);

  useEffect(() => {
    if (destination && profile?.user_id === actor && profile?.account_role === "SELLER" && profile.global_role !== "PLATFORM_ADMIN") router.replace(destination);
  }, [destination, profile, actor, router]);

  useEffect(() => {
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    void getAuthClient().then(async (value) => {
      if (!alive) return;
      setClient(value);
      if (!value) { setReady(true); return; }
      const update = (id: string | null) => {
        if (!alive) return;
        if (account.current !== id) {
          active.current?.abort(); running.current = false; setProfile(null); setResult({ state: "checking" });
          account.current = id; setActor(id);
        }
        setReady(true);
      };
      const { data: subscription } = value.auth.onAuthStateChange((_event, session) => update(session?.user.id ?? null));
      unsubscribe = () => subscription.subscription.unsubscribe();
      const { data } = await value.auth.getSession();
      update(data.session?.user.id ?? null);
    });
    return () => { alive = false; unsubscribe?.(); active.current?.abort(); };
  }, []);

  const load = useCallback(async (mode: "initial" | "manual" | "current" = "initial") => {
    if (!client || !actor || running.current) return;
    active.current?.abort();
    const controller = new AbortController(); active.current = controller; running.current = true;
    const { signal } = controller;
    setProfile(null); setStorageError(false); setResult({ state: "checking" });
    const show = (state: Recovery) => { if (!signal.aborted && account.current === actor) setResult(state); };
    const readProfile = async () => {
      const reply = await api(client, actor, "me", signal);
      signal.throwIfAborted();
      const data = reply.body.data as Profile | undefined;
      if (reply.status === 200 && data?.user_id === actor && typeof data.email === "string") {
        setProfile(data); return true;
      }
      if (reply.status === 403 && reply.body.code === "BOOTSTRAP_REQUIRED" && mode !== "current") return false;
      show({ state: reply.status === 401 ? "reauth" : reply.status === 403 || reply.status === 404 ? "forbidden" : "unresolved" });
      return true;
    };
    try {
      if (mode === "current") { await readProfile(); return; }
      let existing: string | null;
      try { existing = sessionStorage.getItem(pendingStorageName(actor)); }
      catch { setStorageError(true); return; }
      if (!existing && await readProfile()) return;
      let key: string;
      try { key = pendingKey(sessionStorage, actor); }
      catch { setStorageError(true); return; }
      const recovered = await recover({
        execute: () => api(client, actor, "auth/bootstrap", signal, key),
        lookup: () => api(client, actor, `me/requests/auth.bootstrap/${key}`, signal),
        signal, resume: Boolean(existing), automatic: mode !== "manual", onState: show,
      });
      if (recovered.state === "succeeded") {
        await readProfile();
        // Keep the committed key: reload must never turn an uncertain profile read into a new mutation.
      }
    } catch {
      if (!signal.aborted) show({ state: "unresolved" });
    } finally { if (active.current === controller) running.current = false; }
  }, [client, actor]);
  useEffect(() => { void load(); return () => { active.current?.abort(); running.current = false; }; }, [load]);

  async function signOut() {
    if (!client || signingOut) return;
    active.current?.abort(); running.current = false; setProfile(null); setSigningOut(true); setLogoutError(false);
    try {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) { setLogoutError(true); setResult({ state: "unresolved" }); return; }
      account.current = null; setActor(null);
    } catch { setLogoutError(true); setResult({ state: "unresolved" }); }
    finally { setSigningOut(false); }
  }

  if (!ready) return <Notice title="로그인 상태를 확인하고 있어요." />;
  if (!client || !actor) return <section className="account-section"><Notice title={client ? "로그인이 필요해요." : "로그인을 준비하고 있어요."}>
    {client ? "이메일로 로그인하면 계정을 확인할 수 있습니다." : "인증 서비스 연결 후 이용할 수 있습니다."}
  </Notice>{logoutError && <Notice title="서버 로그아웃을 확인하지 못했어요." tone="warning">이 기기의 로그인 정보는 지웠지만 서버 연결이 끊겼습니다. 다시 로그인해 계정 상태를 확인해 주세요.</Notice>}<div className="actions"><ButtonLink href={loginHref}>로그인하기</ButtonLink></div></section>;
  return <section className="account-section">
    {profile ? <>
      <span className="badge">계정 확인 완료</span>
      <h2>반가워요.</h2><p className="account-email">{profile.email}</p>
      <dl className="account-facts"><div><dt>계정 유형</dt><dd>{profile.global_role === "PLATFORM_ADMIN" ? "플랫폼 관리자" : profile.account_role === "STAFF" ? "운영 스태프" : "셀러"}</dd></div>
        <div><dt>프로필</dt><dd>{profile.profile_required ? "작성 필요" : "작성 완료"}</dd></div></dl>
      {profile.global_role === "PLATFORM_ADMIN" || profile.account_role === "STAFF" ? <div className="actions"><ButtonLink href="/markets">마켓 관리하기</ButtonLink></div> : <div className="actions"><ButtonLink href="/seller/profile">{profile.profile_required ? "셀러 프로필 작성" : "셀러 프로필 수정"}</ButtonLink><ButtonLink variant="secondary" href="/me/applications">내 신청 확인</ButtonLink></div>}
    </> : storageError ? <Notice title="요청 복구 정보를 보관할 수 없어요." tone="warning">브라우저의 사이트 저장 허용 여부를 확인한 뒤 새로고침해 주세요. 중복 처리를 막기 위해 요청을 시작하지 않았습니다.</Notice> : <RequestStatus result={result} loginHref={loginHref} onRetry={() => void load("manual")} onCurrent={() => void load("current")} />}
    {logoutError && <Notice title="로그아웃을 완료하지 못했어요." tone="danger">네트워크를 확인한 뒤 다시 로그아웃해 주세요. 공유 기기에서는 로그아웃 완료를 확인해 주세요.</Notice>}
    <div className="account-footer"><Button variant="secondary" onClick={signOut} disabled={signingOut} aria-busy={signingOut}>이 기기에서 로그아웃</Button><Link className="text-button" href="/">홈으로</Link></div>
  </section>;
}
