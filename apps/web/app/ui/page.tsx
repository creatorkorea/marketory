import type { Metadata } from "next";
import { ComponentPreview } from "./preview";
export const metadata: Metadata = { title: "UI 미리보기" };
export default function UIPage() {
  return <main id="main" className="wrap preview-page" tabIndex={-1}>
    <p className="eyebrow">마켓토리 디자인 시스템</p><h1>작은 요소까지, 한결같게.</h1>
    <p className="intro">버튼과 입력창의 사용 경험을 확인하는 견본입니다.<br />입력한 내용은 저장하거나 전송하지 않습니다.</p>
    <ComponentPreview />
  </main>;
}
