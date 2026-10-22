"use client";

import { useEffect, useState } from "react";
import type { SellerSession } from "./access";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { kstDisplay } from "@/lib/seller/form";

type PublishedNotice = {
  communication_id?: string;
  announcement_id?: string;
  subject: string;
  body: string;
  content_version: number;
  published_at: string;
};
type Page = {
  items: PublishedNotice[];
  has_more: boolean;
  offset: number;
  limit: number;
};

export function SellerNotices({
  session,
  applicationId,
  common = false,
}: {
  session: SellerSession;
  applicationId: string;
  common?: boolean;
}) {
  const title = common ? "마켓 공통 안내" : "내 신청 개별 안내";
  const sectionId = common ? "market-notices-title" : "seller-notices-title";
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [pending, setPending] = useState(true);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setPage(null);
    setPending(true);
    setError("");
    setSlow(false);
    const timer = setTimeout(() => setSlow(true), 8000);
    void (async () => {
      try {
        const response = await api(
          session.client,
          session.actor,
          `applications/${applicationId}/${common ? "market-notices" : "notices"}?limit=5&offset=${offset}`,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          setError("로그인 상태를 확인한 뒤 다시 불러와 주세요.");
        } else if (response.status === 403 || response.status === 404) {
          setError("이 신청의 안내를 조회할 수 없습니다.");
        } else if (response.status !== 200) {
          setError("운영 안내를 불러오지 못했어요.");
        } else {
          setPage(response.body.data as Page);
        }
      } catch {
        if (!controller.signal.aborted)
          setError("운영 안내를 불러오지 못했어요.");
      } finally {
        clearTimeout(timer);
        if (!controller.signal.aborted) setPending(false);
      }
    })();
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [applicationId, session.client, session.actor, offset, retry, common]);

  return (
    <section
      className="market-section seller-notices"
      aria-labelledby={sectionId}
    >
      <div className="actions">
        <h3 id={sectionId}>{title}</h3>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => {
            setOffset(0);
            setRetry((v) => v + 1);
          }}
        >
          {common ? "공통 안내 새로고침" : "안내 새로고침"}
        </Button>
      </div>
      <p className="muted">
        {common
          ? "운영자가 마켓 참가자에게 게시한 공통 안내입니다."
          : "운영자가 이 신청에 게시한 안내입니다."}{" "}
        최신 안내부터 확인해 주세요.
      </p>
      <div aria-busy={pending}>
        {pending && (
          <Notice title="운영 안내를 확인하고 있어요.">
            {slow && "연결에 시간이 걸리고 있어요. 잠시 기다려 주세요."}
          </Notice>
        )}
        {error && (
          <Notice title={error} tone="warning">
            <Button onClick={() => setRetry((v) => v + 1)}>
              다시 불러오기
            </Button>
          </Notice>
        )}
        {page && page.items.length === 0 && (
          <Notice
            title={
              offset === 0
                ? "아직 게시된 운영 안내가 없어요."
                : "이 페이지에 안내가 없어요."
            }
          />
        )}
        {page?.items.map((item) => (
          <article
            className="seller-notice"
            key={item.announcement_id ?? item.communication_id}
          >
            <h4 className="seller-prose">{item.subject}</h4>
            <p className="muted">게시 {kstDisplay(item.published_at)} (KST)</p>
            <p className="seller-prose">{item.body}</p>
          </article>
        ))}
      </div>
      {(offset > 0 || page?.has_more) && (
        <nav className="actions" aria-label={`${title} 페이지`}>
          <Button
            variant="secondary"
            disabled={pending || offset === 0}
            onClick={() => setOffset((v) => Math.max(0, v - 5))}
          >
            이전 안내
          </Button>
          <span>{Math.floor(offset / 5) + 1}페이지</span>
          <Button
            variant="secondary"
            disabled={pending || !page?.has_more}
            onClick={() => setOffset((v) => v + 5)}
          >
            다음 안내
          </Button>
        </nav>
      )}
    </section>
  );
}
