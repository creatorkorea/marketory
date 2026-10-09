"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { MarketAccess, type MarketSession } from "@/components/markets/access";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { TextareaField } from "@/components/ui/textarea-field";
import { Notice } from "@/components/ui/notice";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { UnsavedGuard } from "@/components/ui/unsaved-guard";
import { Toast } from "@/components/ui/toast";
import { RequestStatus } from "@/components/requests/request-status";
import { SellerFileLink } from "@/components/seller/file-link";
import { api } from "@/lib/api/client";
import { useMarketMutation } from "@/lib/markets/use-mutation";
import { kstDisplay } from "@/lib/seller/form";
import {
  applicationLabels,
  reviewActions,
  reviewFields,
  reviewPayload,
  FormError,
  type ReviewApplication,
} from "@/lib/reviews/form";

function Editor({
  session,
  initial,
  back,
}: {
  session: MarketSession;
  initial: ReviewApplication;
  back: string;
}) {
  const [app, setApp] = useState(initial);
  const [latest, setLatest] = useState<ReviewApplication | null>(null);
  const [action, setAction] = useState("");
  const [error, setError] = useState<FormError | null>(null);
  const [loadError, setLoadError] = useState("");
  const [denied, setDenied] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState("");
  const [confirmation, setConfirmation] = useState<{
    action: string;
    body: Record<string, unknown>;
  } | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const reader = useRef<AbortController | null>(null);
  useEffect(() => () => reader.current?.abort(), []);
  const mutation = useMarketMutation(
    session,
    `review:${app.application_id}`,
    (data) => {
      setApp(data as unknown as ReviewApplication);
      setLatest(null);
      setAction("");
      setDirty(false);
      setError(null);
      form.current?.reset();
      setToast("신청 처리 내용을 저장했어요.");
    },
  );
  const actions = app.allowed_actions.filter(
    (a) => reviewActions[a] && (app.role === "OPERATOR" || a === "note"),
  );
  const chosen =
    action && actions.includes(action) ? action : (actions[0] ?? "");
  const stale = mutation.result?.state === "conflict";
  const locked = mutation.locked || stale || !!latest;
  async function current() {
    reader.current?.abort();
    const c = new AbortController();
    reader.current = c;
    setLoadError("");
    try {
      const r = await api(
        session.client,
        session.actor,
        `review/applications/${app.application_id}`,
        c.signal,
      );
      if (c.signal.aborted) return;
      if ([401, 403, 404].includes(r.status)) {
        setDenied(true);
        return;
      }
      if (r.status !== 200) throw new Error();
      const next = r.body.data as ReviewApplication;
      // A role change must immediately remove the previous projection.
      if (next.role !== app.role) {
        setApp(next);
        setAction("");
        setDirty(false);
        form.current?.reset();
        mutation.clear();
      } else setLatest(next);
    } catch {
      if (!c.signal.aborted)
        setLoadError("최신 신청을 불러오지 못했어요. 입력은 유지됩니다.");
    }
  }
  function execute(value: { action: string; body: Record<string, unknown> }) {
    const meta = reviewActions[value.action];
    setConfirmation(null);
    void mutation.start(
      meta.operation,
      `applications/${app.application_id}/${meta.route}`,
      "POST",
      value.body,
    );
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (locked || !chosen) return;
    setError(null);
    try {
      const body = reviewPayload(chosen, new FormData(e.currentTarget), app);
      if (chosen === "note") execute({ action: chosen, body });
      else setConfirmation({ action: chosen, body });
    } catch (err) {
      if (err instanceof FormError) {
        setError(err);
        requestAnimationFrame(() => {
          const control = form.current?.querySelector<HTMLElement>(
            `[name="${err.field}"]`,
          );
          control?.focus();
        });
      }
    }
  }
  if (denied || mutation.result?.state === "forbidden")
    return (
      <Notice title="이 신청을 조회할 권한이 없어요." tone="warning">
        <ButtonLink href={back} variant="secondary">
          신청 목록
        </ButtonLink>
      </Notice>
    );
  return (
    <>
      <UnsavedGuard active={dirty || mutation.locked} />
      <ButtonLink variant="secondary" href={back}>
        신청 목록으로
      </ButtonLink>
      <header className="seller-detail-heading">
        <div>
          <span className="badge">
            {applicationLabels[app.status] ?? app.status}
          </span>
          <h2>{app.seller.shop_name}</h2>
          <p className="muted">
            {app.project.name} · {app.category}
          </p>
        </div>
        <p>
          선정·참가확정{" "}
          <strong>
            {app.capacity.occupied} / {app.capacity.target}팀
          </strong>
        </p>
      </header>
      {app.role === "REVIEWER" && (
        <Notice title="검수자 열람 화면입니다.">
          연락처는 마스킹됩니다. 상품 자료를 확인하고 내부 메모를 남길 수
          있습니다.
        </Notice>
      )}
      <div className="review-detail-grid">
        <div>
          <section className="review-section">
            <h2>신청 자료</h2>
            <dl className="seller-facts">
              <div>
                <dt>상품명</dt>
                <dd>{app.product_name}</dd>
              </div>
              <div>
                <dt>상품 소개</dt>
                <dd className="seller-prose">{app.product_desc}</dd>
              </div>
              <div>
                <dt>가격대</dt>
                <dd>{app.price_range}</dd>
              </div>
              <div>
                <dt>대표자</dt>
                <dd>{app.seller.owner_name}</dd>
              </div>
              <div>
                <dt>전화번호</dt>
                <dd>{app.seller.phone}</dd>
              </div>
              <div>
                <dt>이메일</dt>
                <dd>{app.seller.email}</dd>
              </div>
              <div>
                <dt>운영 조건</dt>
                <dd>
                  테이블 {app.table_count}개 · 전기{" "}
                  {app.electricity_required ? "필요" : "불필요"} · 화기{" "}
                  {app.fire_required ? "사용" : "미사용"} · 냉장{" "}
                  {app.cold_storage_required ? "필요" : "불필요"} · 차량{" "}
                  {app.vehicle_entry_required ? "진입" : "미진입"}
                </dd>
              </div>
              <div>
                <dt>요청 사항</dt>
                <dd className="seller-prose">{app.request_note || "없음"}</dd>
              </div>
            </dl>
            <h3>제출 첨부</h3>
            <ul className="seller-files">
              {app.attachments
                .filter(
                  (file) =>
                    app.role === "OPERATOR" ||
                    ["product_images", "PRODUCT_IMAGE"].includes(
                      file.file_type,
                    ),
                )
                .map((file) => (
                  <li key={file.attachment_id}>
                    <span>{file.original_name}</span>
                    <SellerFileLink session={session} file={file} />
                  </li>
                ))}
            </ul>
            {!app.attachments.length && (
              <p className="muted">제출된 첨부가 없습니다.</p>
            )}
          </section>
          <section className="review-section">
            <h2>기한과 보완 요청</h2>
            <p>행사 종료 {kstDisplay(app.project.event_end_at)} (KST)</p>
            {app.info_due_at && (
              <p>보완기한 {kstDisplay(app.info_due_at)} (KST)</p>
            )}
            {app.confirm_due_at && (
              <p>참가확정 기한 {kstDisplay(app.confirm_due_at)} (KST)</p>
            )}
            {app.waiting_rank && <p>내부 대기 순위 {app.waiting_rank}</p>}
            {app.info_requests_json?.map((r, i) => (
              <p key={i}>
                {reviewFields[r.field] ?? r.field}: {r.reason}
              </p>
            ))}
            <p className="muted">
              기한이 지나도 신청은 자동 취소되지 않습니다.
            </p>
          </section>
          <section className="review-section">
            <h2>변경 이력</h2>
            {app.history.length ? (
              <ol className="review-history">
                {app.history.map((h) => (
                  <li key={h.history_id}>
                    <strong>
                      {applicationLabels[h.from_status] ?? h.from_status} →{" "}
                      {applicationLabels[h.to_status] ?? h.to_status}
                    </strong>
                    <p className="seller-prose">{h.reason}</p>
                    <small>{kstDisplay(h.created_at)} (KST)</small>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">아직 변경 이력이 없습니다.</p>
            )}
          </section>
        </div>
        <aside>
          <section className="review-section">
            <h2>{app.role === "OPERATOR" ? "검토 및 처리" : "검토 메모"}</h2>
            <p className="muted">담당자가 신청 자료를 직접 검토합니다.</p>
            {mutation.result && mutation.result.state !== "succeeded" && (
              <RequestStatus
                result={mutation.result}
                onRetry={mutation.retry}
                onCurrent={() => void current()}
                business
                subject="신청"
              />
            )}
            {mutation.storageError && (
              <Notice
                title="요청 복구 정보를 보관하지 못했어요."
                tone="warning"
              >
                브라우저 저장소 설정을 확인한 뒤 다시 열어 주세요.
              </Notice>
            )}
            {loadError && <Notice title={loadError} tone="warning" />}
            {latest && (
              <Notice title="최신 신청과 비교해 주세요.">
                <p>
                  현재 화면: {applicationLabels[app.status]} · 버전{" "}
                  {app.version}
                </p>
                <p>
                  최신: {applicationLabels[latest.status]} · 버전{" "}
                  {latest.version}
                </p>
                <p>
                  최신 상품: {latest.product_name} · {latest.category}
                </p>
                <p className="seller-prose">{latest.product_desc}</p>
                <p>
                  정원 {latest.capacity.occupied}/{latest.capacity.target} ·
                  보완 {kstDisplay(latest.info_due_at)} · 참가확정{" "}
                  {kstDisplay(latest.confirm_due_at)}
                </p>
                <p>
                  기존 사유와 메모 입력은 유지됩니다. 최신 상태에서 가능한
                  작업을 다시 검토해 주세요.
                </p>
                <Button
                  variant="secondary"
                  disabled={mutation.locked}
                  onClick={() => {
                    setApp(latest);
                    setLatest(null);
                    setAction(
                      latest.allowed_actions.includes(chosen) ? chosen : "",
                    );
                    mutation.clear();
                  }}
                >
                  최신 상태를 확인하고 입력 유지
                </Button>
              </Notice>
            )}
            {actions.length ? (
              <form
                ref={form}
                noValidate
                onSubmit={submit}
                onChange={() => setDirty(true)}
              >
                <fieldset disabled={locked}>
                  <fieldset>
                    <legend>처리 선택</legend>
                    {actions.map((a) => (
                      <label className="choice" key={a}>
                        <input
                          type="radio"
                          name="action"
                          value={a}
                          checked={chosen === a}
                          onChange={() => {
                            setAction(a);
                            setError(null);
                          }}
                        />
                        {reviewActions[a].label}
                      </label>
                    ))}
                  </fieldset>
                  <div hidden={chosen === "note"}>
                    <TextareaField
                      id="review-reason"
                      name="reason"
                      label={
                        chosen === "confirm"
                          ? "셀러 의사 확인 근거 및 사유"
                          : "처리 사유"
                      }
                      error={
                        error?.field === "reason" ? error.message : undefined
                      }
                    />
                    <div
                      hidden={
                        ![
                          "request_info",
                          "extend_info",
                          "approve",
                          "promote",
                          "extend_confirmation",
                        ].includes(chosen)
                      }
                    >
                      <Field
                        id="review-deadline"
                        name="deadline"
                        label={
                          chosen === "request_info" || chosen === "extend_info"
                            ? "보완기한 (KST)"
                            : "참가확정 기한 (KST)"
                        }
                        placeholder="2099-11-01 18:00"
                        hint="YYYY-MM-DD HH:mm · 행사 종료 이전"
                        error={
                          error?.field === "deadline"
                            ? error.message
                            : undefined
                        }
                      />
                    </div>
                    <div hidden={chosen !== "wait"}>
                      <Field
                        id="review-rank"
                        name="rank"
                        label="내부 대기 순위"
                        inputMode="numeric"
                        hint="셀러에게 공개되지 않습니다."
                        error={
                          error?.field === "rank" ? error.message : undefined
                        }
                      />
                    </div>
                    <div hidden={chosen !== "request_info"}>
                      <fieldset aria-describedby="review-fields-help">
                        <legend>보완할 항목</legend>
                        {Object.entries(reviewFields).map(([key, label]) => (
                          <label className="choice" key={key}>
                            <input
                              type="checkbox"
                              name="fields"
                              value={key}
                              aria-invalid={error?.field === "fields"}
                            />
                            {label}
                          </label>
                        ))}
                        <p
                          id="review-fields-help"
                          className="error"
                          role={error?.field === "fields" ? "alert" : undefined}
                        >
                          {error?.field === "fields"
                            ? error.message
                            : "선택 항목에 위 사유를 함께 기록합니다."}
                        </p>
                      </fieldset>
                    </div>
                  </div>
                  <div hidden={chosen !== "note"}>
                    <TextareaField
                      id="review-body"
                      name="body"
                      label="내부 검토 메모"
                      maxLength={4000}
                      hint="이 마켓 담당자에게만 보입니다. 최대 4,000자."
                      error={
                        error?.field === "body" ? error.message : undefined
                      }
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={locked}
                    aria-busy={mutation.locked}
                  >
                    {chosen === "note" ? "내부 메모 저장" : "처리 내용 확인"}
                  </Button>
                </fieldset>
              </form>
            ) : (
              <Notice title="현재 가능한 처리 작업이 없어요.">
                신청 상태와 행사 종료시각에 따라 작업이 제한됩니다.
              </Notice>
            )}
          </section>
          <section className="review-section">
            <h2>내부 검토 메모</h2>
            {app.notes.length ? (
              <ul className="review-history">
                {app.notes.map((n) => (
                  <li key={n.note_id}>
                    <p className="seller-prose">{n.body}</p>
                    <small>
                      {kstDisplay(n.created_at)} (KST) · 작성자{" "}
                      {n.author_id === session.actor ? "나" : n.author_id}
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">아직 작성된 메모가 없습니다.</p>
            )}
          </section>
          {app.role === "OPERATOR" && (
            <section className="review-section">
              <h2>안내 초안 기록 · 발송 전</h2>
              <p className="muted">
                처리 과정에서 남긴 안내 초안입니다. 이 화면에서는 안내를
                발송하지 않습니다.
              </p>
              {app.notice_drafts?.length ? (
                app.notice_drafts.map((n, i) => (
                  <article className="review-draft" key={i}>
                    <p className="seller-prose">{n.body}</p>
                    <small>{kstDisplay(n.created_at)} (KST)</small>
                  </article>
                ))
              ) : (
                <p>기록된 안내 초안이 없습니다.</p>
              )}
            </section>
          )}
        </aside>
      </div>
      {confirmation && (
        <ConfirmDialog
          title={`${app.seller.shop_name} · ${reviewActions[confirmation.action].label}`}
          confirm={reviewActions[confirmation.action].label}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => execute(confirmation)}
        >
          <p>
            현재 {applicationLabels[app.status]} 신청에 이 처리를 기록합니다.
          </p>
          <p className="seller-prose">
            사유: {String(confirmation.body.reason)}
          </p>
          {Boolean(confirmation.body.confirm_due_at) && (
            <p>
              참가확정 기한:{" "}
              {kstDisplay(String(confirmation.body.confirm_due_at))} (KST)
            </p>
          )}
          {Boolean(confirmation.body.info_due_at) && (
            <p>
              보완기한: {kstDisplay(String(confirmation.body.info_due_at))}{" "}
              (KST)
            </p>
          )}
          {Boolean(confirmation.body.waiting_rank) && (
            <p>내부 대기 순위: {String(confirmation.body.waiting_rank)}</p>
          )}
          {Array.isArray(confirmation.body.fields) && (
            <p>
              보완 항목:{" "}
              {confirmation.body.fields
                .map((f) => reviewFields[String(f)])
                .join(", ")}
            </p>
          )}
          <p>
            이 작업으로 안내를 발송하지 않습니다. 기록된 안내 초안은 발송 전
            상태로 확인할 수 있습니다.
          </p>
        </ConfirmDialog>
      )}
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
    </>
  );
}
function Detail({
  session,
  id,
  applicationId,
  query,
}: {
  session: MarketSession;
  id: string;
  applicationId: string;
  query: string;
}) {
  const [app, setApp] = useState<ReviewApplication | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const back = `/markets/${id}/applications?${query}`;
  useEffect(() => {
    const c = new AbortController();
    setApp(null);
    setError("");
    void api(
      session.client,
      session.actor,
      `review/applications/${applicationId}`,
      c.signal,
    )
      .then((r) => {
        if (c.signal.aborted) return;
        const data = r.body.data as ReviewApplication | undefined;
        if (r.status === 200 && data?.project_id === id) setApp(data);
        else
          setError(
            r.status === 403
              ? "이 신청의 상세 조회 권한이 없어요."
              : r.status === 401
                ? "로그인이 필요해요."
                : "신청 상세를 불러오지 못했어요.",
          );
      })
      .catch(() => {
        if (!c.signal.aborted) setError("신청 상세를 불러오지 못했어요.");
      });
    return () => c.abort();
  }, [session, id, applicationId, retry]);
  if (app)
    return (
      <Editor
        key={app.application_id}
        session={session}
        initial={app}
        back={back}
      />
    );
  return (
    <>
      <ButtonLink href={back} variant="secondary">
        신청 목록으로
      </ButtonLink>
      <Notice
        title={error || "신청 자료를 불러오고 있어요."}
        tone={error ? "warning" : "info"}
      >
        {error && (
          <Button onClick={() => setRetry((v) => v + 1)}>다시 불러오기</Button>
        )}
      </Notice>
    </>
  );
}
export function ReviewDetail(props: {
  id: string;
  applicationId: string;
  query: string;
}) {
  return (
    <MarketAccess>
      {(session) => <Detail session={session} {...props} />}
    </MarketAccess>
  );
}
