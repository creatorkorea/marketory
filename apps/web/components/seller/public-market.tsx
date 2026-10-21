"use client";
import { useEffect, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { kstDisplay, type PublicProject } from "@/lib/seller/form";
export function PublicMarket({ id }: { id: string }) {
  const [project, setProject] = useState<PublicProject | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setProject(null);
    setError("");
    void fetch(`/api/backend/public/projects/${id}`, {
      cache: "no-store",
      signal: c.signal,
    })
      .then(async (r) => {
        const body = await r.json();
        if (c.signal.aborted) return;
        if (!r.ok) {
          setError(
            r.status === 404
              ? "공개된 마켓을 찾을 수 없어요."
              : "마켓 정보를 불러오지 못했어요.",
          );
          return;
        }
        setProject(body.data);
      })
      .catch(() => {
        if (!c.signal.aborted) setError("마켓 정보를 불러오지 못했어요.");
      });
    return () => c.abort();
  }, [id, retry]);
  if (error)
    return (
      <Notice title={error} tone="warning">
        <Button onClick={() => setRetry((v) => v + 1)}>다시 확인</Button>
      </Notice>
    );
  if (!project) return <Notice title="마켓 정보를 불러오고 있어요." />;
  return (
    <article className="seller-public">
      <div className="public-market-back"><ButtonLink variant="secondary" href="/#recruiting">모집 마켓 목록으로</ButtonLink></div>
      <p className="eyebrow">마켓토리 · 셀러 모집</p>
      <h1>{project.name}</h1>
      <p className="intro">함께할 상품과 이야기를 기다립니다.</p>
      <dl className="seller-facts">
        <div>
          <dt>행사 날짜</dt>
          <dd>{project.event_date}</dd>
        </div>
        <div>
          <dt>장소</dt>
          <dd>{project.venue}</dd>
        </div>
        <div>
          <dt>모집 기간 (한국시간)</dt>
          <dd>
            {kstDisplay(project.recruit_start_at)} ~{" "}
            {kstDisplay(project.recruit_end_at)}
          </dd>
        </div>
        <div>
          <dt>행사 종료 (한국시간)</dt>
          <dd>{kstDisplay(project.event_end_at)}</dd>
        </div>
        <div>
          <dt>참가비</dt>
          <dd>
            {project.policy_json.participation_fee_krw.toLocaleString("ko-KR")}
            원
          </dd>
        </div>
      </dl>
      <section className="market-section">
        <h2>모집하는 상품</h2>
        <div className="seller-tags">
          {project.policy_json.allowed_categories.map((category) => (
            <span className="badge" key={category}>
              {category}
            </span>
          ))}
        </div>
        {project.policy_json.restricted_items.length > 0 && (
          <p>제한 품목: {project.policy_json.restricted_items.join(", ")}</p>
        )}
        <p>
          상품 사진 {project.policy_json.photo_required ? "필수" : "선택"} ·
          사업자 증빙 {project.policy_json.business_required ? "필수" : "선택"}
        </p>
      </section>
      <section className="market-section">
        <h2>부스 및 운영 안내</h2>
        <p className="seller-prose">
          {project.booth_policy_json.description || "등록된 안내가 없습니다."}
        </p>
      </section>
      {project.accepting_applications ? (
        <div className="actions">
          <ButtonLink href={`/p/${id}/apply`}>마켓 신청하기</ButtonLink>
          <ButtonLink variant="secondary" href="/me/applications">
            내 신청 확인
          </ButtonLink>
        </div>
      ) : (
        <Notice title="현재 신규 신청을 받지 않아요.">
          모집 기간을 확인해 주세요. 기존 신청은 내 신청에서 볼 수 있습니다.
          <div className="actions">
            <ButtonLink href="/me/applications">내 신청 확인</ButtonLink>
          </div>
        </Notice>
      )}
    </article>
  );
}
