import type { Metadata } from "next";
import { MarketEditor } from "@/components/markets/editor";
export const metadata: Metadata = {
  title: "마켓 설정",
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
      <h1>마켓 설정</h1>
      <p className="intro">모집 기준과 운영 역할을 한곳에서 관리해요.</p>
      <MarketEditor id={id} />
    </main>
  );
}
