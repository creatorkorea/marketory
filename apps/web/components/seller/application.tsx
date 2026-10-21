"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { SellerAccess, type SellerSession } from "./access";
import { SellerUploads } from "./uploads";
import { SellerFileLink } from "./file-link";
import { api } from "@/lib/api/client";
import { useMarketMutation } from "@/lib/markets/use-mutation";
import {
  applicationFields,
  applicationPayload,
  validateSubmit,
  canEditField,
  FormError,
  applicationLabels,
  kstDisplay,
  type Application,
  type Seller,
  type PublicProject,
} from "@/lib/seller/form";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { TextareaField } from "@/components/ui/textarea-field";
import { Notice } from "@/components/ui/notice";
import { Toast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { UnsavedGuard } from "@/components/ui/unsaved-guard";
import { RequestStatus } from "@/components/requests/request-status";
const labels: Record<string, string> = {
  product_name: "상품명",
  product_desc: "상품 소개",
  price_range: "가격대",
  category: "카테고리",
  electricity_required: "전기 필요",
  table_count: "테이블 개수",
  fire_required: "화기 사용",
  cold_storage_required: "냉장 보관 필요",
  vehicle_entry_required: "차량 진입 필요",
  request_note: "요청 사항",
  product_images: "상품 사진",
  business_document: "사업자 증빙",
};
function ApplicationEditor({
  session,
  initial,
  listOffset = 0,
}: {
  session: SellerSession;
  initial: Application;
  listOffset?: number;
}) {
  const [app, setApp] = useState(initial),
    [latest, setLatest] = useState<Application | null>(null),
    [step, setStep] = useState(1),
    [dirty, setDirty] = useState(false),
    [change, setChange] = useState(0),
    [composing, setComposing] = useState(false),
    [key, setKey] = useState(0),
    [error, setError] = useState<FormError | null>(null),
    [loadError, setLoadError] = useState(""),
    [toast, setToast] = useState(""),
    [uploadBusy, setUploadBusy] = useState(false),
    [consent, setConsent] = useState(false),
    [confirm, setConfirm] = useState<
      "submit" | "resubmit" | "cancel" | "confirm" | null
    >(null),
    [reason, setReason] = useState(""),
    [saveState, setSaveState] = useState("");
  const form = useRef<HTMLFormElement>(null),
    active = useRef<AbortController | null>(null),
    appRef = useRef(app),
    dirtyRef = useRef(dirty);
  appRef.current = app;
  dirtyRef.current = dirty;
  const read = useCallback(
    async (compare = false) => {
      active.current?.abort();
      const c = new AbortController();
      active.current = c;
      setLoadError("");
      try {
        const r = await api(
          session.client,
          session.actor,
          `applications/${initial.application_id}`,
          c.signal,
        );
        if (c.signal.aborted) return;
        if (r.status !== 200) {
          setLoadError(
            r.status === 401
              ? "로그인이 만료되었습니다. 같은 계정으로 다시 로그인해 주세요."
              : "신청 정보를 불러오지 못했습니다.",
          );
          return;
        }
        const data = r.body.data as Application;
        if (compare || dirtyRef.current) setLatest(data);
        else {
          setApp(data);
          // A new version and its uncontrolled form values must advance together.
          setKey((value) => value + 1);
          setConsent(false);
        }
      } catch {
        if (!c.signal.aborted) setLoadError("신청 정보를 불러오지 못했습니다.");
      }
    },
    [initial.application_id, session],
  );
  useEffect(() => () => active.current?.abort(), []);
  const mutation = useMarketMutation(
    session,
    `application:${app.application_id}`,
    (data) => {
      const next = data as Application;
      setApp(next);
      setDirty(false);
      setError(null);
      setLatest(null);
      setSaveState("임시저장됨");
      setConsent(false);
      if (next.status !== "DRAFT" && next.status !== "NEED_INFO")
        setToast(
          next.status === "CONFIRMED"
            ? "참가를 확정했어요."
            : next.status === "CANCELLED"
              ? "신청을 취소했어요."
              : "신청을 접수했어요.",
        );
    },
  );
  const editing = app.allowed_actions.includes("update"),
    blocked = mutation.locked || uploadBusy || !!latest;
  const focus = (err: FormError) => {
    setError(err);
    setStep(
      err.field === "table_count" || err.field === "request_note" ? 3 : 2,
    );
    requestAnimationFrame(() =>
      form.current
        ?.querySelector<HTMLElement>(
          `[name="${err.field}"], [id="${err.field}"]`,
        )
        ?.focus(),
    );
  };
  const save = useCallback(() => {
    if (!form.current || mutation.locked || uploadBusy || latest || !editing)
      return;
    try {
      const body = applicationPayload(
        new FormData(form.current),
        appRef.current,
      );
      setError(null);
      setSaveState("저장 중");
      void mutation.start(
        "applications.update",
        `applications/${appRef.current.application_id}`,
        "PATCH",
        body,
      );
    } catch (e) {
      if (e instanceof FormError) {
        setSaveState("입력 확인 필요");
        focus(e);
      }
    }
  }, [mutation, uploadBusy, latest, editing]);
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (
      !dirty ||
      composing ||
      blocked ||
      (mutation.result &&
        [
          "conflict",
          "failed",
          "expired",
          "review",
          "forbidden",
          "reauth",
          "unresolved",
        ].includes(mutation.result.state))
    )
      return;
    const timer = setTimeout(() => saveRef.current(), 800);
    return () => clearTimeout(timer);
  }, [dirty, change, composing, blocked, mutation.result]);
  const busy = useCallback((value: boolean) => setUploadBusy(value), []),
    refresh = useCallback(() => read(false), [read]);
  const submission = app.status === "NEED_INFO" ? "resubmit" : "submit";
  function prepareSubmit() {
    if (blocked || dirty) return;
    try {
      validateSubmit(app);
      if (!consent)
        throw new FormError("consent", "동의 내용을 읽고 체크해 주세요.");
      setError(null);
      setConfirm(submission);
    } catch (e) {
      if (e instanceof FormError) {
        if (e.field === "consent") {
          setError(e);
          document.getElementById("consent")?.focus();
        } else focus(e);
      }
    }
  }
  const input = (
    name: string,
    label: string,
    extra: Record<string, unknown> = {},
  ) => (
    <Field
      key={`${name}:${key}`}
      id={name}
      name={name}
      label={label}
      defaultValue={String(app[name as keyof Application] ?? "")}
      disabled={!canEditField(app, name)}
      error={error?.field === name ? error.message : undefined}
      {...extra}
    />
  );
  const area = (name: "product_desc" | "request_note", label: string) => (
    <TextareaField
      key={`${name}:${key}`}
      id={name}
      name={name}
      label={label}
      defaultValue={app[name] ?? ""}
      disabled={!canEditField(app, name)}
      error={error?.field === name ? error.message : undefined}
    />
  );
  return (
    <>
      <UnsavedGuard active={dirty || !!mutation.pending || uploadBusy} />
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
      <div className="seller-detail-heading">
        <div>
          <p className="eyebrow">내 신청</p>
          <h2>{app.project.name}</h2>
        </div>
        <span className="badge">
          {applicationLabels[app.status] ?? app.status}
        </span>
      </div>
      <ButtonLink
        variant="secondary"
        href={`/me/applications?offset=${listOffset}`}
      >
        내 신청 목록
      </ButtonLink>
      {loadError && (
        <Notice title={loadError} tone="warning">
          <Button onClick={() => void read(true)}>다시 확인</Button>
        </Notice>
      )}
      {mutation.result && mutation.result.state !== "succeeded" && (
        <RequestStatus
          business
          subject="신청"
          result={mutation.result}
          onRetry={mutation.retry}
          onCurrent={() => void read(true)}
        />
      )}{" "}
      {mutation.storageError && (
        <Notice title="요청 복구 정보를 보관할 수 없어요." tone="warning">
          브라우저의 사이트 저장을 허용해 주세요. 새 작업을 시작하지 않았습니다.
        </Notice>
      )}
      {latest && (
        <Notice title="최신 신청과 현재 입력을 비교해 주세요." tone="warning">
          <p>
            최신 상태: {applicationLabels[latest.status]} · 상품:{" "}
            {latest.product_name || "미입력"} · 카테고리:{" "}
            {latest.category || "미입력"} · 가격대:{" "}
            {latest.price_range || "미입력"}
          </p>
          <p className="seller-prose">
            최신 소개: {latest.product_desc || "미입력"}
          </p>
          <div className="actions">
            <Button
              variant="secondary"
              onClick={() => {
                setApp(latest);
                setKey((v) => v + 1);
                setDirty(false);
                setLatest(null);
                setConsent(false);
                mutation.clear();
              }}
            >
              최신 내용 불러오기
            </Button>
            <Button
              disabled={
                !latest.allowed_actions.includes("update") ||
                latest.status !== app.status
              }
              onClick={() => {
                setApp(latest);
                setLatest(null);
                setConsent(false);
                mutation.clear();
              }}
            >
              입력 유지하고 최신 버전 사용
            </Button>
          </div>
        </Notice>
      )}
      {app.status === "CONFIRMED" && app.booth && (
        <Notice title={`확정 부스 · ${app.booth.booth_no}`}>
          <p>구역: {app.booth.zone || "구역 미지정"}</p>
          <p>
            테이블{" "}
            {app.booth.table_capacity === null
              ? "수용량 미정"
              : `${app.booth.table_capacity}개`}{" "}
            · 전기 {app.booth.electricity_available ? "가능" : "불가"} · 화기{" "}
            {app.booth.fire_allowed ? "허용" : "불가"} · 냉장{" "}
            {app.booth.cold_storage_available ? "가능" : "불가"} · 차량 접근{" "}
            {app.booth.vehicle_access ? "가능" : "불가"}
          </p>
          <p>배치 확정: {kstDisplay(app.booth.confirmed_at)} (KST)</p>
        </Notice>
      )}
      {app.status === "CONFIRMED" && !app.booth && (
        <Notice title="부스 배치를 기다리고 있어요.">
          운영자가 배치를 확정하면 이곳에서 확인할 수 있습니다.
        </Notice>
      )}
      {app.status === "NEED_INFO" && (
        <Notice title="요청한 항목만 보완할 수 있어요." tone="warning">
          <p>보완기한 (한국시간): {kstDisplay(app.info_due_at)}</p>
          <ul>
            {app.info_requests_json?.map((r, i) => (
              <li key={i}>
                {labels[r.field] ?? r.field}: {r.reason}
              </li>
            ))}
          </ul>
        </Notice>
      )}
      {editing ? (
        <>
          <ol className="seller-steps" aria-label="신청 작성 단계">
            {["기본 정보", "상품과 사진", "운영 조건", "동의 및 확인"].map(
              (label, i) => (
                <li key={label}>
                  <button
                    type="button"
                    aria-current={step === i + 1 ? "step" : undefined}
                    onClick={() => setStep(i + 1)}
                  >
                    {i + 1}. {label}
                  </button>
                </li>
              ),
            )}
          </ol>
          <form
            key={key}
            ref={form}
            className="seller-form"
            noValidate
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              save();
            }}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => {
              setComposing(false);
              setChange((v) => v + 1);
            }}
            onChange={(e) => {
              if ((e.target as unknown as HTMLElement).id === "consent") return;
              setDirty(true);
              setSaveState("저장 대기");
              setChange((v) => v + 1);
              setConsent(false);
            }}
          >
            <fieldset disabled={blocked}>
              <section hidden={step !== 1}>
                <h3>1. 기본 정보</h3>
                <p>
                  셀러 프로필과 인증 계정 정보로 신청합니다. 제출 시점의 정보가
                  신청에 함께 저장됩니다.
                </p>
                <ButtonLink
                  href={`/seller/profile?returnTo=${encodeURIComponent(`/p/${app.project_id}/apply`)}`}
                  variant="secondary"
                >
                  셀러 프로필 확인·수정
                </ButtonLink>
                <p>
                  마켓: {app.project.name} · {app.project.venue}
                </p>
                <p>모집 마감: {kstDisplay(app.project.recruit_end_at)}</p>
              </section>
              <section hidden={step !== 2}>
                <h3>2. 상품 소개</h3>
                {input("product_name", "상품명 (필수)")}
                {area("product_desc", "상품 소개 (필수)")}
                {input("price_range", "가격대 (필수)", {
                  hint: "판매하는 상품의 가격 범위를 적어 주세요.",
                })}
                <div className="field">
                  <label htmlFor="category">카테고리 (필수)</label>
                  <select
                    className="input"
                    id="category"
                    name="category"
                    defaultValue={app.category ?? ""}
                    disabled={!canEditField(app, "category")}
                    aria-invalid={error?.field === "category"}
                    aria-describedby="category-help"
                  >
                    <option value="">선택해 주세요</option>
                    {app.project.policy_json.allowed_categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <p className="field-help error" id="category-help">
                    {error?.field === "category" ? error.message : ""}
                  </p>
                </div>
                {dirty && (
                  <Notice title="상품 변경 사항을 저장한 뒤 파일을 선택해 주세요.">
                    <Button type="submit" variant="secondary">
                      지금 임시저장
                    </Button>
                  </Notice>
                )}
              </section>
              <section hidden={step !== 3}>
                <h3>3. 운영 조건</h3>
                {input("table_count", "테이블 개수", { inputMode: "numeric" })}
                {[
                  "electricity_required",
                  "fire_required",
                  "cold_storage_required",
                  "vehicle_entry_required",
                ].map((field) => (
                  <label className="choice" key={field}>
                    <input
                      type="checkbox"
                      name={field}
                      defaultChecked={Boolean(app[field as keyof Application])}
                      disabled={!canEditField(app, field)}
                    />
                    {labels[field]}
                  </label>
                ))}
                {area("request_note", "요청 사항")}
              </section>
              <section hidden={step !== 4}>
                <h3>4. 동의 및 최종 확인</h3>
                <dl className="seller-facts">
                  {applicationFields.map((field) => (
                    <div key={field}>
                      <dt>{labels[field]}</dt>
                      <dd className="seller-prose">
                        {typeof app[field as keyof Application] === "boolean"
                          ? app[field as keyof Application]
                            ? "필요"
                            : "불필요"
                          : String(app[field as keyof Application] ?? "") ||
                            "미입력"}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p>
                  연결된 파일 {app.attachments.length}개 · 참가비{" "}
                  {app.project.policy_json.participation_fee_krw.toLocaleString(
                    "ko-KR",
                  )}
                  원
                </p>
                <h3>운영 안내</h3>
                <p className="seller-prose">
                  {app.project.booth_policy_json.description}
                </p>
                <h3>동의 내용 · {app.project.policy_json.consent_version}</h3>
                <p className="seller-prose">
                  {app.project.policy_json.consent_text ||
                    "동의 내용이 등록되지 않았습니다. 운영자에게 확인해 주세요."}
                </p>
                <label className="choice">
                  <input
                    id="consent"
                    type="checkbox"
                    checked={consent}
                    disabled={dirty || !app.project.policy_json.consent_text}
                    onChange={(e) => setConsent(e.target.checked)}
                    aria-describedby="consent-help"
                  />
                  위 동의 내용을 확인하고 동의합니다.
                </label>
                <p
                  id="consent-help"
                  className="field-help error"
                  role={error?.field === "consent" ? "alert" : undefined}
                >
                  {error?.field === "consent" ? error.message : ""}
                </p>
                <Button
                  type="button"
                  disabled={
                    dirty ||
                    blocked ||
                    !app.allowed_actions.includes(submission) ||
                    !app.project.policy_json.consent_text
                  }
                  onClick={prepareSubmit}
                >
                  {submission === "resubmit"
                    ? "보완 제출 내용 확인"
                    : "신청 제출 내용 확인"}
                </Button>
              </section>
            </fieldset>
          </form>
          <div hidden={step !== 2}>
            <SellerUploads
              session={session}
              app={app}
              disabled={dirty || mutation.locked || !!latest}
              onBusy={busy}
              onRefresh={refresh}
            />
            {error &&
              ["product_images", "business_document"].includes(error.field) && (
                <Notice title={error.message} tone="warning" />
              )}
          </div>
          <fieldset className="seller-wizard-controls" disabled={blocked}>
            <div className="seller-wizard-actions">
              <span role="status" className="muted">
                {dirty
                  ? saveState || "저장 대기"
                  : saveState || "서버에 저장된 초안"}
              </span>
              <div className="actions">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!dirty}
                  onClick={() => save()}
                >
                  임시저장
                </Button>
                {step > 1 && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setStep((v) => v - 1)}
                  >
                    이전 단계
                  </Button>
                )}
                {step < 4 && (
                  <Button type="button" onClick={() => setStep((v) => v + 1)}>
                    다음 단계
                  </Button>
                )}
              </div>
            </div>
          </fieldset>
        </>
      ) : (
        <section className="market-section">
          <dl className="seller-facts">
            <div>
              <dt>접수번호</dt>
              <dd>{app.receipt_no ?? app.application_id}</dd>
            </div>
            <div>
              <dt>접수시각 (한국시간)</dt>
              <dd>
                {app.submitted_at
                  ? kstDisplay(app.submitted_at)
                  : "아직 제출되지 않았습니다."}
              </dd>
            </div>
            {applicationFields.map((field) => (
              <div key={field}>
                <dt>{labels[field]}</dt>
                <dd className="seller-prose">
                  {typeof app[field] === "boolean"
                    ? app[field]
                      ? "필요"
                      : "불필요"
                    : String(app[field] ?? "") || "미입력"}
                </dd>
              </div>
            ))}
          </dl>
          <h3>연결된 파일</h3>
          <ul>
            {app.attachments.map((a) => (
              <li key={a.attachment_id}>
                {a.original_name}
                <SellerFileLink session={session} file={a} />
              </li>
            ))}
          </ul>
          {["SUBMITTED", "REVIEWING"].includes(app.status) && (
            <Notice title="접수를 확인했어요.">
              접수 완료는 선정 또는 참가확정을 의미하지 않습니다. 이후 결과는 내
              신청에서 확인해 주세요.
            </Notice>
          )}
        </section>
      )}
      {app.status === "APPROVED" && (
        <section className="market-section">
          <h3>참가확정</h3>
          <p>
            선정되었습니다. 행사에 참가할 수 있는지 확인한 뒤 확정해 주세요.
          </p>
          <p>확정기한 (한국시간): {kstDisplay(app.confirm_due_at)}</p>
          {app.allowed_actions.includes("confirm") ? (
            <Button
              disabled={blocked || dirty}
              onClick={() => setConfirm("confirm")}
            >
              참가확정 내용 확인
            </Button>
          ) : (
            <Notice title="현재 참가확정할 수 없습니다." tone="warning">
              기한이 지났다면 운영자에게 연장을 요청해 주세요. 자동 취소되지는
              않습니다.
            </Notice>
          )}
        </section>
      )}
      {app.status === "CONFIRMED" && (
        <Notice title="참가확정이 완료됐어요.">
          행사 준비 안내와 배치 정보는 추후 내 신청에서 확인해 주세요.
        </Notice>
      )}
      {app.allowed_actions.includes("cancel") && (
        <details className="market-section seller-cancel">
          <summary>신청 취소</summary>
          <p className="hint">
            신청을 철회해야 할 때만 열어 주세요. 취소 후에는 같은 마켓에 다시
            신청할 수 없습니다.
          </p>
          <Field
            id="cancel-reason"
            label="취소 사유"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            hint="취소 후 같은 마켓에 새 신청을 만들 수 없습니다."
          />
          <Button
            variant="secondary"
            disabled={blocked || dirty || !reason.trim()}
            onClick={() => setConfirm("cancel")}
          >
            신청 취소 내용 확인
          </Button>
        </details>
      )}
      {confirm && (
        <ConfirmDialog
          title={
            confirm === "cancel"
              ? `${app.project.name} 신청을 취소할까요?`
              : confirm === "confirm"
                ? `${app.project.name} 참가를 확정할까요?`
                : `${app.project.name} 신청을 제출할까요?`
          }
          confirm={
            confirm === "cancel"
              ? "신청 취소하기"
              : confirm === "confirm"
                ? "참가확정하기"
                : confirm === "resubmit"
                  ? "보완 제출하기"
                  : "신청 제출하기"
          }
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const action = confirm;
            setConfirm(null);
            mutation.start(
              `applications.${action}`,
              `applications/${app.application_id}/${action}`,
              "POST",
              action === "cancel"
                ? { expected_version: app.version, reason: reason.trim() }
                : action === "confirm"
                  ? { expected_version: app.version }
                  : {
                      expected_version: app.version,
                      expected_policy_version: app.project.policy_version,
                      consent_version: app.project.policy_json.consent_version,
                      consent_accepted: true,
                    },
            );
          }}
        >
          <p>
            {confirm === "cancel"
              ? `취소 후 재신청할 수 없습니다. 사유: ${reason}`
              : confirm === "confirm"
                ? "참가 의사를 확정합니다. 이후 변경이 생기면 취소 사유를 남기고 운영자에게 알려 주세요."
                : "서버 확인 후 접수 완료로 표시합니다. 저장된 상품과 첨부 파일, 현재 동의 내용으로 제출합니다."}
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
function ApplicationLoader({
  session,
  id,
  projectId,
  listOffset = 0,
}: {
  session: SellerSession;
  id?: string;
  projectId?: string;
  listOffset?: number;
}) {
  const [app, setApp] = useState<Application | null>(null),
    [seller, setSeller] = useState<Seller | null>(null),
    [project, setProject] = useState<PublicProject | null>(null),
    [state, setState] = useState("loading"),
    [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  const read = useCallback(async () => {
    active.current?.abort();
    const c = new AbortController();
    active.current = c;
    setState("loading");
    setApp(null);
    setProject(null);
    setSeller(null);
    setError("");
    try {
      if (id) {
        const r = await api(
          session.client,
          session.actor,
          `applications/${id}`,
          c.signal,
        );
        if (c.signal.aborted) return;
        if (r.status !== 200)
          throw new Error(
            r.status === 401
              ? "로그인이 만료되었습니다."
              : "본인의 신청만 확인할 수 있습니다. 신청 또는 권한을 확인해 주세요.",
          );
        setApp(r.body.data as Application);
        setState("ready");
        return;
      }
      const profile = await api(
        session.client,
        session.actor,
        "me/seller",
        c.signal,
      );
      if (profile.status !== 200)
        throw new Error("셀러 프로필을 불러오지 못했습니다.");
      setSeller(profile.body.data as Seller | null);
      const own = await api(
        session.client,
        session.actor,
        `me/applications?project_id=${projectId}&limit=20&offset=0`,
        c.signal,
      );
      if (own.status !== 200)
        throw new Error("기존 신청을 확인하지 못했습니다.");
      const data = own.body.data;
      const rows = Array.isArray(data)
        ? data
        : ((data as { items?: unknown[] })?.items ?? []);
      if (rows.length) {
        const aid = (rows[0] as Application).application_id;
        const r = await api(
          session.client,
          session.actor,
          `applications/${aid}`,
          c.signal,
        );
        if (r.status !== 200)
          throw new Error("기존 신청을 불러오지 못했습니다.");
        if (c.signal.aborted) return;
        setApp(r.body.data as Application);
        setState("ready");
        return;
      }
      const response = await fetch(
        `/api/backend/public/projects/${projectId}`,
        { signal: c.signal, cache: "no-store" },
      );
      if (!response.ok) throw new Error("공개된 마켓을 찾을 수 없습니다.");
      const publicData = await response.json();
      if (c.signal.aborted) return;
      setProject(publicData.data);
      setState("new");
    } catch (e) {
      if (!c.signal.aborted) {
        setError((e as Error).message);
        setState("error");
      }
    }
  }, [id, projectId, session]);
  useEffect(() => {
    void read();
    return () => active.current?.abort();
  }, [read]);
  const mutation = useMarketMutation(
    session,
    `application-create:${projectId ?? id}`,
    (data) => {
      setApp(data as Application);
      setState("ready");
    },
  );
  if (app)
    return (
      <ApplicationEditor
        key={app.application_id}
        session={session}
        initial={app}
        listOffset={listOffset}
      />
    );
  return (
    <>
      {state === "loading" && (
        <Notice title="프로필과 기존 신청을 확인하고 있어요." />
      )}
      {error && (
        <Notice title={error} tone="warning">
          <Button onClick={() => void read()}>다시 확인</Button>
        </Notice>
      )}
      {mutation.result && (
        <RequestStatus
          business
          subject="신청"
          result={mutation.result}
          onRetry={mutation.retry}
          onCurrent={() => void read()}
        />
      )}{" "}
      {state === "new" && project && (
        <>
          <h2>{project.name}</h2>
          {!seller ? (
            <Notice title="셀러 프로필을 먼저 작성해 주세요.">
              <ButtonLink
                href={`/seller/profile?returnTo=${encodeURIComponent(`/p/${projectId}/apply`)}`}
              >
                프로필 작성하기
              </ButtonLink>
            </Notice>
          ) : project.accepting_applications ? (
            <section className="market-section">
              <p>
                {seller.shop_name}의 신청서를 준비합니다. 이 마켓에 하나의
                신청만 저장할 수 있습니다.
              </p>
              <div className="actions">
                <Button
                  disabled={mutation.locked}
                  onClick={() =>
                    mutation.start(
                      "applications.create",
                      "applications",
                      "POST",
                      { project_id: projectId },
                    )
                  }
                >
                  신청 초안 만들기
                </Button>
                <ButtonLink variant="secondary" href={`/p/${projectId}`}>
                  모집 안내로
                </ButtonLink>
              </div>
            </section>
          ) : (
            <Notice title="현재 신규 신청을 받지 않아요.">
              <ButtonLink href={`/p/${projectId}`}>모집 안내 확인</ButtonLink>
            </Notice>
          )}
        </>
      )}
    </>
  );
}
export function SellerApplication({
  id,
  projectId,
  listOffset,
}: {
  id?: string;
  projectId?: string;
  listOffset?: number;
}) {
  return (
    <SellerAccess>
      {(session) => (
        <ApplicationLoader
          session={session}
          id={id}
          projectId={projectId}
          listOffset={listOffset}
        />
      )}
    </SellerAccess>
  );
}
