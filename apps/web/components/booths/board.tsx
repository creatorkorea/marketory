"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MarketAccess, type MarketSession } from "@/components/markets/access";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Toast } from "@/components/ui/toast";
import { UnsavedGuard } from "@/components/ui/unsaved-guard";
import { RequestStatus } from "@/components/requests/request-status";
import { api } from "@/lib/api/client";
import { useMarketMutation } from "@/lib/markets/use-mutation";
import { kstDisplay } from "@/lib/seller/form";
import {
  draftPayload,
  FormError,
  requireReason,
  resourceLabels,
  savedSelection,
  selectionKey,
  type Board,
  type Booth,
} from "@/lib/booths/form";
import { BoothEditor } from "./editor";

function BoardContent({ id, session }: { id: string; session: MarketSession }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [latest, setLatest] = useState<Board | null>(null);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [selectionNotice, setSelectionNotice] = useState("");
  const [editor, setEditor] = useState<Booth | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [nextEditor, setNextEditor] = useState<{ booth: Booth | null } | null>(
    null,
  );
  const [decision, setDecision] = useState<{
    kind: "confirm" | "release";
    applicationId?: string;
  } | null>(null);
  const [decisionReason, setDecisionReason] = useState("");
  const [decisionError, setDecisionError] = useState("");
  const [toast, setToast] = useState("");
  const readController = useRef<AbortController | null>(null);
  const mutationKind = useRef("");
  const mutation = useMarketMutation(session, `booths:${id}`, (value) => {
    const data = value as unknown as Board;
    setBoard(data);
    setLatest(null);
    setSelections(savedSelection(data));
    setReason("");
    setError("");
    setDecision(null);
    setDecisionReason("");
    if (["create", "update"].includes(mutationKind.current)) {
      setEditor(null);
      setEditorDirty(false);
      setEditorGeneration((v) => v + 1);
    }
    setToast(
      mutationKind.current === "confirm"
        ? "부스 배치를 확정했어요."
        : mutationKind.current === "release"
          ? "부스 배정을 해제했어요."
          : "저장했어요.",
    );
  });
  const read = useCallback(
    async (compare = false) => {
      readController.current?.abort();
      const controller = new AbortController();
      readController.current = controller;
      setLoading(true);
      setLoadError("");
      try {
        const response = await api(
          session.client,
          session.actor,
          `projects/${id}/booths`,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (response.status === 200) {
          const data = response.body.data as Board;
          setAccessDenied(false);
          if (compare) setLatest(data);
          else {
            setBoard(data);
            setSelections(savedSelection(data));
          }
        } else {
          if (response.status === 401) setAccessDenied(true);
          if ([403, 404].includes(response.status)) {
            setBoard(null);
            setLatest(null);
            setAccessDenied(true);
          }
          setLoadError(
            response.status === 401
              ? "다시 로그인한 뒤 최신 부스 정보를 확인해 주세요."
              : response.status === 403
                ? "부스 배치 조회 권한이 없어요."
                : response.status === 404
                  ? "마켓을 찾을 수 없어요."
                  : "부스 정보를 불러오지 못했어요. 연결 상태를 확인해 주세요.",
          );
        }
      } catch {
        if (!controller.signal.aborted)
          setLoadError(
            "부스 정보를 불러오지 못했어요. 연결 상태를 확인해 주세요.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [id, session],
  );
  useEffect(() => {
    void read();
    return () => readController.current?.abort();
  }, [read]);
  const conflict = mutation.result?.state === "conflict";
  const draftDirty =
    !!board && selectionKey(selections) !== selectionKey(savedSelection(board));
  const locked =
    mutation.locked || conflict || loading || !!latest || accessDenied;
  const canManage =
    !!board?.can_manage &&
    board.project.status !== "COMPLETED" &&
    Date.parse(board.project.event_end_at) > Date.now();
  const name = (appId: string) =>
    board?.applications.find((app) => app.application_id === appId)
      ?.shop_name ?? "참가 취소된 셀러";
  const boothName = (boothId: string) =>
    board?.booths.find((booth) => booth.booth_id === boothId)?.booth_no ??
    "부스";
  const changeEditor = (booth: Booth | null) => {
    if (editorDirty) setNextEditor({ booth });
    else {
      setEditor(booth);
      setEditorGeneration((v) => v + 1);
    }
  };
  const write = (
    kind: string,
    path: string,
    payload: Record<string, unknown>,
    method: "POST" | "PATCH" = "POST",
  ) => {
    if (locked || !canManage) return;
    readController.current?.abort();
    mutationKind.current = kind;
    void mutation.start(
      `booths.${kind}`,
      `projects/${id}/${path}`,
      method,
      payload,
    );
  };
  const saveDraft = () => {
    if (!board) return;
    try {
      const payload = draftPayload(board, selections, reason);
      setError("");
      write("draft", "booth-draft", payload);
    } catch (e) {
      if (e instanceof FormError) {
        setError(e.message);
        document
          .getElementById(
            e.field === "reason" ? "draft-reason" : "draft-selection",
          )
          ?.focus();
      }
    }
  };
  const confirmDecision = () => {
    if (!board || !decision || locked) return;
    try {
      const payload: Record<string, unknown> = {
        expected_version: board.project.version,
        reason: requireReason(decisionReason),
      };
      if (decision.kind === "release") {
        const app = board.applications.find(
          (item) => item.application_id === decision.applicationId,
        );
        if (!app) return;
        payload.application_id = app.application_id;
        payload.expected_application_version = app.version;
      }
      write(decision.kind, `booth-${decision.kind}`, payload);
      setDecision(null);
      setDecisionError("");
    } catch (e) {
      if (e instanceof FormError) {
        setDecisionError(e.message);
        document.getElementById("decision-reason")?.focus();
      }
    }
  };
  return (
    <section className="booth-board">
      <UnsavedGuard
        active={
          editorDirty ||
          draftDirty ||
          !!reason ||
          !!decisionReason ||
          mutation.locked
        }
      />
      <nav className="actions" aria-label="마켓 운영">
        <ButtonLink variant="secondary" href="/markets">
          마켓 목록
        </ButtonLink>
        <ButtonLink variant="secondary" href={`/markets/${id}/applications`}>
          신청 검토
        </ButtonLink>
        {board?.can_manage && (
          <ButtonLink
            variant="secondary"
            href={`/markets/${id}/communications`}
          >
            셀러 안내
          </ButtonLink>
        )}
      </nav>
      {loadError && (
        <Notice tone="warning" title={loadError}>
          <div className="actions">
            <Button disabled={loading} onClick={() => void read(!!board)}>
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
          onCurrent={() => void read(true)}
        />
      )}
      {mutation.storageError && (
        <Notice
          tone="warning"
          title="요청 정보를 보관할 수 없어 저장을 멈췄어요."
        >
          브라우저 저장소 설정을 확인해 주세요. 입력은 유지됩니다.
        </Notice>
      )}
      {loading && <Notice title="최신 부스 정보를 확인하고 있어요." />}
      {selectionNotice && <Notice title={selectionNotice} />}
      {latest && board && (
        <Notice tone="warning" title="최신 내용과 내 입력을 비교해 주세요.">
          <p>
            기존 버전 {board.project.version} → 최신 버전{" "}
            {latest.project.version}. 내 부스 입력과 배치 선택은 그대로
            유지됩니다.
          </p>
          <ul>
            {latest.booths.map((booth) => (
              <li key={booth.booth_id}>
                {booth.booth_no} · {booth.zone || "구역 없음"} · 테이블{" "}
                {booth.table_capacity ?? "미확인"} ·{" "}
                {booth.status === "BLOCKED" ? "사용 중지" : "사용 가능"}
                {Object.entries(resourceLabels)
                  .filter(([key]) => booth[key as keyof typeof resourceLabels])
                  .map(([, label]) => ` · ${label}`)
                  .join("")}{" "}
                · 현재 배정:{" "}
                {latest.assignments
                  .filter((item) => item.booth_id === booth.booth_id)
                  .map(
                    (item) =>
                      latest.applications.find(
                        (app) => app.application_id === item.application_id,
                      )?.shop_name ?? "셀러",
                  )
                  .join(", ") || "없음"}
              </li>
            ))}
          </ul>
          <p>
            서버 저장 초안 {latest.drafts.length}건 · 미배정{" "}
            {latest.unassigned_count}팀
          </p>
          <Button
            onClick={() => {
              const valid = Object.fromEntries(
                Object.entries(
                  draftDirty ? selections : savedSelection(latest),
                ).filter(
                  ([appId, boothId]) =>
                    latest.applications.some(
                      (app) => app.application_id === appId,
                    ) &&
                    (!boothId ||
                      latest.booths.some(
                        (booth) => booth.booth_id === boothId,
                      )),
                ),
              );
              const removed = draftDirty
                ? Object.keys(selections).length - Object.keys(valid).length
                : 0;
              setSelections(valid);
              setSelectionNotice(
                removed
                  ? `더 이상 배치할 수 없는 선택 ${removed}건을 제외했어요. 나머지 입력은 유지됩니다.`
                  : "",
              );
              setBoard(latest);
              setLatest(null);
              mutation.clear();
            }}
          >
            최신 기준으로 내 입력 다시 검토
          </Button>
        </Notice>
      )}
      {board && (
        <div className="booth-board" hidden={accessDenied}>
          <div className="booth-heading">
            <div>
              <p className="eyebrow">{board.project.name}</p>
              <h2>확정된 자리와 다음 배치</h2>
            </div>
            <p className="muted">
              행사 종료 {kstDisplay(board.project.event_end_at)}
            </p>
          </div>
          <dl className="booth-summary">
            <div>
              <dt>등록 부스</dt>
              <dd>{board.booths.length}개</dd>
            </div>
            <div>
              <dt>확정 배정</dt>
              <dd>{board.assignments.length}팀</dd>
            </div>
            <div>
              <dt>미배정</dt>
              <dd>{board.unassigned_count}팀</dd>
            </div>
            <div>
              <dt>저장된 변경 초안</dt>
              <dd>{board.drafts.length}건</dd>
            </div>
          </dl>
          {!canManage && (
            <Notice
              title={
                board.role === "REVIEWER"
                  ? "배치 현황을 조회하고 있어요."
                  : "행사가 종료되어 배치를 변경할 수 없어요."
              }
            >
              부스 등록·배치 확정·해제는 운영 권한과 행사 기간을 확인한 뒤
              가능합니다.
            </Notice>
          )}
          <section className="booth-section" aria-labelledby="resources-title">
            <div className="booth-heading">
              <h2 id="resources-title">부스와 시설</h2>
              {canManage && (
                <Button
                  variant="secondary"
                  disabled={locked}
                  onClick={() => changeEditor(null)}
                >
                  새 부스 입력
                </Button>
              )}
            </div>
            {!board.booths.length ? (
              <Notice title="등록된 부스가 없어요.">
                부스 번호와 시설을 등록한 뒤 셀러의 자리를 선택해 주세요.
              </Notice>
            ) : (
              <div className="booth-resources">
                {board.booths.map((booth) => {
                  const occupied = board.assignments.find(
                    (item) => item.booth_id === booth.booth_id,
                  );
                  return (
                    <article className="booth-resource" key={booth.booth_id}>
                      <div className="booth-heading">
                        <h3>{booth.booth_no}</h3>
                        <span className="badge">
                          {booth.status === "BLOCKED"
                            ? "사용 중지"
                            : occupied
                              ? "배정 확정"
                              : "빈 부스"}
                        </span>
                      </div>
                      <p>
                        {booth.zone || "구역 미지정"} · 테이블{" "}
                        {booth.table_capacity === null
                          ? "수용 개수 미확인"
                          : `${booth.table_capacity}개`}
                      </p>
                      <p className="muted">
                        {Object.entries(resourceLabels)
                          .filter(
                            ([key]) =>
                              booth[key as keyof typeof resourceLabels],
                          )
                          .map(([, label]) => label)
                          .join(" · ") || "추가 시설 없음"}
                      </p>
                      {booth.note && <p>{booth.note}</p>}
                      <p>
                        <strong>
                          {occupied
                            ? name(occupied.application_id)
                            : "확정된 셀러 없음"}
                        </strong>
                      </p>
                      {canManage && (
                        <Button
                          variant="secondary"
                          disabled={locked}
                          onClick={() => changeEditor(booth)}
                          aria-label={`${booth.booth_no} 부스 수정`}
                        >
                          시설·상태 수정
                        </Button>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
            {canManage && (
              <BoothEditor
                key={`${editor?.booth_id ?? "new"}:${editorGeneration}`}
                booth={editor}
                version={board.project.version}
                locked={locked || draftDirty || !!reason}
                onDirty={() => setEditorDirty(true)}
                onSave={(payload) =>
                  write(
                    editor ? "update" : "create",
                    editor ? `booths/${editor.booth_id}` : "booths",
                    payload,
                    editor ? "PATCH" : "POST",
                  )
                }
              />
            )}
          </section>
          <section className="booth-section" aria-labelledby="allocation-title">
            <h2 id="allocation-title">셀러별 배치 초안</h2>
            <p className="muted">
              조건에 맞는 부스를 선택해 변경할 셀러만 초안에 담으세요. 선택하지
              않은 셀러의 확정 배정은 유지됩니다. 초안 저장만으로 자리가
              확정되지는 않아요.
            </p>
            {!board.applications.length ? (
              <Notice title="참가확정한 셀러가 없어요.">
                셀러의 참가확정 이후 부스를 배정할 수 있어요.
              </Notice>
            ) : (
              <div
                className="booth-allocations"
                id="draft-selection"
                tabIndex={-1}
              >
                {board.applications.map((app) => {
                  const current = board.assignments.find(
                    (item) => item.application_id === app.application_id,
                  );
                  const draft = board.drafts.find(
                    (item) => item.application_id === app.application_id,
                  );
                  const selected = selections[app.application_id] || "";
                  const candidates = board.candidates.filter(
                    (item) => item.application_id === app.application_id,
                  );
                  const chosen = candidates.find(
                    (item) => item.booth_id === selected,
                  );
                  const requirements = [
                    app.electricity_required && "전기",
                    app.fire_required && "화기",
                    app.cold_storage_required && "냉장",
                    app.vehicle_entry_required && "차량 진입",
                    `테이블 ${app.table_count}개`,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <article
                      className="booth-allocation"
                      key={app.application_id}
                    >
                      <div>
                        <h3>{app.shop_name}</h3>
                        <p>
                          {app.product_name} · {app.category}
                        </p>
                        <p className="muted">필요 조건: {requirements}</p>
                        <p>
                          현재 확정:{" "}
                          <strong>
                            {current ? boothName(current.booth_id) : "미배정"}
                          </strong>
                        </p>
                        <p className="muted">
                          저장된 초안:{" "}
                          {draft ? boothName(draft.booth_id) : "변경 없음"}
                        </p>
                      </div>
                      <div className="booth-choice">
                        {canManage ? (
                          <>
                            <label htmlFor={`choice-${app.application_id}`}>
                              {app.shop_name} 변경할 부스
                            </label>
                            <select
                              className="input"
                              id={`choice-${app.application_id}`}
                              value={selected}
                              disabled={locked || editorDirty}
                              aria-describedby={`conditions-${app.application_id}`}
                              onChange={(event) =>
                                setSelections((value) => ({
                                  ...value,
                                  [app.application_id]: event.target.value,
                                }))
                              }
                            >
                              <option value="">변경 초안에서 제외</option>
                              {board.booths.map((booth) => {
                                const candidate = candidates.find(
                                  (item) => item.booth_id === booth.booth_id,
                                );
                                return (
                                  <option
                                    key={booth.booth_id}
                                    value={booth.booth_id}
                                    disabled={!candidate?.compatible}
                                  >
                                    {booth.booth_no} ·{" "}
                                    {booth.zone || "구역 없음"}
                                    {candidate?.compatible
                                      ? ""
                                      : " (조건 불일치)"}
                                  </option>
                                );
                              })}
                            </select>
                          </>
                        ) : (
                          <p>부스 변경은 운영자가 진행합니다.</p>
                        )}
                        <div
                          id={`conditions-${app.application_id}`}
                          className="booth-conditions"
                        >
                          {chosen?.compatible && (
                            <p>선택한 부스의 필수 시설 조건을 충족해요.</p>
                          )}
                          {chosen?.conflicts.map((message) => (
                            <p className="error" key={message}>
                              {message}
                            </p>
                          ))}
                          {chosen?.warnings.map((message) => (
                            <p className="booth-warning" key={message}>
                              {message}
                            </p>
                          ))}
                        </div>
                        <details>
                          <summary>부스별 조건 확인</summary>
                          <ul>
                            {candidates.map((candidate) => (
                              <li key={candidate.booth_id}>
                                <strong>{boothName(candidate.booth_id)}</strong>
                                :{" "}
                                {candidate.compatible
                                  ? "필수 조건 충족"
                                  : candidate.conflicts.join(" · ")}
                                {candidate.warnings.length
                                  ? ` · ${candidate.warnings.join(" · ")}`
                                  : ""}
                              </li>
                            ))}
                          </ul>
                        </details>
                        {canManage && (current || draft) && (
                          <Button
                            variant="secondary"
                            disabled={
                              locked || draftDirty || editorDirty || !!reason
                            }
                            onClick={() => {
                              setDecision({
                                kind: "release",
                                applicationId: app.application_id,
                              });
                              setDecisionReason("");
                              setDecisionError("");
                            }}
                          >
                            {app.shop_name} 배정 해제
                          </Button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            {canManage && (
              <div className="booth-draft-actions">
                <p role="status">
                  <strong>
                    {draftDirty
                      ? "저장하지 않은 변경이 있어요."
                      : "서버에 저장된 초안과 같아요."}
                  </strong>{" "}
                  · 선택한 변경{" "}
                  {Object.values(selections).filter(Boolean).length}건
                </p>
                <Field
                  id="draft-reason"
                  label="초안 저장 사유"
                  disabled={locked || editorDirty}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  error={error}
                />
                <div className="actions">
                  <Button disabled={locked || editorDirty} onClick={saveDraft}>
                    배치 초안 저장
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={
                      locked ||
                      !board.drafts.length ||
                      draftDirty ||
                      editorDirty
                    }
                    onClick={() => {
                      setDecision({ kind: "confirm" });
                      setDecisionReason("");
                      setDecisionError("");
                    }}
                  >
                    저장된 초안 확정
                  </Button>
                </div>
                <p className="hint">
                  미배정 셀러가 남아 있어도 선택한 변경만 확정할 수 있어요.
                  초안에서 모든 선택을 제외하고 저장하면 기존 초안만 비웁니다.
                </p>
                {editorDirty && (
                  <p className="hint">
                    입력 중인 부스 정보를 먼저 저장해 주세요.
                  </p>
                )}
              </div>
            )}
          </section>
          <section className="booth-section">
            <h2>배정 해제 이력</h2>
            {!board.history.length ? (
              <p className="muted">아직 해제된 배정이 없어요.</p>
            ) : (
              <ul className="booth-history">
                {board.history.map((item) => (
                  <li key={item.assignment_id}>
                    <strong>
                      {boothName(item.booth_id)} · {name(item.application_id)}
                    </strong>
                    <p>{item.release_reason || "사유 없음"}</p>
                    <p className="muted">
                      {kstDisplay(item.released_at)} (KST)
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      {decision && board && (
        <ConfirmDialog
          title={
            decision.kind === "confirm"
              ? "저장된 부스 배치를 확정할까요?"
              : `${name(decision.applicationId!)} 배정을 해제할까요?`
          }
          confirm={decision.kind === "confirm" ? "부스 배치 확정" : "배정 해제"}
          onCancel={() => {
            setDecision(null);
            setDecisionReason("");
          }}
          onConfirm={confirmDecision}
        >
          {decision.kind === "confirm" ? (
            <>
              <p>
                아래 {board.drafts.length}건을 함께 확정합니다. 변경 대상의 기존
                자리는 해제되며, 나머지 배정은 유지됩니다.
              </p>
              <ul>
                {board.drafts.map((item) => (
                  <li key={item.assignment_id}>
                    {name(item.application_id)} → {boothName(item.booth_id)}
                  </li>
                ))}
              </ul>
              <p>확정 전 현재 조건과 다른 셀러의 배정을 다시 검사합니다.</p>
            </>
          ) : (
            <p>
              현재 확정 배정과 이 셀러의 저장된 초안을 함께 해제합니다. 셀러의
              참가확정 상태는 유지됩니다.
            </p>
          )}
          <Field
            id="decision-reason"
            label="처리 사유"
            value={decisionReason}
            error={decisionError}
            onChange={(event) => setDecisionReason(event.target.value)}
          />
        </ConfirmDialog>
      )}
      {nextEditor && (
        <ConfirmDialog
          title="입력 중인 부스 정보를 버릴까요?"
          confirm="입력을 버리고 전환"
          onCancel={() => setNextEditor(null)}
          onConfirm={() => {
            setEditor(nextEditor.booth);
            setEditorDirty(false);
            setEditorGeneration((v) => v + 1);
            setNextEditor(null);
          }}
        >
          <p>저장하지 않은 부스 입력이 사라집니다.</p>
        </ConfirmDialog>
      )}
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
    </section>
  );
}
export function BoothBoard({ id }: { id: string }) {
  return (
    <MarketAccess>
      {(session) => <BoardContent id={id} session={session} />}
    </MarketAccess>
  );
}
