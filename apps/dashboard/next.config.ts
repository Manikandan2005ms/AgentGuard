import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";
import path from "node:path";

// Share the repo-root .env with the API (Render sets real env vars instead).
loadEnvConfig(path.resolve(process.cwd(), "../.."));

const nextConfig: NextConfig = {
  transpilePackages: ["@agentguard/shared"],
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
    NEXT_PUBLIC_AG_GRID_LICENSE_KEY: process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ?? "",
    // Public dashboard URL, used for absolute social-preview links
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? process.env.DASHBOARD_URL ?? "",
  },
};

export default nextConfig;
