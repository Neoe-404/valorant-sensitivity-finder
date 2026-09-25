import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(isGitHubPages && {
    output: "export",
    basePath: process.env.PAGES_BASE_PATH ?? "/valorant-sensitivity-finder",
    trailingSlash: true,
  }),
};

export default nextConfig;
