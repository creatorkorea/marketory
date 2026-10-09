import type { Metadata } from "next";
import { MarketList } from "@/components/markets/list";
export const metadata: Metadata = {
  title: "마켓 관리",
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
      <p className="eyebrow">마켓토리 운영</p>
      <h1>마켓을 준비하는 곳</h1>
      <p className="intro">모집부터 운영까지, 마켓의 기준을 함께 정해요.</p>
      <MarketList
        offset={
          Number.isSafeInteger(n) && n >= 0 && n <= 1000000
            ? Math.floor(n / 20) * 20
            : 0
        }
      />
    </main>
  );
}
