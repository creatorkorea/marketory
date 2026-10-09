"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { SellerAccess, type SellerSession } from "./access";
import { api } from "@/lib/api/client";
import {
  applicationLabels,
  kstDisplay,
  type Application,
} from "@/lib/seller/form";
import { Notice } from "@/components/ui/notice";
import { Button, ButtonLink } from "@/components/ui/button";
function List({ session, offset }: { session: SellerSession; offset: number }) {
  const [rows, setRows] = useState<Application[] | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [hasMore, setHasMore] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    setRows(null);
    setError("");
    void api(
      session.client,
      session.actor,
      `me/applications?limit=20&offset=${offset}`,
      c.signal,
    )
      .then((r) => {
        if (c.signal.aborted) return;
        if (r.status !== 200) {
          setError(
            r.status === 401
              ? "로그인이 만료되었습니다. 내 계정에서 다시 로그인해 주세요."
              : "신청 목록을 불러오지 못했습니다.",
          );
          return;
        }
        const data = r.body.data;
        const list = Array.isArray(data)
          ? data
          : (data as { items: Application[] }).items;
        setRows(list as Application[]);
        const total = (data as { total?: number })?.total;
        setHasMore(
          typeof total === "number"
            ? offset + list.length < total
            : list.length === 20,
        );
      })
      .catch(() => {
        if (!c.signal.aborted) setError("신청 목록을 불러오지 못했습니다.");
      });
    return () => c.abort();
  }, [session, offset, retry]);
  if (error)
    return (
      <Notice title={error} tone="warning">
        <Button onClick={() => setRetry((v) => v + 1)}>다시 확인</Button>
        <ButtonLink variant="secondary" href="/account">
          내 계정 확인
        </ButtonLink>
      </Notice>
    );
  if (!rows) return <Notice title="내 신청을 불러오고 있어요." />;
  return (
    <section className="seller-list">
      <div className="market-toolbar">
        <p>
          {offset + 1}번째부터 {rows.length}개 표시
        </p>
        <ButtonLink href="/seller/profile" variant="secondary">
          셀러 프로필
        </ButtonLink>
      </div>
      {rows.length ? (
        <ul>
          {rows.map((app) => (
            <li key={app.application_id}>
              <div>
                <h2>{app.project?.name ?? "마켓 신청"}</h2>
                <p className="muted">
                  {app.product_name || "상품 소개 작성 전"}
                </p>
                <p className="hint">
                  {app.submitted_at
                    ? `접수 ${kstDisplay(app.submitted_at)}`
                    : "서버에 저장된 신청 초안"}
                </p>
              </div>
              <span className="badge">
                {applicationLabels[app.status] ?? app.status}
              </span>
              <Link
                className="button button-secondary"
                href={`/me/applications/${app.application_id}?offset=${offset}`}
              >
                {["DRAFT", "NEED_INFO"].includes(app.status)
                  ? "이어서 작성"
                  : "신청 상세"}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Notice
          title={
            offset ? "이 페이지에 신청이 없어요." : "아직 신청한 마켓이 없어요."
          }
        >
          {offset ? (
            <ButtonLink href="/me/applications">첫 페이지로</ButtonLink>
          ) : (
            "운영자가 공유한 마켓 링크에서 모집 안내를 확인하고 신청해 주세요."
          )}
        </Notice>
      )}
      <nav className="actions" aria-label="내 신청 페이지">
        {offset > 0 && (
          <ButtonLink
            variant="secondary"
            href={`/me/applications?offset=${Math.max(0, offset - 20)}`}
          >
            이전 20개
          </ButtonLink>
        )}
        {hasMore && (
          <ButtonLink
            variant="secondary"
            href={`/me/applications?offset=${offset + 20}`}
          >
            다음 20개
          </ButtonLink>
        )}
      </nav>
    </section>
  );
}
export function SellerApplicationList({ offset }: { offset: number }) {
  return (
    <SellerAccess>
      {(session) => <List session={session} offset={offset} />}
    </SellerAccess>
  );
}
