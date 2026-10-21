import type { Metadata } from "next";
import { SellerApplication } from "@/components/seller/application";
export const metadata: Metadata = {
  title: "신청 상세",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ offset?: string }>;
}) {
  const { id } = await params;
  const { offset } = await searchParams;
  const n = Number(offset ?? 0);
  return (
    <main id="main" className="wrap account-page seller-application-page" tabIndex={-1}>
      <h1>신청 상세</h1>
      <SellerApplication
        id={id}
        listOffset={
          Number.isSafeInteger(n) && n >= 0 && n <= 1000000
            ? Math.floor(n / 20) * 20
            : 0
        }
      />
    </main>
  );
}
