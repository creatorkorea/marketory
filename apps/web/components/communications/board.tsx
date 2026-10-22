"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MarketAccess, type MarketSession } from "@/components/markets/access";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { TextareaField } from "@/components/ui/textarea-field";
import { Notice } from "@/components/ui/notice";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Toast } from "@/components/ui/toast";
import { UnsavedGuard } from "@/components/ui/unsaved-guard";
import { RequestStatus } from "@/components/requests/request-status";
import { api } from "@/lib/api/client";
import { useMarketMutation } from "@/lib/markets/use-mutation";
import { kstDisplay } from "@/lib/seller/form";
import {
  FormError,
  kindsFor,
  required,
  revisionPayload,
  resolutionPayload,
  statusLabels,
  typeLabels,
  outcomeLabels,
  type Message,
  type MessageList,
  type Target,
  type Kind,
  type Outcome,
} from "@/lib/communications/form";

function Board({
  id,
  query,
  session,
}: {
  id: string;
  query: string;
  session: MarketSession;
}) {
  const [list, setList] = useState<MessageList | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [message, setMessage] = useState<Message | null>(null);
  const [latest, setLatest] = useState<Message | null>(null);
  const [target, setTarget] = useState("");
  const [kind, setKind] = useState<Kind>("NOTICE");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("INCONCLUSIVE");
  const [error, setError] = useState<FormError | null>(null);
  const [loadError, setLoadError] = useState("");
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [decision, setDecision] = useState<
    "approve" | "send" | "retry" | "resolve" | "publish" | "unpublish" | null
  >(null);
  const [next, setNext] = useState<{ id: string | null } | null>(null);
  const [toast, setToast] = useState("");
  const readController = useRef<AbortController | null>(null);
  const detailController = useRef<AbortController | null>(null);
  const accept = (value: Message) => {
    setTarget("");
    setMessage(value);
    setSubject(value.subject);
    setBody(value.body);
    setReason("");
    setEvidence("");
    setOutcome("INCONCLUSIVE");
    setLatest(null);
    setError(null);
    setDecision(null);
  };
  const mutation = useMarketMutation(
    session,
    `communications:${id}`,
    (value) => {
      const data = value as unknown as Message;
      accept(data);
      setTarget("");
      setToast(
        data.send_status === "QUEUED"
          ? "발송 요청을 접수했어요. 처리 결과를 확인해 주세요."
          : "안내를 저장했어요.",
      );
      void read();
    },
  );
  const read = useCallback(async () => {
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    setLoading(true);
    setLoadError("");
    try {
      const results = await Promise.all([
        api(
          session.client,
          session.actor,
          `projects/${id}/communications?${query}`,
          controller.signal,
        ),
        api(
          session.client,
          session.actor,
          `projects/${id}/communication-targets`,
          controller.signal,
        ),
      ]);
      if (controller.signal.aborted) return;
      if (results.some((r) => [401, 403, 404].includes(r.status))) {
        setDenied(true);
        setList(null);
        setTargets([]);
        setMessage(null);
        setLatest(null);
        setLoadError(
          "셀러 안내를 조회할 수 없어요. 로그인과 마켓 운영 권한을 확인해 주세요.",
        );
      } else if (results.every((r) => r.status === 200)) {
        setDenied(false);
        setList(results[0].body.data as MessageList);
        setTargets((results[1].body.data as { items: Target[] }).items);
      } else setLoadError("안내 목록을 불러오지 못했어요. 다시 불러와 주세요.");
    } catch {
      if (!controller.signal.aborted)
        setLoadError(
          "안내 목록을 불러오지 못했어요. 연결 상태를 확인해 주세요.",
        );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [id, query, session]);
  useEffect(() => {
    void read();
    return () => {
      readController.current?.abort();
      detailController.current?.abort();
    };
  }, [read]);
  const detail = async (cid: string, compare = false) => {
    detailController.current?.abort();
    const controller = new AbortController();
    detailController.current = controller;
    setLoading(true);
    setLoadError("");
    try {
      const response = await api(
        session.client,
        session.actor,
        `communications/${cid}`,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (response.status === 200) {
        const data = response.body.data as Message;
        setList((current) => current && {
          ...current,
          items: current.items.map((item) =>
            item.communication_id === data.communication_id &&
            item.version <= data.version ? data : item,
          ),
        });
        if (compare) setLatest(data);
        else accept(data);
      } else {
        if ([401, 403, 404].includes(response.status)) {
          setMessage(null);
          setLatest(null);
          setDenied(true);
        }
        setLoadError(
          "안내 상세를 확인할 수 없어요. 로그인과 운영 권한을 확인해 주세요.",
        );
      }
    } catch {
      if (!controller.signal.aborted)
        setLoadError("안내 상세를 불러오지 못했어요.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };
  const dirty =
    !!reason ||
    !!evidence ||
    !!target ||
    (!!message && (subject !== message.subject || body !== message.body));
  const changed =
    !!message && (subject !== message.subject || body !== message.body);
  const locked =
    loading ||
    denied ||
    mutation.locked ||
    mutation.result?.state === "conflict" ||
    !!latest;
  const choose = (cid: string | null) => {
    if (cid) void detail(cid);
    else {
      setMessage(null);
      setSubject("");
      setBody("");
      setReason("");
      setEvidence("");
      setError(null);
      setTarget("");
    }
  };
  const requestChoice = (cid: string | null) => {
    if (dirty) setNext({ id: cid });
    else choose(cid);
  };
  const fail = (e: unknown) => {
    if (e instanceof FormError) {
      setError(e);
      document.getElementById(`communication-${e.field}`)?.focus();
    }
  };
  const execute = (action: string) => {
    if (locked) return;
    try {
      let payload: Record<string, unknown>;
      if (action === "generate") {
        const selected = targets.find((t) => t.application_id === target);
        if (!selected || !kindsFor(selected).includes(kind))
          throw new FormError(
            "target",
            "안내할 셀러와 안내 종류를 선택해 주세요.",
          );
        payload = {
          project_id: id,
          application_id: target,
          type: kind,
          reason: required(reason, "reason", "처리 사유"),
        };
      } else {
        if (!message || !message.allowed_actions.includes(action)) return;
        if (action === "revise")
          payload = revisionPayload(message, subject, body, reason);
        else if (action === "resolve")
          payload = resolutionPayload(message, outcome, evidence, reason);
        else
          payload = {
            expected_version: message.version,
            reason: required(reason, "reason", "처리 사유"),
            ...(["approve", "publish"].includes(action)
              ? { content_version: message.content_version }
              : {}),
          };
      }
      setError(null);
      setDecision(null);
      readController.current?.abort();
      detailController.current?.abort();
      void mutation.start(
        `communications.${action}`,
        action === "generate"
          ? "communications/generate"
          : `communications/${message!.communication_id}/${action}`,
        "POST",
        payload,
      );
    } catch (e) {
      fail(e);
      setDecision(null);
    }
  };
  const prepare = (action: "approve" | "send" | "retry" | "resolve" | "publish" | "unpublish") => {
    try {
      required(reason, "reason", "처리 사유");
      if (action === "resolve" && message)
        resolutionPayload(message, outcome, evidence, reason);
      setError(null);
      setDecision(action);
    } catch (e) {
      fail(e);
    }
  };
  const pageHref = (offset: number, limit = list?.limit ?? 20) =>
    `/markets/${id}/communications?limit=${limit}&offset=${offset}`;
  return (
    <section className="communications-board">
      <ButtonLink href={`/markets/${id}/announcements`} variant="secondary">마켓 공통 안내</ButtonLink>
      <UnsavedGuard active={dirty || mutation.locked} />
      <nav className="actions" aria-label="마켓 운영">
        <ButtonLink variant="secondary" href={`/markets/${id}/applications`}>
          신청 검토
        </ButtonLink>
        <ButtonLink variant="secondary" href={`/markets/${id}/booths`}>
          부스 배치
        </ButtonLink>
      </nav>
      {loadError && (
        <Notice tone="warning" title={loadError}>
          <div className="actions">
            <Button disabled={loading} onClick={() => void read()}>
              다시 불러오기
            </Button>
            <ButtonLink
              variant="secondary"
              href="/login"
              target="_blank"
              rel="noopener"
            >
              로그인 (새 탭)
            </ButtonLink>
          </div>
        </Notice>
      )}
      {mutation.result && mutation.result.state !== "succeeded" && (
        <RequestStatus
          business
          result={mutation.result}
          onRetry={mutation.retry}
          onCurrent={() => {
            if (message) void detail(message.communication_id, true);
            else void read();
          }}
        />
      )}
      {mutation.storageError && (
        <Notice
          tone="warning"
          title="요청 정보를 보관할 수 없어 저장을 멈췄어요."
        >
          입력은 유지됩니다. 브라우저 저장소 설정을 확인해 주세요.
        </Notice>
      )}
      {loading && <Notice title="안내 정보를 확인하고 있어요." />}
      {!message &&
        list &&
        !loading &&
        !denied &&
        mutation.result?.state === "conflict" && (
          <Notice
            tone="warning"
            title="최신 신청 목록을 확인한 뒤 초안을 다시 검토해 주세요."
          >
            <Button onClick={() => mutation.clear()}>
              입력을 유지하고 다시 검토
            </Button>
          </Notice>
        )}
      {list && !denied && mutation.result?.state !== "forbidden" && (
        <>
          <h2>{list.project.name}</h2>
          {!list.delivery_enabled && (
            <Notice tone="warning" title="실제 이메일 발송이 꺼져 있어요.">
              발송 요청은 대기열에 저장됩니다. 발송 기능을 켜고 처리 작업을
              실행해야 이메일이 발송돼요.
            </Notice>
          )}
          <p className="muted">
            초안 작성 → 내용 승인 후 셀러 게시 또는 별도 이메일 발송 요청. 제공사 접수
            완료는 수신·열람 완료가 아닙니다.
          </p>
          <div className="communications-layout">
            <section
              className="communications-history"
              aria-labelledby="history-title"
            >
              <div className="booth-heading">
                <h2 id="history-title">안내 목록</h2>
                <Button
                  variant="secondary"
                  disabled={locked}
                  onClick={() => requestChoice(null)}
                >
                  새 안내 초안
                </Button>
              </div>
              <p className="muted">
                전체 {list.total}건 · {list.total ? list.offset + 1 : 0}–
                {Math.min(list.offset + list.items.length, list.total)}건
              </p>
              {!list.items.length && (
                <Notice title="이 페이지에 안내가 없어요.">
                  새 안내 초안을 만들거나 이전 페이지를 확인해 주세요.
                </Notice>
              )}
              <ul className="communication-items">
                {list.items.map((item) => (
                  <li key={item.communication_id}>
                    <span className="badge">
                      {statusLabels[item.send_status]}
                    </span>
                    <h3>{item.subject}</h3>
                    <p>{item.recipient_snapshot}</p>
                    <p className="muted">
                      {typeLabels[item.type]} · {kstDisplay(item.created_at)}
                    </p>
                    <Button
                      variant="secondary"
                      disabled={locked}
                      aria-label={`${item.subject} 상세 보기`}
                      onClick={() => requestChoice(item.communication_id)}
                    >
                      상세 보기
                    </Button>
                  </li>
                ))}
              </ul>
              <nav className="actions" aria-label="안내 페이지">
                {list.offset > 0 && (
                  <ButtonLink
                    variant="secondary"
                    href={pageHref(Math.max(0, list.offset - list.limit))}
                  >
                    이전
                  </ButtonLink>
                )}
                {list.offset + list.limit < list.total && (
                  <ButtonLink
                    variant="secondary"
                    href={pageHref(list.offset + list.limit)}
                  >
                    다음
                  </ButtonLink>
                )}
              </nav>
              <nav className="actions" aria-label="페이지당 안내 수">
                {[10, 20, 50].map((size) => (
                  <ButtonLink
                    key={size}
                    variant="secondary"
                    href={pageHref(0, size)}
                    aria-current={size === list.limit ? "page" : undefined}
                  >
                    {size}개씩
                  </ButtonLink>
                ))}
              </nav>
            </section>
            <section
              className="communication-editor"
              aria-labelledby="editor-title"
            >
              <h2 id="editor-title">
                {message ? "안내 내용과 처리 이력" : "셀러별 안내 초안"}
              </h2>
              {latest && message && (
                <Notice
                  tone="warning"
                  title="최신 내용과 내 입력을 비교해 주세요."
                >
                  <p>
                    버전 {message.version} → {latest.version} ·{" "}
                    {statusLabels[latest.send_status]} · 수신처{" "}
                    {latest.recipient_snapshot}
                  </p>
                  <h3>{latest.subject}</h3>
                  <p className="communication-body">{latest.body}</p>
                  <Button
                    disabled={mutation.locked}
                    onClick={() => {
                      setMessage(latest);
                      setLatest(null);
                      mutation.clear();
                    }}
                  >
                    내 입력을 유지하고 최신 기준으로 검토
                  </Button>
                </Notice>
              )}
              <form
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  execute(message ? "revise" : "generate");
                }}
              >
                {!message ? (
                  <>
                    <div className="field">
                      <label htmlFor="communication-target">안내할 셀러</label>
                      <select
                        id="communication-target"
                        className="input"
                        disabled={locked}
                        value={target}
                        aria-invalid={error?.field === "target"}
                        aria-describedby="communication-target-help"
                        onChange={(e) => {
                          setTarget(e.target.value);
                          setKind("NOTICE");
                        }}
                      >
                        <option value="">셀러 선택</option>
                        {targets.map((t) => (
                          <option
                            key={t.application_id}
                            value={t.application_id}
                          >
                            {t.shop_name} · {t.notification_email}
                          </option>
                        ))}
                      </select>
                      <p id="communication-target-help" className="field-help">
                        {error?.field === "target"
                          ? error.message
                          : "선택한 신청의 셀러에게 게시하거나 등록된 이메일로 발송할 수 있어요."}
                      </p>
                    </div>
                    {!targets.length && (
                      <Notice title="안내할 수 있는 신청이 없어요." />
                    )}
                    <div className="field">
                      <label htmlFor="communication-kind">안내 종류</label>
                      <select
                        id="communication-kind"
                        className="input"
                        value={kind}
                        disabled={locked || !target}
                        onChange={(e) => setKind(e.target.value as Kind)}
                      >
                        {(target
                          ? kindsFor(
                              targets.find((t) => t.application_id === target),
                            )
                          : (["NOTICE"] as Kind[])
                        ).map((k) => (
                          <option key={k} value={k}>
                            {typeLabels[k]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className="hint">
                      신청 정보를 바탕으로 템플릿 초안을 만들어요. 생성 후
                      제목과 본문을 직접 수정할 수 있습니다.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="actions">
                      <span className="badge">
                        {statusLabels[message.send_status]}
                      </span>
                      <span>
                        {typeLabels[message.type]} · 내용{" "}
                        {message.content_version}판
                      </span>
                    </div>
                    <p>
                      <strong>수신처</strong> {message.recipient_snapshot}
                    </p>
                    {message.queued_at && (
                      <p className="muted">
                        요청 접수 {kstDisplay(message.queued_at)} · 요청자{" "}
                        {message.queued_by}
                      </p>
                    )}
                    {message.approved_at && (
                      <p className="muted">
                        승인 {kstDisplay(message.approved_at)} · 승인 내용{" "}
                        {message.approved_version}판
                      </p>
                    )}
                    <section aria-label="셀러 게시 상태" className="market-section">
                      <h3>{message.publication ? (message.publication.withdrawn_at ? "게시 내림" : "셀러에게 게시 중") : "셀러에게 미게시"}</h3>
                      <p className="hint">내용 승인과 게시는 별도입니다. 게시하면 해당 셀러의 내 신청에 표시되며 이메일은 발송하지 않습니다.</p>
                      {message.publication && <>
                        <p className="muted">게시 {kstDisplay(message.publication.published_at)} (KST) · 게시 내용 {message.publication.content_version}판</p>
                        {message.publication.withdrawn_at && <p className="muted">게시 내림 {kstDisplay(message.publication.withdrawn_at)} (KST)</p>}
                        {!message.publication.withdrawn_at && message.publication.content_version !== message.content_version && <Notice title="이전 게시 내용이 유지되고 있어요.">수정 내용을 승인하고 다시 게시해야 셀러 화면에 반영됩니다.</Notice>}
                        <details>
                          <summary>마지막 게시 내용 확인</summary>
                          <h4 className="seller-prose">{message.publication.subject}</h4>
                          <p className="seller-prose">{message.publication.body}</p>
                        </details>
                      </>}
                    </section>
                    {message.failure_reason && (
                      <Notice
                        tone="warning"
                        title={`발송 처리 사유: ${message.failure_reason}`}
                      >
                        신청 정보가 바뀌었거나 재시도 기한이 지난 경우 새 초안을
                        검토해 주세요.
                      </Notice>
                    )}
                    {message.send_status === "UNKNOWN" && (
                      <Notice
                        tone="warning"
                        title="결과 확인 전에는 재발송할 수 없어요."
                      >
                        제공사 기록에서 현재 시도를 확인하고 근거를 남겨 주세요.
                        확인 불가로 기록하면 결과 확인 필요 상태를 유지합니다.
                      </Notice>
                    )}
                    {message.superseded_at && (
                      <Notice title="후속 초안이 생성된 안내예요.">
                        이 안내는 수정하거나 다시 발송할 수 없어요. 목록에서
                        후속 초안을 확인해 주세요. 이미 게시된 안내는 유지되며 게시 내리기로 숨길 수 있어요.
                      </Notice>
                    )}
                    <Field
                      id="communication-subject"
                      label="제목"
                      maxLength={200}
                      value={subject}
                      readOnly={!message.allowed_actions.includes("revise")}
                      disabled={locked}
                      error={
                        error?.field === "subject" ? error.message : undefined
                      }
                      onChange={(e) => setSubject(e.target.value)}
                    />
                    <TextareaField
                      id="communication-body"
                      label="본문"
                      maxLength={50000}
                      value={body}
                      readOnly={!message.allowed_actions.includes("revise")}
                      disabled={locked}
                      error={
                        error?.field === "body" ? error.message : undefined
                      }
                      onChange={(e) => setBody(e.target.value)}
                    />
                    {message.allowed_actions.includes("resolve") && (
                      <>
                        <div className="field">
                          <label htmlFor="communication-outcome">
                            확인 결과
                          </label>
                          <select
                            className="input"
                            id="communication-outcome"
                            value={outcome}
                            disabled={locked}
                            onChange={(e) =>
                              setOutcome(e.target.value as Outcome)
                            }
                          >
                            {Object.entries(outcomeLabels).map(
                              ([value, label]) => (
                                <option value={value} key={value}>
                                  {label}
                                </option>
                              ),
                            )}
                          </select>
                        </div>
                        <Field
                          id="communication-evidence"
                          label="확인 근거"
                          value={evidence}
                          disabled={locked}
                          error={
                            error?.field === "evidence"
                              ? error.message
                              : undefined
                          }
                          hint="제공사 기록 식별자·조회 시각 등 판단을 뒷받침하는 근거"
                          onChange={(e) => setEvidence(e.target.value)}
                        />
                      </>
                    )}
                  </>
                )}
                {(!message || message.allowed_actions.length > 0) && (
                  <Field
                    id="communication-reason"
                    label="처리 사유"
                    value={reason}
                    disabled={locked}
                    error={
                      error?.field === "reason" ? error.message : undefined
                    }
                    hint="수정·승인·게시·발송·결과 확인의 이유를 남겨 주세요."
                    onChange={(e) => setReason(e.target.value)}
                  />
                )}
                <div className="actions">
                  {!message && (
                    <Button type="submit" disabled={locked || !targets.length}>
                      템플릿 초안 만들기
                    </Button>
                  )}
                  {message?.allowed_actions.includes("revise") && (
                    <Button type="submit" disabled={locked}>
                      {message.attempts.length
                        ? "수정 내용을 새 초안으로 저장"
                        : "초안 저장"}
                    </Button>
                  )}
                  {message &&
                    (["approve", "publish", "unpublish", "send", "retry", "resolve"] as const)
                      .filter((action) =>
                        message.allowed_actions.includes(action),
                      )
                      .map((action) => (
                        <Button
                          key={action}
                          variant="secondary"
                          disabled={locked || changed}
                          onClick={() => prepare(action)}
                        >
                          {
                            {
                              approve: "내용 승인",
                              send: "발송 요청",
                              retry: "같은 내용 재시도",
                              resolve: "근거로 결과 기록",
                              publish: message.publication ? "셀러에게 다시 게시" : "셀러에게 게시",
                              unpublish: "게시 내리기",
                            }[action]
                          }
                        </Button>
                      ))}
                  {message && (
                    <Button
                      variant="secondary"
                      disabled={loading || mutation.locked}
                      onClick={() =>
                        void detail(message.communication_id, true)
                      }
                    >
                      최신 상태 확인
                    </Button>
                  )}
                </div>
                {changed && (
                  <p className="hint">
                    변경한 내용을 초안으로 저장한 뒤 승인·발송해 주세요.
                  </p>
                )}
                {message?.allowed_actions.includes("revise") && (
                  <p className="hint">
                    시도 이력이 있으면 기존 안내를 보존하고 새 초안을 만듭니다.
                    시도 이력이 없는 안내는 승인을 초기화하고 발송 대기를
                    취소합니다.
                  </p>
                )}
              </form>
              {message && (
                <section className="communication-attempts">
                  <h3>발송 시도와 확인 기록</h3>
                  {!message.attempts.length && (
                    <p className="muted">아직 발송 시도가 없어요.</p>
                  )}
                  {message.attempts.map((attempt) => (
                    <article key={attempt.attempt_id}>
                      <h4>
                        {attempt.attempt_no}차 시도 ·{" "}
                        {statusLabels[attempt.status]}
                      </h4>
                      <p>{kstDisplay(attempt.started_at)} (KST)</p>
                      <p>
                        제공사 식별자: {attempt.provider_message_id || "없음"}
                      </p>
                      {attempt.error_code && (
                        <p>
                          {attempt.error_code} · {attempt.error_message}
                        </p>
                      )}
                      {message.resolutions
                        .filter((r) => r.attempt_id === attempt.attempt_id)
                        .map((r) => (
                          <div key={r.resolution_id}>
                            <strong>{outcomeLabels[r.outcome]}</strong>
                            <p>근거: {r.evidence_ref}</p>
                            <p>사유: {r.reason}</p>
                            <p className="muted">
                              {kstDisplay(r.resolved_at)} · {r.resolved_by}
                            </p>
                          </div>
                        ))}
                    </article>
                  ))}
                </section>
              )}
            </section>
          </div>
        </>
      )}
      {decision && message && (
        <ConfirmDialog
          title={
            {
              approve: "이 내용을 승인할까요?",
              send: "안내 발송을 요청할까요?",
              retry: "같은 내용을 다시 발송 요청할까요?",
              resolve: "확인 근거로 결과를 기록할까요?",
              publish: "이 내용을 셀러에게 게시할까요?",
              unpublish: "셀러에게 게시한 안내를 내릴까요?",
            }[decision]
          }
          confirm={
            {
              approve: "내용 승인",
              send: "발송 요청",
              retry: "같은 내용 재시도",
              resolve: "결과 기록",
              publish: message.publication ? "셀러에게 다시 게시" : "셀러에게 게시",
              unpublish: "게시 내리기",
            }[decision]
          }
          onCancel={() => setDecision(null)}
          onConfirm={() => execute(decision)}
        >
          <p>{message.recipient_snapshot}</p>
          <p>
            <strong>{decision === "unpublish" ? message.publication?.subject : message.subject}</strong> · 내용 {decision === "unpublish" ? message.publication?.content_version : message.content_version}
            판
          </p>
          <p>
            {decision === "publish"
              ? "해당 셀러의 내 신청에 이 내용을 게시합니다. 기존 게시 내용은 교체됩니다. 이메일은 발송하지 않습니다."
              : decision === "unpublish"
              ? "셀러의 내 신청에서 이 안내가 숨겨집니다. 이메일 발송 상태와 저장된 내용은 유지됩니다."
              : decision === "approve"
              ? "승인은 발송하지 않습니다. 승인 후 별도로 발송을 요청해 주세요."
              : decision === "resolve"
                ? `${outcomeLabels[outcome]} · 근거: ${evidence}`
                : "발송 대기열에 요청을 접수합니다. 제공사 접수 결과는 이후 확인해 주세요."}
          </p>
          <p>처리 사유: {reason}</p>
          {!list?.delivery_enabled &&
            (decision === "send" || decision === "retry") && (
              <p>실제 이메일 발송이 현재 꺼져 있습니다.</p>
            )}
        </ConfirmDialog>
      )}
      {next && (
        <ConfirmDialog
          title="저장하지 않은 입력을 버릴까요?"
          confirm="입력을 버리고 전환"
          onCancel={() => setNext(null)}
          onConfirm={() => {
            choose(next.id);
            setNext(null);
          }}
        >
          <p>아직 저장하지 않은 안내 내용과 처리 사유가 사라집니다.</p>
        </ConfirmDialog>
      )}
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
    </section>
  );
}
export function CommunicationsBoard({
  id,
  query,
}: {
  id: string;
  query: string;
}) {
  return (
    <MarketAccess>
      {(session) => <Board id={id} query={query} session={session} />}
    </MarketAccess>
  );
}
