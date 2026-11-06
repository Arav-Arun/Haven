import type { NextConfig } from "next";

// Static export: the same build runs on Vercel and from Swarm (CLOAKROOM_PLAN.md section 14).
const config: NextConfig = {
  output: "export",
  // Each page is written as route/index.html, which Swarm serves without any rewrite rules.
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ["@cloakroom/platform", "@cloakroom/types", "@cloakroom/ui"],
  reactStrictMode: true,
};
export default config;
