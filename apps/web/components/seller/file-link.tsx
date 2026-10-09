"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import type { SellerSession } from "./access";
import type { Attachment } from "@/lib/seller/form";
import { Button } from "@/components/ui/button";
export function SellerFileLink({
  session,
  file,
}: {
  session: SellerSession;
  file: Attachment;
}) {
  const [url, setUrl] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function load() {
    if (busy) return;
    const c = new AbortController();
    active.current = c;
    setBusy(true);
    setError("");
    try {
      const r = await api(
        session.client,
        session.actor,
        `attachments/${file.attachment_id}/download`,
        c.signal,
      );
      if (c.signal.aborted) return;
      if (r.status !== 200)
        throw new Error(
          r.status === 401
            ? "다시 로그인해 주세요."
            : "파일 접근 권한과 연결 상태를 확인해 주세요.",
        );
      setUrl((r.body.data as { url: string }).url);
    } catch (e) {
      if (!c.signal.aborted) setError((e as Error).message);
    } finally {
      if (!c.signal.aborted) setBusy(false);
    }
  }
  return (
    <div className="seller-file-link">
      {url ? (
        <>
          <a
            className="text-button"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {file.original_name} 원본 열기 (새 탭)
          </a>
          {file.mime_type.startsWith("image/") && (
            <img
              className="seller-thumbnail"
              src={url}
              alt={`${file.original_name} 상품 사진`}
              onError={() => {
                setUrl("");
                setError(
                  "파일 링크가 만료되었거나 불러오지 못했습니다. 다시 확인해 주세요.",
                );
              }}
            />
          )}
        </>
      ) : (
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          aria-busy={busy}
          onClick={() => void load()}
        >
          파일 확인
        </Button>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
