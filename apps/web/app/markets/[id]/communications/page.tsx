import type { Metadata } from "next";
import { CommunicationsBoard } from "@/components/communications/board";
import { listQuery } from "@/lib/communications/form";
export const metadata: Metadata = {
  title: "셀러 안내",
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
      <h1>셀러 안내</h1>
      <p className="intro">
        셀러별 안내 내용을 검토하고 승인한 뒤, 별도로 발송을 요청해요.
      </p>
      <CommunicationsBoard id={id} query={listQuery(await searchParams)} />
    </main>
  );
}
