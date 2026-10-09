"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import { useMarketMutation } from "@/lib/markets/use-mutation";
import {
  validateFiles,
  trustedUploadUrl,
  type Application,
  type UploadPolicy,
} from "@/lib/seller/form";
import type { SellerSession } from "./access";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { RequestStatus } from "@/components/requests/request-status";
import { SellerFileLink } from "./file-link";
type Intent = {
  upload_intent_id: string;
  application_version: number;
  revision_no: number;
};
type Issue = Intent & { upload_url: string };
export function SellerUploads({
  session,
  app,
  disabled,
  onBusy,
  onRefresh,
}: {
  session: SellerSession;
  app: Application;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onRefresh: () => Promise<void>;
}) {
  const [policy, setPolicy] = useState<UploadPolicy | null>(null),
    [error, setError] = useState(""),
    [intent, setIntent] = useState<Intent | null>(null),
    [phase, setPhase] = useState(""),
    [progress, setProgress] = useState(0),
    [working, setWorking] = useState(false),
    [storageBlocked, setStorageBlocked] = useState(false);
  const name = `marketory:upload:${session.actor}:${app.application_id}`,
    live = useRef(true),
    active = useRef<XMLHttpRequest | null>(null),
    running = useRef(false);
  const keep = useCallback(
    (i: Intent | null) => {
      try {
        if (i) sessionStorage.setItem(name, JSON.stringify(i));
        else sessionStorage.removeItem(name);
      } catch {
        setStorageBlocked(true);
      }
      setIntent(i);
    },
    [name],
  );
  const mutation = useMarketMutation(
    session,
    `uploads:${app.application_id}`,
    (data) => {
      if (typeof data.upload_intent_id === "string") {
        const i = data as Issue;
        keep({
          upload_intent_id: i.upload_intent_id,
          application_version: i.application_version,
          revision_no: i.revision_no,
        });
      } else {
        keep(null);
        void onRefresh();
      }
    },
  );
  useEffect(() => {
    live.current = true;
    const c = new AbortController();
    try {
      const saved = sessionStorage.getItem(name);
      if (saved) setIntent(JSON.parse(saved) as Intent);
    } catch {
      setStorageBlocked(true);
      setError(
        "미완료 파일 정보를 읽을 수 없습니다. 사이트 저장을 확인해 주세요.",
      );
    }
    void fetch("/api/backend/attachments/policy", {
      signal: c.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const body = await r.json();
        if (!c.signal.aborted) setPolicy(body.data);
      })
      .catch(() => {
        if (!c.signal.aborted)
          setError(
            "파일 정책을 불러오지 못했습니다. 새로고침 후 다시 확인해 주세요.",
          );
      });
    return () => {
      live.current = false;
      c.abort();
      active.current?.abort();
    };
  }, [name]);
  const pendingFiles = app.pending_uploads ?? [];
  const locked =
    working ||
    !!intent ||
    pendingFiles.length > 0 ||
    mutation.locked ||
    storageBlocked;
  useEffect(() => {
    onBusy(locked);
    return () => onBusy(false);
  }, [locked, onBusy]);
  async function put(url: string, file: File) {
    const auth = await session.client.auth.getSession();
    if (!auth.data.session || auth.data.session.user.id !== session.actor)
      throw new Error(
        "같은 계정으로 다시 로그인한 뒤 미완료 파일을 해제해 주세요.",
      );
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      active.current = xhr;
      xhr.open("PUT", url);
      xhr.timeout = 120000;
      xhr.setRequestHeader(
        "Authorization",
        `Bearer ${auth.data.session!.access_token}`,
      );
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.upload.onprogress = (e) => {
        if (live.current && e.lengthComputable)
          setProgress(Math.floor((e.loaded / e.total) * 100));
      };
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(
              new Error(
                xhr.status === 401
                  ? "로그인이 만료되었습니다. 미완료 파일을 해제한 뒤 다시 선택해 주세요."
                  : "파일 전송을 확인하지 못했습니다. 미완료 파일을 해제한 뒤 다시 선택해 주세요.",
              ),
            );
      xhr.onerror = xhr.ontimeout = () =>
        reject(
          new Error(
            "파일 전송 결과를 확인하지 못했습니다. 미완료 파일을 해제한 뒤 다시 선택해 주세요.",
          ),
        );
      xhr.onabort = () => reject(new Error("파일 전송이 중단되었습니다."));
      xhr.send(file);
    });
  }
  async function upload(
    files: File[],
    field: "product_images" | "business_document",
  ) {
    if (disabled || locked || running.current || !policy) return;
    try {
      validateFiles(
        files,
        field,
        policy,
        app.attachments.filter(
          (a) =>
            a.file_type === field ||
            a.file_type ===
              (field === "product_images" ? "PRODUCT_IMAGE" : "BUSINESS_DOC"),
        ).length,
      );
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    running.current = true;
    setWorking(true);
    setError("");
    let version = app.version,
      revision = app.revision_no;
    try {
      for (const file of files) {
        if (!live.current) break;
        setPhase(`${file.name} · 업로드 준비`);
        setProgress(0);
        const issued = await mutation.start(
          "attachments.issue",
          "attachments/upload-url",
          "POST",
          {
            application_id: app.application_id,
            field_code: field,
            original_name: file.name,
            mime_type: file.type,
            size_bytes: file.size,
            expected_version: version,
            expected_revision_no: revision,
          },
        );
        if (issued?.state !== "succeeded") break;
        const data = issued.body!.data as Issue;
        setPhase(`${file.name} · 전송 중`);
        await put(
          trustedUploadUrl(data.upload_url, policy.upload_origin),
          file,
        );
        if (!live.current) break;
        setPhase(`${file.name} · 신청에 연결 중`);
        // React's pending state from issue has settled before binary transfer completes.
        const completed = await mutation.start(
          "attachments.complete",
          "attachments/complete",
          "POST",
          {
            upload_intent_id: data.upload_intent_id,
            expected_version: data.application_version,
            expected_revision_no: data.revision_no,
          },
        );
        if (completed?.state !== "succeeded") break;
        const result = completed.body!.data as {
          application_version: number;
          revision_no: number;
        };
        version = result.application_version;
        revision = result.revision_no;
        await onRefresh();
      }
    } catch (e) {
      if (live.current) setError((e as Error).message);
    } finally {
      running.current = false;
      if (live.current) {
        setWorking(false);
        setPhase("");
      }
    }
  }
  async function abandon(id: string) {
    if (mutation.locked || working) return;
    setError("");
    await mutation.start(
      "attachments.abandon",
      `attachments/uploads/${id}/abandon`,
      "POST",
      { expected_version: app.version },
    );
  }
  async function detach(id: string) {
    if (disabled || locked) return;
    await mutation.start(
      "attachments.detach",
      `attachments/${id}/detach`,
      "POST",
      { expected_version: app.version, reason: "셀러가 신청 첨부 파일 해제" },
    );
  }
  return (
    <section className="seller-uploads">
      <h3>사진과 증빙</h3>
      <p className="muted">
        한 파일씩 전송하고 신청에 연결합니다. 변경한 상품 정보를 먼저 저장해
        주세요.
      </p>
      {policy && (
        <p className="hint">
          파일당 최대 {policy.max_size_bytes / 1048576} MiB · 상품 사진 최대{" "}
          {policy.max_product_images}개 (JPG/PNG/WebP) · 사업자 증빙 최대{" "}
          {policy.max_business_documents}개 (PDF/이미지)
        </p>
      )}
      {error && <Notice title={error} tone="warning" />}
      {working && (
        <div role="status">
          <p>{phase}</p>
          <progress max={100} value={progress} aria-label="파일 전송률" />
          <p>{progress}% · 전송 완료 후 신청 연결을 확인합니다.</p>
        </div>
      )}
      {mutation.result && mutation.result.state !== "succeeded" && (
        <RequestStatus
          business
          subject="파일"
          result={mutation.result}
          onRetry={mutation.retry}
          onCurrent={() => void onRefresh()}
        />
      )}{" "}
      {intent && !working && (
        <Notice title="미완료 파일이 남아 있어요." tone="warning">
          새 파일과 제출을 시작하기 전에 기존 요청 결과를 확인하거나 미완료
          선택을 해제해 주세요. 원본 파일은 자동 삭제하지 않습니다.
          <div className="actions">
            <Button
              variant="secondary"
              disabled={mutation.locked}
              onClick={() => void abandon(intent.upload_intent_id)}
            >
              미완료 선택 해제
            </Button>
          </div>
        </Notice>
      )}
      {pendingFiles
        .filter((p) => p.upload_intent_id !== intent?.upload_intent_id)
        .map((p) => (
          <Notice
            key={p.upload_intent_id}
            title={`${p.original_name} · 미완료 업로드`}
            tone="warning"
          >
            서버에 미완료 선택이 남아 있습니다. 선택을 해제한 뒤 다시 파일을
            골라 주세요.
            <div className="actions">
              <Button
                variant="secondary"
                disabled={mutation.locked || working}
                onClick={() => void abandon(p.upload_intent_id)}
              >
                미완료 선택 해제
              </Button>
            </div>
          </Notice>
        ))}
      <ul className="seller-files">
        {app.attachments.map((a) => (
          <li key={a.attachment_id}>
            <span>
              {a.original_name}
              <small>
                {a.mime_type} · {(a.size_bytes / 1024).toLocaleString("ko-KR")}{" "}
                KB · 연결 완료
              </small>
            </span>
            <Button
              variant="secondary"
              disabled={
                disabled ||
                locked ||
                !app.allowed_actions.includes("detach") ||
                (app.status === "NEED_INFO" &&
                  !app.info_requests_json?.some(
                    (r) =>
                      r.field ===
                      (a.file_type === "PRODUCT_IMAGE"
                        ? "product_images"
                        : "business_document"),
                  ))
              }
              onClick={() => void detach(a.attachment_id)}
            >
              해제
            </Button>
            <SellerFileLink session={session} file={a} />
          </li>
        ))}
      </ul>
      {(["product_images", "business_document"] as const).map((field) => (
        <div className="field" key={field}>
          <label htmlFor={field}>
            {field === "product_images" ? "상품 사진 선택" : "사업자 증빙 선택"}
          </label>
          <input
            className="input"
            id={field}
            type="file"
            multiple={field === "product_images"}
            accept={(field === "product_images"
              ? policy?.product_image_mime_types
              : policy?.business_document_mime_types
            )?.join(",")}
            disabled={
              disabled ||
              locked ||
              !policy ||
              !app.allowed_actions.includes("upload") ||
              (app.status === "NEED_INFO" &&
                !app.info_requests_json?.some((r) => r.field === field))
            }
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length) void upload(files, field);
            }}
          />
        </div>
      ))}
    </section>
  );
}
