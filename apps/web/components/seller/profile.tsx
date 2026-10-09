"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { SellerAccess, type SellerSession } from "./access";
import {
  profilePayload,
  FormError,
  internalReturn,
  type Seller,
} from "@/lib/seller/form";
import { api } from "@/lib/api/client";
import { useMarketMutation } from "@/lib/markets/use-mutation";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { TextareaField } from "@/components/ui/textarea-field";
import { Notice } from "@/components/ui/notice";
import { UnsavedGuard } from "@/components/ui/unsaved-guard";
import { Toast } from "@/components/ui/toast";
import { RequestStatus } from "@/components/requests/request-status";
function Editor({
  session,
  returnTo,
}: {
  session: SellerSession;
  returnTo?: string;
}) {
  const router = useRouter(),
    form = useRef<HTMLFormElement>(null);
  const [seller, setSeller] = useState<Seller | null>(null),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState<FormError | null>(null),
    [loadError, setLoadError] = useState(""),
    [dirty, setDirty] = useState(false),
    [toast, setToast] = useState(""),
    [key, setKey] = useState(0),
    [latest, setLatest] = useState<Seller | null | undefined>(undefined);
  const active = useRef<AbortController | null>(null);
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
          "me/seller",
          c.signal,
        );
        if (c.signal.aborted) return;
        if (r.status !== 200) {
          setLoadError(
            r.status === 401
              ? "로그인이 만료되었습니다. 같은 계정으로 다시 로그인해 주세요."
              : "프로필을 불러오지 못했습니다.",
          );
          return;
        }
        const value = r.body.data as Seller | null;
        if (compare) setLatest(value);
        else {
          setSeller(value);
          setLoaded(true);
        }
      } catch {
        if (!c.signal.aborted) setLoadError("프로필을 불러오지 못했습니다.");
      }
    },
    [session],
  );
  useEffect(() => {
    void read();
    return () => active.current?.abort();
  }, [read]);
  const mutation = useMarketMutation(session, "seller-profile", (data) => {
    setSeller(data as Seller);
    setDirty(false);
    setError(null);
    setLatest(undefined);
    setKey((v) => v + 1);
    setToast("셀러 프로필을 저장했어요.");
    if (returnTo) router.push(returnTo);
  });
  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (mutation.locked) return;
    try {
      const body = profilePayload(new FormData(e.currentTarget));
      setError(null);
      mutation.start("sellers.save", "me/seller", seller ? "PATCH" : "POST", {
        ...body,
        expected_version: seller?.version ?? 0,
      });
    } catch (err) {
      if (err instanceof FormError) {
        setError(err);
        form.current
          ?.querySelector<HTMLElement>(`[name="${err.field}"]`)
          ?.focus();
      }
    }
  };
  const field = (name: keyof Seller, label: string, hint?: string) => (
    <Field
      key={name}
      id={name}
      name={name}
      label={label}
      defaultValue={String(seller?.[name] ?? "")}
      hint={hint}
      error={error?.field === name ? error.message : undefined}
    />
  );
  return (
    <>
      <UnsavedGuard active={dirty || !!mutation.pending} />
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
      <ButtonLink variant="secondary" href={returnTo ?? "/account"}>
        {returnTo ? "마켓 신청으로" : "내 계정으로"}
      </ButtonLink>
      {loadError && (
        <Notice tone="warning" title={loadError}>
          <Button onClick={() => void read(loaded)}>다시 확인</Button>
        </Notice>
      )}
      {!loaded && !loadError && <Notice title="프로필을 불러오고 있어요." />}
      {mutation.result && (
        <RequestStatus
          business
          subject="셀러 프로필"
          result={mutation.result}
          onRetry={mutation.retry}
          onCurrent={() => void read(true)}
        />
      )}{" "}
      {mutation.storageError && (
        <Notice title="요청 복구 정보를 보관할 수 없어요." tone="warning">
          사이트 저장을 허용한 뒤 새로고침해 주세요.
        </Notice>
      )}
      {latest !== undefined && (
        <Notice title="최신 프로필을 확인했어요." tone="warning">
          {latest
            ? `${latest.shop_name} · ${latest.owner_name} · ${latest.phone}`
            : "아직 저장된 프로필이 없습니다."}
          <p>
            현재 입력을 유지한 채 새 버전으로 저장하거나 최신 프로필을 불러올 수
            있습니다.
          </p>
          <div className="actions">
            <Button
              variant="secondary"
              onClick={() => {
                setSeller(latest);
                setLatest(undefined);
                setKey((v) => v + 1);
                setDirty(false);
                mutation.clear();
              }}
            >
              최신 내용 불러오기
            </Button>
            <Button
              onClick={() => {
                setSeller((previous) => ({ ...previous, ...latest }) as Seller);
                setLatest(undefined);
                mutation.clear();
              }}
            >
              입력 유지하고 최신 버전 사용
            </Button>
          </div>
        </Notice>
      )}
      {loaded && (
        <form
          ref={form}
          key={key}
          className="seller-form"
          noValidate
          onSubmit={save}
          onChange={() => setDirty(true)}
        >
          <fieldset disabled={mutation.locked || latest !== undefined}>
            <legend>기본 셀러 정보</legend>
            {field("name", "이름 (필수)")}
            {field("shop_name", "상호 (필수)")}
            {field("owner_name", "대표자 (필수)")}
            {field(
              "phone",
              "연락처 (필수)",
              "운영 안내를 받을 수 있는 전화번호",
            )}
            {field(
              "business_no",
              "사업자번호",
              "사업자가 있다면 10자리를 입력해 주세요.",
            )}
            {field("sns_url", "SNS 또는 홈페이지", "http 또는 https 주소")}
            {field("base_category", "기본 카테고리")}
            <TextareaField
              id="base_product_desc"
              name="base_product_desc"
              label="기본 상품 소개"
              defaultValue={seller?.base_product_desc ?? ""}
              error={
                error?.field === "base_product_desc" ? error.message : undefined
              }
            />
            <p className="muted">
              프로필 변경은 다음 신청의 기본값에 반영됩니다. 이미 제출한 신청의
              정보는 바뀌지 않습니다.
            </p>
            <Button
              type="submit"
              aria-busy={mutation.result?.state === "checking"}
            >
              프로필 저장{returnTo ? " 후 신청하기" : ""}
            </Button>
          </fieldset>
        </form>
      )}
    </>
  );
}
export function SellerProfile({ returnTo }: { returnTo?: string }) {
  const safe = internalReturn(returnTo);
  return (
    <SellerAccess>
      {(session) => <Editor session={session} returnTo={safe} />}
    </SellerAccess>
  );
}
