import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "판단구조 실행 데모",
  description: "판단구조를 명시하고 Rule · Code · LLM으로 판단을 나누어 실행하는 최소 데모",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        {children}
        {/* Cookieless page-view counts on Vercel (not active in development). */}
        <Analytics />
      </body>
    </html>
  );
}
