import "./globals.css";
import type { Metadata, Viewport } from "next";
import { LangProvider } from "../lib/i18n";
import RegisterSW from "../components/RegisterSW";
import ViewportFix from "../components/ViewportFix";
import VpDebug from "../components/VpDebug";

export const metadata: Metadata = {
  title: "마크서버 웹 패널",
  description: "마인크래프트 서버 접속 현황 및 채팅 패널",
  manifest: "/manifest.webmanifest",
  applicationName: "마크서버 웹 패널",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "마크서버 웹 패널",
  },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/icon-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1014" },
  ],
  width: "device-width",
  initialScale: 1,
  // maximumScale을 강제하지 않는다 — 핀치 줌 차단은 저시력 사용자 접근성 위반(WCAG 1.4.4)
  viewportFit: "cover",
  // Android Chrome에서만 유효(키보드가 콘텐츠를 리사이즈). iOS WebKit은 이 속성을
  // 무시하므로 iOS 키보드 대응은 ViewportFix.tsx의 VisualViewport JS가 담당한다.
  interactiveWidget: "resizes-content",
};

// 페인트 전에 실행되어 테마 클래스를 설정한다(라이트/다크 깜빡임 방지).
const themeInit = `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <LangProvider>{children}</LangProvider>
        <ViewportFix />
        <RegisterSW />
        <VpDebug />
      </body>
    </html>
  );
}
