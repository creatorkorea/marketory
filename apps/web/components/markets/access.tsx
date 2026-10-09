"use client";
import { useEffect, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthClient } from "@/lib/auth/client";
import { api } from "@/lib/api/client";
import { Button, ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
export type MarketSession = {
  client: SupabaseClient;
  actor: string;
  admin: boolean;
  canCreate: boolean;
};
export function MarketAccess({
  children,
}: {
  children: (session: MarketSession) => ReactNode;
}) {
  const [session, setSession] = useState<MarketSession | null>(null),
    [state, setState] = useState("loading"),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    let active = new AbortController();
    let current: string | null = null;
    setSession(null);
    setState("loading");
    void getAuthClient()
      .then(async (client) => {
        if (!alive) return;
        if (!client) {
          setState("error");
          return;
        }
        const update = async (id: string | null) => {
          if (!alive || (id && current === id)) return;
          current = id;
          active.abort();
          active = new AbortController();
          const signal = active.signal;
          setSession(null);
          setState(id ? "loading" : "login");
          if (!id) return;
          try {
            const r = await api(client, id, "me", signal);
            if (!alive || signal.aborted) return;
            const p = r.body.data as
              | {
                  global_role: string;
                  account_role: string;
                  can_create_project?: boolean;
                }
              | undefined;
            if (
              r.status === 200 &&
              (p?.global_role === "PLATFORM_ADMIN" ||
                p?.account_role === "STAFF")
            ) {
              setSession({
                client,
                actor: id,
                admin: p.global_role === "PLATFORM_ADMIN",
                canCreate: p.can_create_project === true,
              });
              setState("ready");
            } else
              setState(
                r.status === 401
                  ? "login"
                  : r.status === 200 || r.status === 403
                    ? "forbidden"
                    : "error",
              );
          } catch {
            if (alive && !signal.aborted) setState("error");
          }
        };
        const { data } = client.auth.onAuthStateChange((_event, s) => {
          void update(s?.user.id ?? null);
        });
        unsubscribe = () => data.subscription.unsubscribe();
        const { data: initial } = await client.auth.getSession();
        void update(initial.session?.user.id ?? null);
      })
      .catch(() => {
        if (alive) setState("error");
      });
    return () => {
      alive = false;
      active.abort();
      unsubscribe?.();
    };
  }, [retry]);
  if (session) return <div key={session.actor}>{children(session)}</div>;
  return (
    <section className="market-placeholder">
      <Notice
        title={
          {
            loading: "운영 권한을 확인하고 있어요.",
            login: "로그인이 필요해요.",
            forbidden: "마켓 운영 권한이 필요해요.",
            error: "운영 정보를 불러오지 못했어요.",
          }[state] ?? "확인 중"
        }
      >
        {state === "forbidden"
          ? "관리자가 이 계정에 마켓 역할을 배정한 뒤 이용할 수 있습니다."
          : state === "error"
            ? "연결 상태를 확인한 뒤 다시 시도해 주세요."
            : "계정과 배정된 마켓을 확인합니다."}
      </Notice>
      <div className="actions">
        {state === "error" && (
          <Button onClick={() => setRetry((v) => v + 1)}>다시 확인</Button>
        )}
        {state === "login" && <ButtonLink href="/login">로그인하기</ButtonLink>}
        <ButtonLink variant="secondary" href="/account">
          내 계정
        </ButtonLink>
      </div>
    </section>
  );
}
