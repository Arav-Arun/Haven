import type { NextConfig } from "next";

// Static export: the same build runs on Vercel and from Swarm (CLOAKROOM_PLAN.md section 14).
const config: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  transpilePackages: ["@cloakroom/platform", "@cloakroom/types"],
  reactStrictMode: true,
};
export default config;
