"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { MarketAccess, type MarketSession } from "./access";
import { api } from "@/lib/api/client";
import {
  FormError,
  kstInput,
  marketPayload,
  statusLabels,
  type Market,
} from "@/lib/markets/form";
import { useMarketMutation } from "@/lib/markets/use-mutation";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { TextareaField } from "@/components/ui/textarea-field";
import { Notice } from "@/components/ui/notice";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { UnsavedGuard } from "@/components/ui/unsaved-guard";
import { Toast } from "@/components/ui/toast";
import { RequestStatus } from "@/components/requests/request-status";
type Member = { user_id: string; email: string; role: string; active: boolean };
type Intent = {
  operation: string;
  path: string;
  method: "POST" | "PATCH";
  body: Record<string, unknown>;
  title: string;
  description: string;
  label: string;
};
const roles: Record<string, string> = {
  OPERATOR: "운영자",
  REVIEWER: "심사자",
  VIEWER: "열람자",
};
const transitions: Record<string, string[]> = {
  DRAFT: ["RECRUITING"],
  RECRUITING: ["REVIEWING"],
  REVIEWING: ["RECRUITING", "CLOSED"],
  CLOSED: ["REVIEWING", "COMPLETED"],
};
const transitionCopy: Record<string, string> = {
  RECRUITING: "모집 조건이 공개됩니다. 설정한 기간에만 모집이 열립니다.",
  REVIEWING:
    "모집을 닫고 심사 단계로 이동합니다. 운영 확정 상태였다면 재검토를 시작합니다.",
  CLOSED:
    "운영 내용을 확정합니다. 다시 수정하려면 행사 종료 전 재검토를 시작해야 합니다.",
  COMPLETED:
    "행사를 최종 종료합니다. 이후 운영 설정과 권한을 변경할 수 없습니다.",
};
function Editor({ session, id }: { session: MarketSession; id?: string }) {
  const router = useRouter();
  const [project, setProject] = useState<Market | null>(null),
    [latest, setLatest] = useState<Market | null>(null),
    [loaded, setLoaded] = useState(!id),
    [loadError, setLoadError] = useState("");
  const [members, setMembers] = useState<Member[]>([]),
    [memberError, setMemberError] = useState(false),
    [dirty, setDirty] = useState(false),
    [formKey, setFormKey] = useState(0),
    [error, setError] = useState<FormError | null>(null),
    [toast, setToast] = useState("");
  const [intent, setIntent] = useState<Intent | null>(null);
  const active = useRef<AbortController | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const closeToast = useCallback(() => setToast(""), []);
  const readMembers = useCallback(
    async (signal: AbortSignal) => {
      if (!id || !session.admin) return;
      try {
        const r = await api(
          session.client,
          session.actor,
          `projects/${id}/members`,
          signal,
        );
        if (signal.aborted) return;
        if (r.status === 200 && Array.isArray(r.body.data)) {
          setMembers(r.body.data as Member[]);
          setMemberError(false);
        } else setMemberError(true);
      } catch {
        if (!signal.aborted) setMemberError(true);
      }
    },
    [id, session],
  );
  const read = useCallback(
    async (compare = false) => {
      if (!id) return;
      active.current?.abort();
      const c = new AbortController();
      active.current = c;
      setLoadError("");
      try {
        const r = await api(
          session.client,
          session.actor,
          `projects/${id}/settings`,
          c.signal,
        );
        if (c.signal.aborted) return;
        if (r.status !== 200) {
          setLoadError(
            r.status === 401
              ? "로그인이 만료되었습니다. 내 계정에서 다시 로그인해 주세요."
              : r.status === 403 || r.status === 404
                ? "이 마켓의 설정을 변경할 권한이 없거나 마켓이 없습니다."
                : "설정을 불러오지 못했습니다. 연결 상태를 확인해 주세요.",
          );
          return;
        }
        const p = r.body.data as Market;
        if (compare) setLatest(p);
        else {
          setProject(p);
          setLoaded(true);
        }
        await readMembers(c.signal);
      } catch {
        if (!c.signal.aborted)
          setLoadError("설정을 불러오지 못했습니다. 다시 시도해 주세요.");
      }
    },
    [id, session, readMembers],
  );
  useEffect(() => {
    void read();
    return () => active.current?.abort();
  }, [read]);
  const mutation = useMarketMutation(session, id ?? "new", (data) => {
    const p = data as Market;
    setDirty(false);
    setError(null);
    setToast("마켓 변경 사항을 저장했어요.");
    setProject(p);
    setLatest(null);
    setFormKey((v) => v + 1);
    if (!id) {
      router.replace(`/markets/${p.project_id}`);
      return;
    }
    void readMembers(new AbortController().signal);
  });
  const immutable =
    project?.status === "COMPLETED" ||
    (!!project && Date.now() >= Date.parse(project.event_end_at));
  const blocked = mutation.locked || immutable;
  const request = (action: Intent) => {
    if (mutation.locked || (immutable && action.body.status !== "COMPLETED"))
      return;
    setIntent(action);
  };
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (blocked) return;
    setError(null);
    try {
      const body = marketPayload(new FormData(e.currentTarget));
      mutation.start(
        id ? "projects.update" : "projects.create",
        id ? `projects/${id}` : "projects",
        id ? "PATCH" : "POST",
        { ...body, ...(project ? { expected_version: project.version } : {}) },
      );
    } catch (e) {
      const err =
        e instanceof FormError
          ? e
          : new FormError("reason", "입력을 확인해 주세요.");
      setError(err);
      form.current
        ?.querySelector<HTMLElement>(`[name="${err.field}"]`)
        ?.focus();
    }
  }
  function status(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!project || dirty) return;
    const f = new FormData(e.currentTarget);
    const state = String(f.get("status") ?? "");
    const reason = String(f.get("statusReason") ?? "").trim();
    if (!state || !reason) {
      setError(
        new FormError("statusReason", "변경할 상태와 사유를 입력해 주세요."),
      );
      e.currentTarget
        .querySelector<HTMLElement>("[name=statusReason]")
        ?.focus();
      return;
    }
    request({
      operation: "projects.status",
      path: `projects/${id}/status`,
      method: "POST",
      body: { status: state, reason, expected_version: project.version },
      title: `${project.name} · ${statusLabels[state]}`,
      description: `${transitionCopy[state]} 변경 사유: ${reason}`,
      label: "상태 변경하기",
    });
  }
  function member(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!project || dirty) return;
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email") ?? "").trim(),
      reason = String(f.get("memberReason") ?? "").trim(),
      role = String(f.get("role") ?? ""),
      enabled = f.get("enabled") === "yes";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !reason || !roles[role]) {
      setError(
        new FormError("email", "이메일·역할·변경 사유를 모두 확인해 주세요."),
      );
      e.currentTarget.querySelector<HTMLElement>("[name=email]")?.focus();
      return;
    }
    request({
      operation: "projects.members",
      path: `projects/${id}/members`,
      method: "POST",
      body: {
        email,
        role,
        active: enabled,
        reason,
        expected_version: project.version,
      },
      title: enabled ? "마켓 권한을 배정할까요?" : "마켓 권한을 해제할까요?",
      description: `${project.name} · ${email} · ${roles[role]}. ${enabled ? "인증된 계정을 운영 스태프로 전환하고 이 마켓의 권한을 부여합니다." : "이 마켓에 대한 배정을 해제합니다."} 사유: ${reason}`,
      label: enabled ? "권한 배정하기" : "권한 해제하기",
    });
  }
  const fieldError = (name: string) =>
    error?.field === name ? error.message : undefined;
  const field = (
    name: string,
    label: string,
    value: string | number = "",
    hint?: string,
    maxLength?: number,
  ) => (
    <Field
      id={name}
      name={name}
      label={label}
      defaultValue={value}
      hint={hint}
      error={fieldError(name)}
      maxLength={maxLength}
    />
  );
  const area = (
    name: string,
    label: string,
    value = "",
    hint = "",
    maxLength = 5000,
  ) => (
    <TextareaField
      id={name}
      name={name}
      label={label}
      defaultValue={value}
      maxLength={maxLength}
      hint={hint}
      error={fieldError(name)}
    />
  );
  return (
    <>
      <UnsavedGuard active={dirty || !!mutation.pending} />
      {toast && <Toast message={toast} onClose={closeToast} />}
      <ButtonLink variant="secondary" href="/markets">
        마켓 목록
      </ButtonLink>
      {id && (
        <ButtonLink variant="secondary" href={`/markets/${id}/applications`}>
          신청 검토
        </ButtonLink>
      )}
      {loadError && (
        <Notice title={loadError} tone="warning">
          <Button onClick={() => void read(loaded)}>다시 확인</Button>
        </Notice>
      )}
      {!loaded && !loadError && <Notice title="설정을 불러오고 있어요." />}
      {loaded && (
        <>
          {project && (
            <div className="market-toolbar">
              <h2>{project.name}</h2>
              <span className="badge">
                {statusLabels[project.status]} · 버전 {project.version}
              </span>
            </div>
          )}
          {immutable && (
            <Notice title="행사가 종료되어 설정을 변경할 수 없어요.">
              운영 확정 상태의 행사는 아래에서 최종 종료할 수 있습니다.
            </Notice>
          )}
          {mutation.storageError && (
            <Notice tone="warning" title="요청 복구 정보를 보관할 수 없어요.">
              사이트 저장을 허용한 뒤 다시 열어 주세요. 중복 처리를 막기 위해
              저장을 시작하지 않았습니다.
            </Notice>
          )}
          {mutation.result && mutation.result.state !== "succeeded" && (
            <RequestStatus
              business
              result={mutation.result}
              onRetry={mutation.retry}
              onCurrent={() => (id ? void read(true) : router.push("/markets"))}
            />
          )}
          {latest && (
            <Notice
              title={`최신 내용: ${latest.name} · 버전 ${latest.version}`}
            >
              <p>
                현재 장소: {latest.venue}, 정원: {latest.target_team_count}팀.
                입력은 아직 유지됩니다. 최신 내용을 적용하면 저장 전 입력을
                대체합니다.
              </p>
              <Button
                onClick={() => {
                  setProject(latest);
                  setLatest(null);
                  setDirty(false);
                  setFormKey((v) => v + 1);
                  mutation.clear();
                }}
              >
                최신 내용으로 입력 바꾸기
              </Button>
            </Notice>
          )}
          <form
            key={formKey}
            ref={form}
            className="market-form"
            noValidate
            onSubmit={save}
            onChange={() => setDirty(true)}
          >
            <fieldset disabled={blocked || project?.status === "CLOSED"}>
              <legend>기본 정보</legend>
              <p className="muted">
                초안은 운영자만 볼 수 있습니다. 모든 날짜와 시간은 한국
                시간(KST)입니다.
              </p>
              <div className="form-grid">
                {field(
                  "name",
                  "마켓 이름",
                  project?.name ?? "",
                  undefined,
                  150,
                )}
                {field("venue", "장소", project?.venue ?? "", undefined, 255)}
                {field(
                  "start",
                  "모집 시작",
                  project ? kstInput(project.recruit_start_at) : "",
                  "예: 2026-11-01 09:00",
                  16,
                )}
                {field(
                  "end",
                  "모집 마감",
                  project ? kstInput(project.recruit_end_at) : "",
                  "YYYY-MM-DD HH:mm",
                  16,
                )}
                {field(
                  "event",
                  "행사 종료",
                  project ? kstInput(project.event_end_at) : "",
                  "이 날짜가 행사일입니다. YYYY-MM-DD HH:mm",
                  16,
                )}
                {field(
                  "capacity",
                  "모집 정원 (팀)",
                  project?.target_team_count ?? "",
                  "1팀 이상 정수",
                )}
              </div>
              <h2>모집 조건</h2>
              <div className="form-grid">
                {area(
                  "categories",
                  "모집 품목",
                  project?.policy_json.allowed_categories.join("\n"),
                  "한 줄에 하나씩. 공개 전 필수입니다.",
                )}
                {area(
                  "restricted",
                  "제한 품목",
                  project?.policy_json.restricted_items.join("\n"),
                  "한 줄에 하나씩 입력해 주세요.",
                )}
              </div>
              {field(
                "fee",
                "참가비 (원)",
                project?.policy_json.participation_fee_krw ?? 0,
                "무료는 0원",
              )}
              <label className="choice">
                <input
                  type="checkbox"
                  name="business"
                  defaultChecked={project?.policy_json.business_required}
                />{" "}
                사업자 정보 필수
              </label>
              <label className="choice">
                <input
                  type="checkbox"
                  name="photo"
                  defaultChecked={project?.policy_json.photo_required ?? true}
                />{" "}
                상품 사진 필수
              </label>
              {field(
                "consentVersion",
                "동의 문구 버전",
                project?.policy_json.consent_version ?? "",
                "운영자가 승인한 문구의 버전을 입력해 주세요.",
                100,
              )}
              {area(
                "consent",
                "참가 동의 문구",
                project?.policy_json.consent_text,
                "운영자가 검토한 실제 문구를 입력해 주세요. 공개 전 필수입니다.",
                10000,
              )}
              <h2>심사 · 부스</h2>
              {area(
                "criteria",
                "심사 항목과 비중",
                project?.evaluation_policy_json.criteria
                  .map((c) => `${c.code}:${c.weight}`)
                  .join("\n"),
                "한 줄에 항목명:비중. 예: 상품 완성도:60 / 마켓 적합성:40 (각각 별도 줄). 합계 100.",
              )}
              {area(
                "booth",
                "부스 제공 조건",
                project?.booth_policy_json.description,
                "크기·제공 물품·전기 등 운영 조건. 공개 전 필수입니다.",
              )}
              {field(
                "reason",
                "저장 사유",
                "",
                "변경 이력에 기록됩니다.",
                2000,
              )}
              <Button
                type="submit"
                disabled={blocked}
                aria-busy={mutation.result?.state === "checking"}
              >
                {id ? "설정 저장" : "초안 만들기"}
              </Button>
            </fieldset>
          </form>
          {project && (
            <section className="market-section">
              <h2>운영 상태</h2>
              {dirty && (
                <Notice title="설정 변경을 먼저 저장해 주세요.">
                  저장 후 상태 변경과 운영 권한 배정을 할 수 있습니다.
                </Notice>
              )}
              {(transitions[project.status] ?? []).length > 0 ? (
                <form noValidate onSubmit={status}>
                  <fieldset disabled={mutation.locked || dirty}>
                    <legend>변경할 상태</legend>
                    {transitions[project.status].map((s) => (
                      <label className="choice" key={s}>
                        <input
                          type="radio"
                          name="status"
                          value={s}
                          disabled={immutable && s !== "COMPLETED"}
                        />
                        {statusLabels[s]}
                      </label>
                    ))}
                    {field(
                      "statusReason",
                      "상태 변경 사유",
                      "",
                      undefined,
                      2000,
                    )}
                    <Button type="submit" variant="secondary">
                      변경 내용 확인
                    </Button>
                  </fieldset>
                </form>
              ) : (
                <p>더 이상 변경할 수 있는 상태가 없습니다.</p>
              )}
            </section>
          )}
          {project && session.admin && (
            <section className="market-section">
              <h2>운영 권한</h2>
              <p className="muted">
                이메일 인증과 계정 생성을 마친 계정만 배정할 수 있습니다. 전체
                관리자 권한은 여기서 부여하지 않습니다.
              </p>
              {memberError ? (
                <Notice title="권한 목록을 불러오지 못했어요." tone="warning">
                  <Button
                    onClick={() =>
                      void readMembers(new AbortController().signal)
                    }
                  >
                    권한 목록 다시 확인
                  </Button>
                </Notice>
              ) : (
                <ul className="member-list">
                  {members.length ? (
                    members.map((m) => (
                      <li key={m.user_id}>
                        {m.email} · {roles[m.role]} ·{" "}
                        {m.active ? "활성" : "해제됨"}
                      </li>
                    ))
                  ) : (
                    <li>배정된 운영 스태프가 없습니다.</li>
                  )}
                </ul>
              )}
              <form noValidate onSubmit={member}>
                <fieldset disabled={blocked || dirty}>
                  <legend>권한 배정 또는 변경</legend>
                  <Field
                    id="email"
                    name="email"
                    type="email"
                    label="배정할 이메일"
                    error={fieldError("email")}
                    maxLength={255}
                  />
                  <fieldset>
                    <legend>역할</legend>
                    {Object.entries(roles).map(([value, label]) => (
                      <label className="choice" key={value}>
                        <input type="radio" name="role" value={value} />
                        {label}
                      </label>
                    ))}
                  </fieldset>
                  <fieldset>
                    <legend>배정 여부</legend>
                    <label className="choice">
                      <input
                        type="radio"
                        name="enabled"
                        value="yes"
                        defaultChecked
                      />
                      권한 부여·변경
                    </label>
                    <label className="choice">
                      <input type="radio" name="enabled" value="no" />
                      권한 해제
                    </label>
                  </fieldset>
                  {field("memberReason", "권한 변경 사유", "", undefined, 2000)}
                  <Button type="submit" variant="secondary">
                    권한 변경 확인
                  </Button>
                </fieldset>
              </form>
            </section>
          )}
        </>
      )}
      {intent && (
        <ConfirmDialog
          title={intent.title}
          confirm={intent.label}
          onCancel={() => setIntent(null)}
          onConfirm={() => {
            const i = intent;
            setIntent(null);
            mutation.start(i.operation, i.path, i.method, i.body);
          }}
        >
          <p>{intent.description}</p>
        </ConfirmDialog>
      )}
    </>
  );
}
export function MarketEditor({ id }: { id?: string }) {
  return (
    <MarketAccess>
      {(session) =>
        !id && !session.canCreate ? (
          <Notice title="새 마켓 생성 권한이 필요해요." tone="warning">
            관리자 또는 담당 마켓의 운영자만 생성할 수 있습니다.{" "}
            <ButtonLink href="/markets" variant="secondary">
              마켓 목록
            </ButtonLink>
          </Notice>
        ) : (
          <Editor key={id ?? "new"} session={session} id={id} />
        )
      }
    </MarketAccess>
  );
}
