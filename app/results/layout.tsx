import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "测试结果 · VALORANT 灵敏度测试器",
  description: "查看推荐灵敏度、参考区间、eDPI 与六维瞄准画像。",
};

export default function ResultsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
