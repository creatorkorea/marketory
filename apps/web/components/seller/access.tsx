"use client";
import { useEffect, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthClient } from "@/lib/auth/client";
import { readAccess } from "@/lib/api/access-read";
import { AccessLoading } from "@/components/auth/access-loading";
import { api } from "@/lib/api/client";
import { Notice } from "@/components/ui/notice";
import { Button, ButtonLink } from "@/components/ui/button";
export type SellerSession = { client: SupabaseClient; actor: string };
export function SellerAccess({
  children,
}: {
  children: (session: SellerSession) => ReactNode;
}) {
  const [session, setSession] = useState<SellerSession | null>(null),
    [state, setState] = useState("loading"),
    [retry, setRetry] = useState(0),
    [retrying, setRetrying] = useState(false);
  useEffect(() => {
    let alive = true,
      current: string | null = null,
      stop: (() => void) | undefined;
    let controller = new AbortController();
    setSession(null);
    setState("loading");
    setRetrying(false);
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
          controller.abort();
          controller = new AbortController();
          const signal = controller.signal;
          setSession(null);
          setState(id ? "loading" : "login");
          setRetrying(false);
          if (!id) return;
          try {
            const r = await readAccess(
              () => api(client, id, "me", signal), signal,
              () => { if (alive && !signal.aborted) setRetrying(true); },
            );
            if (!alive || signal.aborted) return;
            const data = r.body.data as
              { account_role?: string; user_id?: string } | undefined;
            if (
              r.status === 200 &&
              data?.user_id === id &&
              data.account_role === "SELLER"
            ) {
              setSession({ client, actor: id });
              setState("ready");
            } else
              setState(
                r.status === 401
                  ? "login"
                  : r.status === 403 || r.status === 200
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
        stop = () => data.subscription.unsubscribe();
        const initial = await client.auth.getSession();
        void update(initial.data.session?.user.id ?? null);
      })
      .catch(() => {
        if (alive) setState("error");
      });
    return () => {
      alive = false;
      controller.abort();
      stop?.();
    };
  }, [retry]);
  if (session) return <div key={session.actor}>{children(session)}</div>;
  return (
    <section className="market-placeholder">
      {state === "loading" ? (
        <AccessLoading key={retry} title="셀러 계정을 확인하고 있어요." retrying={retrying} />
      ) : <Notice
        title={
          state === "loading"
            ? "셀러 계정을 확인하고 있어요."
            : state === "login"
              ? "로그인이 필요해요."
              : state === "forbidden"
                ? "셀러 계정으로 이용해 주세요."
                : "셀러 정보를 불러오지 못했어요."
        }
      >
        {state === "login"
          ? "내 계정에서 이메일 인증을 완료한 뒤 이 마켓 링크로 돌아와 주세요."
          : state === "error"
            ? "연결이 지연되거나 일시적으로 끊겼어요. 잠시 후 다시 확인해 주세요."
            : "계정과 이용 권한을 확인합니다."}
      </Notice>}
      <div className="actions">
        {state === "error" && (
          <Button onClick={() => setRetry((v) => v + 1)}>다시 확인</Button>
        )}
        <ButtonLink href="/account">내 계정 확인</ButtonLink>
      </div>
    </section>
  );
}
