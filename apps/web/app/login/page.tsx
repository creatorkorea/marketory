import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";
export const metadata: Metadata = { title: "로그인" };
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const { returnTo } = await searchParams;
  return <main id="main" className="wrap auth-page" tabIndex={-1}>
    <LoginForm returnTo={typeof returnTo === "string" ? returnTo : undefined} />
    <aside className="auth-story" aria-label="마켓토리 소개">
      <p className="eyebrow">만드는 사람의 다음 이야기</p>
      <h2>당신의 정성이<br />새로운 만남으로.</h2>
      <p>작은 공방에서 시작한 이야기부터<br />마켓에서 만날 다음 이야기까지.</p>
      <div className="story-footnote"><span>MARKETORY</span><p>셀러의 이야기, 마켓에서 만나다</p></div>
    </aside>
    <details className="auth-mobile-story"><summary>마켓토리 소개</summary><p>작은 공방에서 시작한 이야기부터 마켓에서 만날 다음 이야기까지. 셀러의 정성과 새로운 만남을 연결합니다.</p></details>
  </main>;
}
