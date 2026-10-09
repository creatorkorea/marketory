"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import { statusLabels, type Market } from "@/lib/markets/form";
import { MarketAccess, type MarketSession } from "./access";
import { Button, ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
function List({ session, offset }: { session: MarketSession; offset: number }) {
  const [rows, setRows] = useState<Market[] | null>(null),
    [error, setError] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setRows(null);
    setError(false);
    void api(
      session.client,
      session.actor,
      `projects?limit=20&offset=${offset}`,
      controller.signal,
    )
      .then((r) => {
        if (controller.signal.aborted) return;
        if (r.status === 200 && Array.isArray(r.body.data))
          setRows(r.body.data as Market[]);
        else setError(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [session, offset, retry]);
  return (
    <section className="market-list">
      <div className="market-toolbar">
        <h2>{session.admin ? "전체 마켓" : "담당 마켓"}</h2>
        {session.canCreate && (
          <ButtonLink href="/markets/new">새 마켓 만들기</ButtonLink>
        )}
      </div>
      {error ? (
        <Notice title="마켓 목록을 불러오지 못했어요." tone="warning">
          <Button onClick={() => setRetry((v) => v + 1)}>다시 불러오기</Button>
        </Notice>
      ) : !rows ? (
        <Notice title="마켓을 불러오고 있어요." />
      ) : rows.length === 0 ? (
        <Notice
          title={
            offset ? "이 페이지에 마켓이 없어요." : "아직 등록된 마켓이 없어요."
          }
        >
          {session.admin
            ? "새 마켓을 초안으로 만들고 모집 조건을 준비해 보세요."
            : "배정된 마켓이 여기에 표시됩니다."}
        </Notice>
      ) : (
        <ul className="market-rows">
          {rows.map((p) => (
            <li key={p.project_id}>
              <div>
                <span className="badge">
                  {statusLabels[p.status] ?? p.status}
                </span>
                <h3>{p.name}</h3>
                <p className="muted">
                  {p.event_date} · {p.venue} ·{" "}
                  {p.target_team_count.toLocaleString("ko-KR")}팀
                </p>
              </div>
              {p.can_manage ? (
                <ButtonLink
                  variant="secondary"
                  href={`/markets/${p.project_id}`}
                >
                  마켓 설정
                </ButtonLink>
              ) : (
                <span className="muted">조회 권한 · 설정 변경 불가</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <nav className="actions" aria-label="마켓 페이지">
        {offset > 0 && (
          <ButtonLink
            variant="secondary"
            href={`/markets?offset=${Math.max(0, offset - 20)}`}
          >
            이전 20개
          </ButtonLink>
        )}
        <span>
          {Math.floor(offset / 20) + 1}페이지
          {rows?.length ? ` · ${offset + 1}–${offset + rows.length}번째` : ""}
        </span>
        {rows?.length === 20 && (
          <ButtonLink
            variant="secondary"
            href={`/markets?offset=${offset + 20}`}
          >
            다음 20개
          </ButtonLink>
        )}
      </nav>
    </section>
  );
}
export function MarketList({ offset }: { offset: number }) {
  return (
    <MarketAccess>
      {(session) => <List session={session} offset={offset} />}
    </MarketAccess>
  );
}
