"use client";

import { useEffect, useState } from "react";
import type { components } from "@marketory/types";
import { Button, ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { kstDisplay } from "@/lib/seller/form";

type Market = components["schemas"]["PublicProjectSummary"];
type Catalog = components["schemas"]["PublicProjectList"];

export function RecruitingMarkets() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [pending, setPending] = useState(true);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setPending(true);
    setError(false);
    setSlow(false);
    const timer = setTimeout(() => setSlow(true), 8000);
    void (async () => {
      try {
        const response = await fetch(`/api/backend/public/projects?limit=12&offset=${offset}`, {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(22000)]),
        });
        if (!response.ok) throw new Error("catalog unavailable");
        const body: Catalog = await response.json();
        if (controller.signal.aborted) return;
        setMarkets(previous => {
          const combined = offset === 0 ? body.data : [...previous, ...body.data];
          return [...new Map(combined.map(market => [market.project_id, market])).values()];
        });
        setNextOffset(offset + body.data.length);
        setHasMore(body.has_more);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        clearTimeout(timer);
        if (!controller.signal.aborted) setPending(false);
      }
    })();
    return () => { clearTimeout(timer); controller.abort(); };
  }, [offset, retry]);

  return <section id="recruiting" className="recruiting" aria-labelledby="recruiting-title" tabIndex={-1}>
    <div className="recruiting-heading">
      <div>
        <h2 id="recruiting-title">모집 중인 마켓</h2>
        <p className="muted">마감이 가까운 순서예요. 모집 안내에서 참가 조건을 확인해 주세요.</p>
      </div>
      <ButtonLink variant="secondary" href="/me/applications">내 신청 확인</ButtonLink>
    </div>
    <div className="recruiting-content" aria-busy={pending}>
      {markets.length > 0 && <ul className="recruiting-list">
        {markets.map(market => <li key={market.project_id} className="recruiting-market">
          <div>
            <span className="badge recruiting-badge">모집 중</span>
            <h3>{market.name}</h3>
            <p className="muted">{market.allowed_categories.join(" · ")}</p>
          </div>
          <dl className="recruiting-facts">
            <div><dt>행사일</dt><dd><time dateTime={market.event_date}>{market.event_date.replaceAll("-", ". ")}</time></dd></div>
            <div><dt>장소</dt><dd>{market.venue}</dd></div>
            <div><dt>모집 마감</dt><dd><time dateTime={market.recruit_end_at}>{kstDisplay(market.recruit_end_at)}</time> (한국시간)</dd></div>
            <div><dt>참가비</dt><dd>{market.participation_fee_krw.toLocaleString("ko-KR")}원</dd></div>
          </dl>
          <ButtonLink href={`/p/${market.project_id}`} aria-label={`${market.name} 모집 안내 보기`}>모집 안내 보기 <span aria-hidden="true">→</span></ButtonLink>
        </li>)}
      </ul>}
      {pending && <Notice title={markets.length ? "마켓을 더 불러오고 있어요." : "모집 중인 마켓을 불러오고 있어요."}>
        {slow ? "연결이 평소보다 오래 걸리고 있어요. 잠시 기다려 주세요." : "모집 기간과 신청 가능 여부를 확인하고 있어요."}
      </Notice>}
      {error && <Notice title="모집 정보를 불러오지 못했어요." tone="warning">
        연결 상태를 확인한 뒤 다시 시도해 주세요. 기존 신청은 내 신청에서 확인할 수 있어요.
        <div className="actions"><Button onClick={() => { setPending(true); setError(false); setRetry(value => value + 1); }}>다시 확인</Button></div>
      </Notice>}
      {!pending && !error && markets.length === 0 && <Notice title="지금은 모집 중인 마켓이 없어요.">
        새로운 모집이 열리면 이곳에 표시돼요. 이미 신청한 마켓은 내 신청에서 확인해 주세요.
      </Notice>}
    </div>
    {!error && hasMore && <div className="actions">
      <Button variant="secondary" disabled={pending} aria-busy={pending} onClick={() => { setPending(true); setOffset(nextOffset); }}>마켓 더 보기</Button>
    </div>}
  </section>;
}
