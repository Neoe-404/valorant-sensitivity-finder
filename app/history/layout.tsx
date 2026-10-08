import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "测试历史 · VALORANT 灵敏度测试器",
  description: "回看历次灵敏度测试的推荐趋势与成绩记录。",
};

export default function HistoryLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
