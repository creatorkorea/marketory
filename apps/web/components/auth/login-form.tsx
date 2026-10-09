"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthClient, authError } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

export function LoginForm() {
  const router = useRouter();
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [ready, setReady] = useState(false);
  const [stage, setStage] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const working = useRef(false);
  const alive = useRef(true);
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    alive.current = true;
    void getAuthClient().then((value) => { if (alive.current) { setClient(value); setReady(true); } });
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  useEffect(() => { if (stage === "code") codeRef.current?.focus(); }, [stage]);

  async function send() {
    if (!client || working.current || cooldown > 0) return;
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 254) { setError("이메일 주소를 확인해 주세요."); emailRef.current?.focus(); return; }
    working.current = true; setBusy(true); setError(""); setMessage("");
    setCooldown(60);
    try {
      const result = await client.auth.signInWithOtp({ email: value, options: { shouldCreateUser: true } });
      if (!alive.current) return;
      if (result.error) { setError(authError(result.error)); return; }
      setEmail(value); setCode(""); setStage("code"); setMessage("인증번호 전송을 요청했습니다. 받은 메일함과 스팸함을 확인해 주세요.");
    } catch { if (alive.current) setError("전송 결과를 확인하지 못했습니다. 메일함을 확인하고 잠시 후 다시 요청해 주세요."); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (stage === "email") { await send(); return; }
    if (!client || working.current) return;
    if (!/^\d{6,10}$/.test(code.trim())) { setError("메일로 받은 인증번호를 숫자로 입력해 주세요."); codeRef.current?.focus(); return; }
    working.current = true; setBusy(true); setError("");
    try {
      const result = await client.auth.verifyOtp({ email, token: code.trim(), type: "email" });
      if (!alive.current) return;
      if (result.error || !result.data.session) { setError(authError(result.error, true)); codeRef.current?.focus(); return; }
      setCode(""); router.replace("/account");
    } catch { if (alive.current) setError(authError(null)); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }

  return <section className="auth-panel" aria-labelledby="login-title">
    <p className="eyebrow">마켓토리 시작하기</p>
    <h1 id="login-title">{stage === "email" ? "이메일로 시작해요." : "메일을 확인해 주세요."}</h1>
    <p className="intro">{stage === "email" ? "비밀번호 없이, 이메일 인증번호로 로그인하세요. 처음이라면 계정이 함께 만들어집니다." : `${email} 주소로 받은 인증번호를 입력하세요.`}</p>
    {ready && !client && <Notice title="로그인을 준비하고 있어요." tone="warning">인증 서비스가 아직 연결되지 않았습니다. 연결이 완료되면 이메일로 시작할 수 있어요.</Notice>}
    <form noValidate onSubmit={submit} aria-busy={busy}>
      {stage === "email" ? <Field ref={emailRef} id="email" label="이메일" type="email" autoComplete="email" inputMode="email" maxLength={254} value={email} onChange={(event) => { setEmail(event.target.value); setError(""); }} placeholder="hello@example.com" error={error} hint="마켓 소식을 확인할 이메일을 사용해 주세요." disabled={busy} /> : <>
        <Field ref={codeRef} id="code" label="인증번호" type={showCode ? "text" : "password"} inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={code} onChange={(event) => { setCode(event.target.value); setError(""); }} error={error} hint="가장 최근에 받은 번호를 입력해 주세요." disabled={busy} />
        <button type="button" className="text-button" aria-pressed={showCode} onClick={() => setShowCode(!showCode)}>{showCode ? "인증번호 숨기기" : "인증번호 보기"}</button>
      </>}
      <Button className="auth-submit" type="submit" disabled={!client || busy || (stage === "email" && cooldown > 0)} aria-busy={busy}>
        <span className="button-label">{stage === "email" ? "인증번호 받기" : "인증하고 계속하기"}</span><span className="busy-dot" aria-hidden="true">{busy ? "···" : "→"}</span>
      </Button>
      <p className="auth-feedback muted" role="status">{!ready ? "로그인 서비스를 확인하고 있어요." : busy ? "요청을 처리하고 있어요." : message}</p>
      {stage === "code" && <div className="auth-links">
        <Button variant="secondary" onClick={send} disabled={busy || cooldown > 0}>{cooldown > 0 ? `${cooldown}초 후 다시 받기` : "인증번호 다시 받기"}</Button>
        <button className="text-button" type="button" disabled={busy} onClick={() => { setStage("email"); setCode(""); setError(""); setMessage(""); queueMicrotask(() => emailRef.current?.focus()); }}>이메일 변경</button>
      </div>}
      {stage === "email" && cooldown > 0 && <p className="hint">다시 요청하려면 {cooldown}초만 기다려 주세요.</p>}
    </form>
  </section>;
}
