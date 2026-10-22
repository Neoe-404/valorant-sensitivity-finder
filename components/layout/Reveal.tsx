"use client";

import { useEffect, useRef, useState, type ElementType, type ReactNode } from "react";

type RevealProps = {
  children: ReactNode;
  /** 入场前的元素类型，用于保留语义标签（如 h1/p/section）。 */
  as?: ElementType;
  /** 与 framer 的 delay 对应，单位秒。 */
  delay?: number;
  /** 淡入（无位移）还是上移淡入。 */
  variant?: "up" | "fade";
  className?: string;
};

/**
 * 轻量的滚动/挂载入场动画，用 IntersectionObserver + CSS keyframes 实现，
 * 用来替代首页的 framer-motion，把整个动画运行时移出首屏依赖。
 * 元素进入视口即触发一次；reduced-motion 偏好下由 CSS 直接呈现终态。
 */
export function Reveal({
  children,
  as,
  delay = 0,
  variant = "up",
  className = "",
}: RevealProps) {
  const Tag = as ?? "div";
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      data-visible={visible || undefined}
      className={`${variant === "fade" ? "reveal-fade" : "reveal"} ${className}`}
      style={delay ? { animationDelay: `${delay}s` } : undefined}
    >
      {children}
    </Tag>
  );
}
