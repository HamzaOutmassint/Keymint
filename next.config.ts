import type { NextConfig } from "next";
import { securityHeaders } from "./lib/security-headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: { optimizePackageImports: ["@hugeicons/react", "@hugeicons/core-free-icons"] },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders() }];
  },
};

export default nextConfig;
