"use client";
import { useState, type FormEvent } from "react";
import type { components } from "@marketory/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ComponentPreview() {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [health, setHealth] = useState("");
  function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invalid = !name.trim();
    setError(invalid);
    setMessage(invalid ? "표시 이름을 입력해 주세요." : `‘${name.trim()}’ 표시를 확인했습니다. 저장된 내용은 없습니다.`);
    if (invalid) document.getElementById("preview-name")?.focus();
  }
  async function checkHealth() {
    setChecking(true); setHealth("");
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      const body: components["schemas"]["Health"] = await response.json();
      setHealth(response.ok && body.status === "ok" ? "API 프로세스가 응답했습니다. DB·업무 기능 확인은 별도입니다." : "API에 연결하지 못했습니다. 로컬 API 실행 상태를 확인한 뒤 다시 시도해 주세요.");
    } catch { setHealth("연결을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요."); }
    finally { setChecking(false); }
  }
  return <div className="preview-grid">
    <section className="specimen" aria-labelledby="field-title">
      <h2 id="field-title">입력과 피드백</h2><p>레이블·도움말·오류를 함께 보여줍니다.</p>
      <form onSubmit={preview} noValidate>
        <label htmlFor="preview-name">표시 이름 <span className="muted">(필수)</span></label>
        <Input id="preview-name" value={name} onChange={e => { setName(e.target.value); setMessage(""); setError(false); }}
          aria-invalid={error} aria-describedby="name-hint name-feedback" placeholder="예: 작은숲 공방" autoComplete="off" required />
        <p id="name-hint" className="hint">견본에서만 사용하는 이름입니다.</p>
        <p id="name-feedback" role="status" className={error ? "feedback error" : "feedback"}>{message}</p>
        <div className="actions"><Button type="submit">표시 확인</Button><Button variant="secondary" onClick={() => { setName(""); setMessage(""); setError(false); }}>초기화</Button></div>
      </form>
    </section>
    <section className="specimen" aria-labelledby="button-title">
      <h2 id="button-title">버튼과 연결 상태</h2><p>기본·보조·비활성·처리 중 상태를 확인합니다.</p>
      <div className="actions"><Button disabled>신청 준비 중</Button><span className="badge">견본</span></div>
      <div className="connection"><h3>개발 환경 연결 확인</h3><p>로컬 API의 생존 응답만 확인합니다.</p>
        <Button onClick={checkHealth} disabled={checking} aria-busy={checking} variant="secondary"><span className="busy-dot" aria-hidden="true">{checking ? "◌" : "↻"}</span>API 연결 확인</Button>
        <p role="status" className="feedback">{checking ? "연결 확인 중…" : health}</p>
      </div>
    </section>
  </div>;
}
