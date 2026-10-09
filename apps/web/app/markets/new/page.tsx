import type { Metadata } from "next";
import { MarketEditor } from "@/components/markets/editor";
export const metadata: Metadata = {
  title: "새 마켓 만들기",
  robots: { index: false, follow: false },
};
export default function Page() {
  return (
    <main id="main" className="wrap account-page" tabIndex={-1}>
      <p className="eyebrow">마켓토리 운영</p>
      <h1>새 마켓 만들기</h1>
      <p className="intro">좋은 만남을 위한 기준부터, 차근차근.</p>
      <MarketEditor />
    </main>
  );
}
