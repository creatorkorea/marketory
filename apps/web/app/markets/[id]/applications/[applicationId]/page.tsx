import type { Metadata } from "next";
import { ReviewDetail } from "@/components/reviews/detail";
import { reviewQuery } from "@/lib/reviews/form";
export const metadata: Metadata = {
  title: "신청 심사 상세",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; applicationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id, applicationId } = await params;
  return (
    <main id="main" className="wrap account-page" tabIndex={-1}>
      <p className="eyebrow">마켓토리 운영</p>
      <h1>신청 심사 상세</h1>
      <ReviewDetail
        id={id}
        applicationId={applicationId}
        query={reviewQuery(await searchParams)}
      />
    </main>
  );
}
