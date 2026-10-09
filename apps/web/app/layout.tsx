import type { Metadata } from "next";
import localFont from "next/font/local";
import { AppHeader } from "@/components/app-header";
import "./globals.css";

const pretendard = localFont({
  src: "../public/fonts/PretendardVariable.woff2", weight: "45 920", display: "swap",
  variable: "--font-pretendard", fallback: ["Malgun Gothic", "sans-serif"],
});
export const metadata: Metadata = {
  title: { default: "마켓토리", template: "%s | 마켓토리" },
  description: "셀러의 이야기와 마켓의 만남을 준비하는 공간",
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko" className={pretendard.variable}><body>
    <AppHeader />{children}
    <footer className="wrap footer">MARKETORY <span>작은 가게들이 만드는 다채로운 하루</span></footer>
  </body></html>;
}
