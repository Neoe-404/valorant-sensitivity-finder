import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // 对桶文件（barrel）库做摇树，只打包实际用到的符号，减小首屏 JS。
    optimizePackageImports: ["lucide-react", "framer-motion", "recharts"],
  },
  ...(isGitHubPages && {
    output: "export",
    basePath: process.env.PAGES_BASE_PATH ?? "/valorant-sensitivity-finder",
    trailingSlash: true,
  }),
};

export default nextConfig;
