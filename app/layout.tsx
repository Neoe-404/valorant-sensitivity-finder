import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/layout/Navbar";

export const metadata: Metadata = {
  title: "Valorant Sensitivity Finder · 无畏契约灵敏度测试器",
  description:
    "通过你自己的鼠标测试数据寻找最适合你的 VALORANT 灵敏度 — 不是复制职业选手参数。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <Navbar />
        {children}
      </body>
    </html>
  );
}
