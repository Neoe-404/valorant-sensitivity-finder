import Link from "next/link";
import { Crosshair } from "lucide-react";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-6 text-center">
      <Crosshair size={40} className="mb-6 text-accent" />
      <h1 className="text-3xl font-bold">页面不存在</h1>
      <p className="mt-3 text-sm text-dim">你访问的页面可能已被移动或删除。</p>
      <Link href="/" className="btn-primary mt-6">
        返回首页
      </Link>
    </main>
  );
}
