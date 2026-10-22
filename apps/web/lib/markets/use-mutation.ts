"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import { recover, type Recovery } from "@/lib/requests/recovery";
import type { MarketSession } from "@/components/markets/access";
type Pending = {
  key: string;
  operation: string;
  path: string;
  method: "POST" | "PATCH";
  body?: Record<string, unknown>;
};
export function useMarketMutation(
  session: Pick<MarketSession, "actor" | "client">,
  scope: string,
  onSuccess: (data: Record<string, unknown>) => void,
) {
  const name = `marketory:mutation:${session.actor}:${scope}`;
  const [result, setResult] = useState<Recovery | null>(null),
    [pending, setPending] = useState<Pending | null>(null),
    [storageError, setStorageError] = useState(false);
  const busy = useRef(false),
    pendingRef = useRef<Pending | null>(null),
    controller = useRef<AbortController | null>(null),
    success = useRef(onSuccess);
  success.current = onSuccess;
  useEffect(() => {
    try {
      const text = sessionStorage.getItem(name);
      if (text) {
        const p = JSON.parse(text) as Pending;
        if (
          !/^[0-9a-f-]{36}$/i.test(p.key) ||
          !/^(announcements\.(create|revise|approve|publish|unpublish)|communications\.(generate|approve|send|retry|revise|resolve|publish|unpublish)|projects\.(create|update|status|members)|sellers\.save|applications\.(create|update|submit|resubmit|cancel|confirm)|booths\.(create|update|draft|confirm|release)|reviews\.(start|request_info|extend_info|decision|extend_confirmation|note)|attachments\.(issue|complete|detach|abandon))$/.test(
            p.operation,
          )
        )
          throw new Error();
        setPending(p);
        pendingRef.current = p;
        setResult({ state: "unresolved" });
      }
    } catch {
      setStorageError(true);
    }
    return () => {
      controller.current?.abort();
    };
  }, [name]);
  const run = async (p: Pending, resume: boolean) => {
    if (busy.current) return;
    busy.current = true;
    const abort = new AbortController();
    controller.current = abort;
    const signal = abort.signal;
    try {
      const r = await recover({
        signal,
        resume,
        automatic: !resume,
        onState: (r) => {
          if (!signal.aborted) setResult(r);
        },
        execute: () =>
          p.body
            ? api(session.client, session.actor, p.path, signal, p.key, {
                method: p.method,
                body: p.body,
              })
            : Promise.resolve({ status: 202, body: { code: "UNRESOLVED" } }),
        lookup: () =>
          api(
            session.client,
            session.actor,
            `me/requests/${p.operation}/${p.key}`,
            signal,
          ),
      });
      if (r.state === "succeeded") {
        sessionStorage.removeItem(name);
        setPending(null);
        pendingRef.current = null;
        success.current(r.body!.data as Record<string, unknown>);
      } else if (["failed", "conflict"].includes(r.state)) {
        sessionStorage.removeItem(name);
        setPending(null);
        pendingRef.current = null;
      }
      return r;
    } catch {
      if (!signal.aborted) setResult({ state: "unresolved" });
    } finally {
      if (controller.current === abort) busy.current = false;
    }
  };
  const start = (
    operation: string,
    path: string,
    method: "POST" | "PATCH",
    body: Record<string, unknown>,
  ) => {
    if (busy.current || pendingRef.current || storageError) return;
    const p = {
      key: crypto.randomUUID(),
      operation,
      path,
      method,
      body: structuredClone(body),
    };
    try {
      const { body: _, ...marker } = p;
      sessionStorage.setItem(name, JSON.stringify(marker));
    } catch {
      setStorageError(true);
      return;
    }
    setPending(p);
    pendingRef.current = p;
    return run(p, false);
  };
  return {
    result,
    pending,
    storageError,
    locked: !!pending || storageError,
    start,
    retry: () => {
      if (pending) void run(pending, true);
    },
    clear: useCallback(() => setResult(null), []),
  };
}
