import { ButtonLink } from "@/components/ui/button";

export default function Home() {
  return <main id="main" className="wrap home" tabIndex={-1}>
    <p className="eyebrow">셀러의 이야기, 마켓에서 만나다</p>
    <h1>저마다의 이야기가<br />모이는 마켓.</h1>
    <p className="intro">정성껏 만든 상품과 새로운 만남.<br />마켓토리가 함께할 하루를 준비하고 있어요.</p>
    <section className="availability" aria-labelledby="availability-title">
      <div><span className="badge">서비스 준비 중</span><h2 id="availability-title">모집 소식은 준비 후 안내할게요.</h2>
        <p>현재는 신청을 받지 않습니다. 화면과 사용 경험을 먼저 살펴보세요.</p></div>
      <ButtonLink variant="secondary" href="/ui">UI 미리보기 <span aria-hidden="true">↗</span></ButtonLink>
    </section>
    <div className="story-line"><span>만드는 사람의 정성</span><span>발견하는 즐거움</span><span>함께하는 하루</span></div>
  </main>;
}
