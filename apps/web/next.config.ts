import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";
import path from "node:path";

loadEnvConfig(path.resolve(__dirname, "../.."));

const nextConfig: NextConfig = {
  serverExternalPackages: ["@valkey/valkey-glide"],
  logging: {
    browserToTerminal: true,
  },
  async redirects() {
    // Served before routing so "/" answers 307 with a Location header —
    // a redirect() in the page itself streams after the 200 shell.
    return [{ source: "/", destination: "/incidents", permanent: false }];
  },
  async rewrites() {
    return [{ source: "/health", destination: "/api/health" }];
  },
};

export default nextConfig;
