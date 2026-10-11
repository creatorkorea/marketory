"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MarketAccess, type MarketSession } from "@/components/markets/access";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { api } from "@/lib/api/client";
import { applicationLabels, reviewQuery } from "@/lib/reviews/form";
import { kstDisplay } from "@/lib/seller/form";

type Row = {
  application_id: string;
  shop_name: string;
  product_name: string;
  category: string;
  status: string;
  submitted_at?: string;
  info_due_at?: string;
  confirm_due_at?: string;
};
type ListData = {
  items: Row[];
  total: number;
  limit: number;
  offset: number;
  project: { name: string };
  role: string;
};
type Summary = {
  counts: Record<string, number>;
  occupied: number;
  target: number;
};
function List({
  session,
  id,
  query,
}: {
  session: MarketSession;
  id: string;
  query: string;
}) {
  const router = useRouter();
  const params = new URLSearchParams(query);
  const [data, setData] = useState<ListData | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setData(null);
    setSummary(null);
    setError("");
    void (async () => {
      try {
        const r = await api(
          session.client,
          session.actor,
          `projects/${id}/applications?${query}`,
          c.signal,
        );
        if (c.signal.aborted) return;
        if (r.status === 200) setData(r.body.data as ListData);
        else if (r.status === 403) {
          const s = await api(
            session.client,
            session.actor,
            `projects/${id}/application-summary`,
            c.signal,
          );
          if (c.signal.aborted) return;
          if (s.status === 200) setSummary(s.body.data as Summary);
          else setError("이 마켓의 신청을 조회할 권한이 없어요.");
        } else
          setError(
            r.status === 401
              ? "로그인이 필요해요."
              : "신청 목록을 불러오지 못했어요.",
          );
      } catch {
        if (!c.signal.aborted) setError("신청 목록을 불러오지 못했어요.");
      }
    })();
    return () => c.abort();
  }, [session, id, query, retry]);
  const href = (offset: number) => {
    const q = new URLSearchParams(query);
    q.set("offset", String(offset));
    return `/markets/${id}/applications?${q}`;
  };
  return (
    <section className="review-list">
      <ButtonLink href="/markets" variant="secondary">
        마켓 목록
      </ButtonLink>
      {data && (
        <ButtonLink href={`/markets/${id}/booths`} variant="secondary">
          부스 배치
        </ButtonLink>
      )}
      {data && (session.admin || data.role === "OPERATOR") && (
        <ButtonLink href={`/markets/${id}/communications`} variant="secondary">
          셀러 안내
        </ButtonLink>
      )}
      {data && <h2>{data.project.name}</h2>}
      {!summary && (
        <form
          className="review-filters"
          key={query}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            router.push(
              `/markets/${id}/applications?${reviewQuery({ status: String(f.get("status")), category: String(f.get("category")), limit: String(f.get("limit")) })}`,
            );
          }}
        >
          <div className="field">
            <label htmlFor="review-status">신청 상태</label>
            <select
              className="input"
              id="review-status"
              name="status"
              defaultValue={params.get("status") ?? ""}
            >
              <option value="">전체 상태</option>
              {Object.entries(applicationLabels)
                .filter(([k]) => k !== "DRAFT")
                .map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
            </select>
          </div>
          <Field
            id="review-category"
            name="category"
            label="카테고리"
            defaultValue={params.get("category") ?? ""}
            hint="정확한 카테고리 이름"
          />
          <div className="field">
            <label htmlFor="review-limit">페이지당 신청</label>
            <select
              className="input"
              id="review-limit"
              name="limit"
              defaultValue={params.get("limit") ?? "20"}
            >
              {[10, 20, 50].map((n) => (
                <option key={n} value={n}>
                  {n}개
                </option>
              ))}
            </select>
          </div>
          <Button type="submit">필터 적용</Button>
          <ButtonLink variant="secondary" href={`/markets/${id}/applications`}>
            초기화
          </ButtonLink>
        </form>
      )}
      {error ? (
        <Notice tone="warning" title={error}>
          <Button onClick={() => setRetry((v) => v + 1)}>다시 불러오기</Button>
        </Notice>
      ) : summary ? (
        <section>
          <Notice title="집계 조회 권한입니다.">
            신청 원문과 개인정보는 제공되지 않습니다.
          </Notice>
          <h2>
            선정·참가확정 {summary.occupied} / {summary.target}팀
          </h2>
          <dl className="seller-facts">
            {Object.entries(summary.counts).map(([k, v]) => (
              <div key={k}>
                <dt>{applicationLabels[k] ?? k}</dt>
                <dd>{v}팀</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : !data ? (
        <Notice title="신청 목록을 불러오고 있어요." />
      ) : (
        <>
          <p className="muted" role="status">
            총 {data.total.toLocaleString("ko-KR")}건 ·{" "}
            {data.items.length
              ? `${data.offset + 1}–${data.offset + data.items.length}번째`
              : "0건 표시"}
          </p>
          {!data.items.length ? (
            <Notice title="조건에 맞는 신청이 없어요.">
              필터를 초기화하거나 이전 페이지를 확인해 주세요.
            </Notice>
          ) : (
            <table className="review-table">
              <caption className="sr-only">신청 목록</caption>
              <thead>
                <tr>
                  <th>셀러 / 상품</th>
                  <th>상태</th>
                  <th>카테고리</th>
                  <th>접수·처리 기한 (KST)</th>
                  <th>상세</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.application_id}>
                    <td>
                      <strong>{row.shop_name}</strong>
                      <p>{row.product_name}</p>
                    </td>
                    <td>
                      <span className="badge">
                        {applicationLabels[row.status] ?? row.status}
                      </span>
                    </td>
                    <td>{row.category}</td>
                    <td>
                      <p>접수 {kstDisplay(row.submitted_at)}</p>
                      {row.info_due_at && (
                        <p>보완 {kstDisplay(row.info_due_at)}</p>
                      )}
                      {row.confirm_due_at && (
                        <p>참가확정 {kstDisplay(row.confirm_due_at)}</p>
                      )}
                    </td>
                    <td>
                      <ButtonLink
                        variant="secondary"
                        href={`/markets/${id}/applications/${row.application_id}?${query}`}
                        aria-label={`${row.shop_name} 신청 상세`}
                      >
                        신청 상세
                      </ButtonLink>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <nav className="actions" aria-label="신청 페이지">
            {data.offset > 0 && (
              <ButtonLink
                variant="secondary"
                href={href(Math.max(0, data.offset - data.limit))}
              >
                이전 페이지
              </ButtonLink>
            )}
            <span>{Math.floor(data.offset / data.limit) + 1}페이지</span>
            {data.offset + data.limit < data.total && (
              <ButtonLink
                variant="secondary"
                href={href(data.offset + data.limit)}
              >
                다음 페이지
              </ButtonLink>
            )}
          </nav>
        </>
      )}
    </section>
  );
}
export function ReviewList(props: { id: string; query: string }) {
  return (
    <MarketAccess>
      {(session) => <List session={session} {...props} />}
    </MarketAccess>
  );
}
