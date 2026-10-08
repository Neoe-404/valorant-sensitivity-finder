import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "灵敏度测试 · VALORANT 灵敏度测试器",
  description: "完成校准与甩枪、跟枪、微调三项测试，通过真实鼠标数据寻找最佳灵敏度。",
};

export default function TestLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
