import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve("."),
  },
  // Bundle the community-service form template (read via fs, outside public/)
  // into the serverless functions that generate certificates.
  outputFileTracingIncludes: {
    "/api/withdrawals/**": ["./assets/**"],
    "/api/admin/withdrawals": ["./assets/**"],
  },
};

export default nextConfig;
