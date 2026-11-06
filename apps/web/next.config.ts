import { execFileSync } from "node:child_process";

import type { NextConfig } from "next";

// The build id is the git commit, so two builds of one commit give identical files (add-on F3: anyone can rebuild a
// release and compare its root hash; `pnpm --filter @haven/core release manifest`).
function commit(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "no-git";
  }
}

// Static export: the same build runs on Vercel and from Swarm (HAVEN_PLAN.md section 14).
const config: NextConfig = {
  output: "export",
  // Each page is written as route/index.html, which Swarm serves without any rewrite rules.
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ["@haven/core", "@haven/platform", "@haven/types", "@haven/ui"],
  reactStrictMode: true,
  generateBuildId: async () => commit(),
};
export default config;
