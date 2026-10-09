import type { Metadata } from "next";
import { ReviewList } from "@/components/reviews/list";
import { reviewQuery } from "@/lib/reviews/form";
export const metadata: Metadata = {
  title: "신청 검토",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  return (
    <main id="main" className="wrap account-page" tabIndex={-1}>
      <p className="eyebrow">마켓토리 운영</p>
      <h1>셀러 신청 검토</h1>
      <p className="intro">
        신청 자료를 확인하고, 검토와 다음 안내를 준비해요.
      </p>
      <ReviewList id={id} query={reviewQuery(await searchParams)} />
    </main>
  );
}
