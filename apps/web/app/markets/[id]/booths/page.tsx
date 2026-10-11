import type { Metadata } from "next";
import { BoothBoard } from "@/components/booths/board";

export const metadata: Metadata = {
  title: "부스 배치",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main id="main" className="wrap account-page" tabIndex={-1}>
      <p className="eyebrow">마켓토리 운영</p>
      <h1>부스 배치</h1>
      <p className="intro">
        셀러의 운영 조건을 살펴보고, 초안을 검토한 뒤 자리를 확정해요.
      </p>
      <BoothBoard id={id} />
    </main>
  );
}
