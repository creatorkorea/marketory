import type { Metadata } from "next";
import { AccountPanel } from "@/components/auth/account-panel";
export const metadata: Metadata = { title: "내 계정", robots: { index: false, follow: false } };
export default function AccountPage() {
  return <main id="main" className="wrap account-page" tabIndex={-1}>
    <p className="eyebrow">나의 마켓토리</p><h1>내 계정</h1>
    <p className="intro">마켓에서 이어갈 이야기를 준비하는 곳.</p><AccountPanel />
  </main>;
}
