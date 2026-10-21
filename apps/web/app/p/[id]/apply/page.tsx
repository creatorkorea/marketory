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
    <main id="main" className="wrap account-page seller-application-page" tabIndex={-1}>
      <h1>마켓 신청</h1>
      <SellerApplication projectId={id} />
    </main>
  );
}
