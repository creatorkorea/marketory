import type { Metadata } from "next";
import { SellerApplicationList } from "@/components/seller/list";
export const metadata: Metadata = {
  title: "내 신청",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string }>;
}) {
  const { offset } = await searchParams;
  const n = Number(offset ?? 0);
  return (
    <main id="main" className="wrap account-page" tabIndex={-1}>
      <p className="eyebrow">마켓토리 셀러</p>
      <h1>내 신청</h1>
      <p className="intro">작성 중인 초안과 접수한 신청을 확인해요.</p>
      <SellerApplicationList
        offset={
          Number.isSafeInteger(n) && n >= 0 && n <= 1000000
            ? Math.floor(n / 20) * 20
            : 0
        }
      />
    </main>
  );
}
