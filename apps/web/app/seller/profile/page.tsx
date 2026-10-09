import type { Metadata } from "next";
import { SellerProfile } from "@/components/seller/profile";
export const metadata: Metadata = {
  title: "셀러 프로필",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;
  return (
    <main id="main" className="wrap account-page" tabIndex={-1}>
      <p className="eyebrow">마켓토리 셀러</p>
      <h1>셀러 프로필</h1>
      <p className="intro">다음 만남에 소개할 가게와 상품을 준비해요.</p>
      <SellerProfile returnTo={returnTo} />
    </main>
  );
}
