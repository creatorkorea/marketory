import { ButtonLink } from "@/components/ui/button";
import { RecruitingMarkets } from "@/components/seller/recruiting-markets";

export default function Home() {
  return <main id="main" className="wrap home" tabIndex={-1}>
    <p className="eyebrow">셀러의 이야기, 마켓에서 만나다</p>
    <h1>저마다의 이야기가<br />모이는 마켓.</h1>
    <p className="intro">정성껏 만든 상품과 새로운 만남.<br />내 가게와 어울리는 마켓을 찾아보세요.</p>
    <div className="actions"><ButtonLink href="#recruiting">모집 마켓 보기 <span aria-hidden="true">↓</span></ButtonLink></div>
    <RecruitingMarkets />
    <div className="story-line"><span>만드는 사람의 정성</span><span>발견하는 즐거움</span><span>함께하는 하루</span></div>
  </main>;
}
