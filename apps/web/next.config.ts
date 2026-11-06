import type { NextConfig } from "next";

// Static export: the same build runs on Vercel and from Swarm (CLOAKROOM_PLAN.md section 14).
const config: NextConfig = {
  output: "export",
  // Each page is written as route/index.html, which Swarm serves without any rewrite rules.
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ["@cloakroom/platform", "@cloakroom/types", "@cloakroom/ui"],
  reactStrictMode: true,
  // Reproducible builds (add-on F3): Next otherwise picks a random build id, which ends up in file paths, so two
  // builds of one commit would never hash the same. The release script sets it to the git commit.
  generateBuildId: async () => process.env.CLOAKROOM_BUILD_ID || "cloakroom",
};
export default config;
