"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Crosshair, Home, Settings, History, Target } from "lucide-react";

const LINKS = [
  { href: "/", label: "首页", icon: Home },
  { href: "/setup", label: "设置", icon: Settings },
  { href: "/test", label: "测试", icon: Target },
  { href: "/history", label: "历史", icon: History },
];

export function Navbar() {
  const pathname = usePathname();
  if (pathname === "/test") return null; // 测试全屏

  return (
    <header className="sticky top-0 z-40 border-b border-line/60 bg-void/80 backdrop-blur-md">
      <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-md border border-accent/60 bg-accent/10 text-accent">
            <Crosshair size={16} />
          </span>
          <span className="text-sm text-fg">
            Sensitivity<span className="text-accent">Finder</span>
          </span>
        </Link>
        <div className="flex items-center gap-1">
          {LINKS.map((l) => {
            const active = pathname === l.href;
            const Icon = l.icon;
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-label={l.label}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition ${
                  active
                    ? "bg-accent/10 text-accent"
                    : "text-dim hover:bg-panel-2 hover:text-fg"
                }`}
              >
                <Icon size={14} />
                <span className="hidden sm:inline">{l.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
