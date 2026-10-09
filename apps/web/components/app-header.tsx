import Image from "next/image";
import Link from "next/link";

export function AppHeader() {
  return <>
    <a className="skip-link" href="#main">본문으로 이동</a>
    <div className="canopy" aria-hidden="true" />
    <header className="app-header wrap">
      <Link className="brand" href="/" aria-label="마켓토리 홈">
        <Image src="/brand/marketory-stall.png" width={56} height={56} alt="" priority />
        <span>마켓토리</span>
      </Link>
      <nav aria-label="주 메뉴"><Link href="/markets">마켓 관리</Link><Link href="/account">내 계정</Link></nav>
    </header>
  </>;
}
