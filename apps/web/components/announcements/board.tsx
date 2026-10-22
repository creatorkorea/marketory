"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MarketAccess, type MarketSession } from "@/components/markets/access";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { TextareaField } from "@/components/ui/textarea-field";
import { Notice } from "@/components/ui/notice";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { UnsavedGuard } from "@/components/ui/unsaved-guard";
import { Toast } from "@/components/ui/toast";
import { RequestStatus } from "@/components/requests/request-status";
import { api } from "@/lib/api/client";
import { useMarketMutation } from "@/lib/markets/use-mutation";
import {
  announcementPayload,
  audienceLabels,
  type Announcement,
  type Audience,
} from "@/lib/announcements/form";
import { kstDisplay } from "@/lib/seller/form";
const labels = {
  approve: "내용 승인",
  publish: "셀러에게 게시",
  unpublish: "게시 내리기",
};
function Board({ id, session }: { id: string; session: MarketSession }) {
  const [items, setItems] = useState<Announcement[]>([]),
    [total, setTotal] = useState(0),
    [offset, setOffset] = useState(0),
    [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<Announcement | null>(null),
    [subject, setSubject] = useState(""),
    [body, setBody] = useState(""),
    [audience, setAudience] = useState<Audience>("CONFIRMED"),
    [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(""),
    [error, setError] = useState(""),
    [toast, setToast] = useState("");
  const [decision, setDecision] = useState<keyof typeof labels | null>(null),
    [switchTo, setSwitchTo] = useState<{ value: Announcement | null } | null>(
      null,
    );
  const latestController = useRef<AbortController | null>(null);
  useEffect(() => () => latestController.current?.abort(), []);
  const [latest, setLatest] = useState<Announcement | null>(null);
  const accept = useCallback((v: Announcement | null) => {
    latestController.current?.abort();
    setLatest(null);
    setSelected(v);
    setSubject(v?.subject ?? "");
    setBody(v?.body ?? "");
    setAudience(v?.audience ?? "CONFIRMED");
    setReason("");
    setError("");
  }, []);
  const mutation = useMarketMutation(session, `announcements:${id}`, (v) => {
    accept(v as unknown as Announcement);
    setDecision(null);
    setToast("안내를 저장했어요.");
    setRefresh((v) => v + 1);
  });
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    setItems([]);
    void api(
      session.client,
      session.actor,
      `projects/${id}/announcements?limit=20&offset=${offset}`,
      controller.signal,
    )
      .then((r) => {
        if (controller.signal.aborted) return;
        if (r.status !== 200) {
          setLoadError(
            r.status === 403 || r.status === 404
              ? "이 마켓의 안내를 조회할 수 없습니다."
              : "안내를 불러오지 못했어요. 다시 불러와 주세요.",
          );
          return;
        }
        const data = r.body.data as { items: Announcement[]; total: number };
        setItems(data.items);
        setTotal(data.total);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setLoadError("안내를 불러오지 못했어요. 다시 불러와 주세요.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, session.client, session.actor, offset, refresh]);
  const changed =
    subject !== (selected?.subject ?? "") ||
    body !== (selected?.body ?? "") ||
    audience !== (selected?.audience ?? "CONFIRMED");
  const dirty = changed || !!reason;
  const loadLatest = async () => {
    if (!selected) {
      setRefresh((v) => v + 1);
      return;
    }
    latestController.current?.abort();
    const controller = new AbortController();
    latestController.current = controller;
    try {
      const r = await api(
        session.client,
        session.actor,
        `announcements/${selected.announcement_id}`,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (r.status === 200) setLatest(r.body.data as Announcement);
      else {
        setLatest(null);
        setLoadError(
          "최신 안내를 조회할 수 없습니다. 권한과 연결 상태를 확인해 주세요.",
        );
      }
    } catch {
      if (!controller.signal.aborted)
        setLoadError("최신 안내를 불러오지 못했어요. 다시 시도해 주세요.");
    }
  };
  const choose = (v: Announcement | null) => {
    if (dirty) setSwitchTo({ value: v });
    else accept(v);
  };
  const run = (action: "create" | "revise" | keyof typeof labels) => {
    try {
      const input = announcementPayload(
        subject,
        body,
        audience,
        reason,
        selected?.version,
      );
      const payload =
        action === "create" || action === "revise"
          ? input
          : {
              reason: input.reason,
              expected_version: selected!.version,
              ...(action === "unpublish"
                ? {}
                : { content_version: selected!.content_version }),
            };
      setError("");
      setDecision(null);
      void mutation.start(
        `announcements.${action}`,
        action === "create"
          ? `projects/${id}/announcements`
          : `announcements/${selected!.announcement_id}/${action}`,
        "POST",
        payload,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section className="communications-board">
      <UnsavedGuard active={dirty && !mutation.locked} />
      <div className="actions">
        <ButtonLink href={`/markets/${id}/communications`} variant="secondary">
          개별 안내로 이동
        </ButtonLink>
        <Button
          disabled={mutation.locked || loading}
          onClick={() => choose(null)}
        >
          새 공통 안내
        </Button>
        <Button
          variant="secondary"
          disabled={loading || mutation.locked}
          onClick={() => setRefresh((v) => v + 1)}
        >
          목록 새로고침
        </Button>
      </div>
      {loading && <Notice title="공통 안내를 불러오고 있어요." />}
      {loadError && <Notice title={loadError} tone="warning" />}
      {mutation.result && (
        <RequestStatus
          result={mutation.result}
          business
          onRetry={mutation.retry}
          onCurrent={() => void loadLatest()}
        />
      )}
      {latest && (
        <Notice title="최신 내용을 확인해 주세요.">
          <p className="seller-prose">
            {latest.subject} · {latest.content_version}판
          </p>
          <p className="seller-prose">{latest.body}</p>
          <Button
            onClick={() => {
              setSelected(latest);
              setLatest(null);
              mutation.clear();
            }}
          >
            입력은 유지하고 최신 버전으로 다시 검토
          </Button>
        </Notice>
      )}
      {mutation.storageError && (
        <Notice title="요청을 보관할 수 없어 저장을 멈췄어요." tone="warning" />
      )}
      {!loadError && (
        <div className="communications-layout">
          <aside className="communications-history" aria-label="공통 안내 목록">
            <h2>공통 안내 목록</h2>
            {!loading && !items.length && (
              <p>아직 공통 안내가 없어요. 첫 초안을 작성해 주세요.</p>
            )}
            {items.map((item) => (
              <Button
                key={item.announcement_id}
                variant="secondary"
                disabled={mutation.locked}
                onClick={() => choose(item)}
              >
                {item.subject}
              </Button>
            ))}
            <nav className="actions" aria-label="공통 안내 페이지">
              <Button
                disabled={loading || mutation.locked || offset === 0}
                onClick={() => {
                  setOffset((v) => Math.max(0, v - 20));
                }}
              >
                이전
              </Button>
              <span>{offset / 20 + 1}페이지</span>
              <Button
                disabled={loading || mutation.locked || offset + 20 >= total}
                onClick={() => setOffset((v) => v + 20)}
              >
                다음
              </Button>
            </nav>
          </aside>
          <div className="market-section">
            <h2>{selected ? "공통 안내 편집" : "새 공통 안내"}</h2>
            <fieldset disabled={mutation.locked || loading}>
              <Field
                id="announcement-subject"
                label="제목"
                value={subject}
                maxLength={200}
                onChange={(e) => setSubject(e.target.value)}
              />
              <TextareaField
                id="announcement-body"
                label="본문"
                value={body}
                maxLength={50000}
                onChange={(e) => setBody(e.target.value)}
              />
              <div className="field">
                <label htmlFor="announcement-audience">공개 대상</label>
                <select
                  id="announcement-audience"
                  className="input"
                  aria-describedby="announcement-audience-help"
                  value={audience}
                  onChange={(e) => setAudience(e.target.value as Audience)}
                >
                  <option value="CONFIRMED">참가확정자</option>
                  <option value="ALL_APPLICANTS">전체 신청자</option>
                </select>
              </div>
              <p className="hint" id="announcement-audience-help">
                {audience === "ALL_APPLICANTS"
                  ? "접수한 전체 신청자에게 공개합니다. 대기자·미선정자도 포함됩니다."
                  : "현재 참가확정 상태인 셀러에게만 공개합니다."}
              </p>
              <Field
                id="announcement-reason"
                label="처리 사유"
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
              />
              {error && <Notice title={error} tone="warning" />}
              <div className="actions">
                {(!selected || selected.allowed_actions.includes("revise")) && (
                  <Button onClick={() => run(selected ? "revise" : "create")}>
                    {selected ? "초안 저장" : "초안 만들기"}
                  </Button>
                )}
                {selected &&
                  Object.entries(labels)
                    .filter(([key]) => selected.allowed_actions.includes(key))
                    .map(([key, label]) => (
                      <Button
                        key={key}
                        variant="secondary"
                        disabled={changed || !reason.trim()}
                        onClick={() => setDecision(key as keyof typeof labels)}
                      >
                        {label}
                      </Button>
                    ))}
              </div>
              {changed && selected && (
                <p className="hint">
                  변경한 초안을 저장한 뒤 승인·게시해 주세요. 기존 게시본은
                  유지됩니다.
                </p>
              )}
            </fieldset>
            {selected && (
              <p className="muted">
                초안 {selected.content_version}판 ·{" "}
                {selected.approved_version === selected.content_version
                  ? "승인 완료"
                  : "승인 필요"}
              </p>
            )}
            {selected?.publication && (
              <section className="seller-notice">
                <h3>
                  {selected.publication.withdrawn_at
                    ? "게시 내림"
                    : "현재 게시본"}
                </h3>
                <p>
                  {audienceLabels[selected.publication.audience]} ·{" "}
                  {kstDisplay(selected.publication.published_at)} (KST)
                </p>
                <h4 className="seller-prose">{selected.publication.subject}</h4>
                <p className="seller-prose">{selected.publication.body}</p>
              </section>
            )}
          </div>
        </div>
      )}
      {decision && (
        <ConfirmDialog
          title={labels[decision]}
          confirm={labels[decision]}
          onCancel={() => setDecision(null)}
          onConfirm={() => run(decision)}
        >
          <p>
            대상:{" "}
            {
              audienceLabels[
                decision === "unpublish"
                  ? selected!.publication!.audience
                  : audience
              ]
            }
          </p>
          <p>
            {decision === "unpublish"
              ? selected!.publication!.content_version
              : selected!.content_version}
            판 · {selected!.subject}
          </p>
          <p>
            {decision === "unpublish"
              ? "셀러 화면에서 이 게시본을 숨깁니다."
              : "저장된 제목과 본문을 확인해 주세요. 게시 시 셀러 화면에 표시됩니다."}
          </p>
          <p>이메일은 발송하지 않습니다.</p>
        </ConfirmDialog>
      )}
      {switchTo && (
        <ConfirmDialog
          title="저장하지 않은 내용을 버릴까요?"
          confirm="변경 버리기"
          onCancel={() => setSwitchTo(null)}
          onConfirm={() => {
            accept(switchTo.value);
            setSwitchTo(null);
          }}
        >
          <p>작성 중인 내용과 처리 사유가 사라집니다.</p>
        </ConfirmDialog>
      )}
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
    </section>
  );
}
export function AnnouncementsBoard({ id }: { id: string }) {
  return (
    <MarketAccess>
      {(session) => <Board id={id} session={session} />}
    </MarketAccess>
  );
}
