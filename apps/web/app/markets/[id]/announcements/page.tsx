import { AnnouncementsBoard } from "@/components/announcements/board";
export const metadata = {
  title: "마켓 공통 안내",
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
      <h1>마켓 공통 안내</h1>
      <p className="intro">
        공통 안내를 작성하고 승인한 뒤, 선택한 셀러에게 게시해요.
      </p>
      <AnnouncementsBoard id={id} />
    </main>
  );
}
