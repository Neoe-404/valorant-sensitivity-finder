import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "玩家设置 · VALORANT 灵敏度测试器",
  description: "输入你的鼠标 DPI 与当前游戏灵敏度，开始寻找最适合你的 VALORANT 灵敏度。",
};

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
