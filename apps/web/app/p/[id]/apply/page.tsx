import type { Metadata } from "next";
import { SellerApplication } from "@/components/seller/application";
export const metadata: Metadata = {
  title: "마켓 신청",
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
      <h1>마켓 신청</h1>
      <p className="intro">저장된 초안에서 이어서 준비할 수 있어요.</p>
      <SellerApplication projectId={id} />
    </main>
  );
}
