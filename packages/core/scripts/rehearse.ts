// Dress rehearsal of the live setup on a local fork of Sepolia: starts anvil forking SEPOLIA_RPC_URL, gives the
// deployer and relayer ETH on the fork only, then runs the bootstrap and the A1 checks against a temporary copy of
// contracts/deployments/sepolia.json (the real file and generated.ts are never touched). Run it before the live run.
//
// Run: pnpm --filter @cloakroom/core rehearse     (needs SEPOLIA_RPC_URL, ideally an archive-capable provider)

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createPublicClient, http, parseEther, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { env, envKey, log, repoRoot } from "./lib";

const port = 8700 + Math.floor(Math.random() * 200);
const forkUrl = `http://127.0.0.1:${port}`;
const anvil = spawn("anvil", ["--fork-url", env("SEPOLIA_RPC_URL"), "--port", String(port), "--silent"], {
  stdio: "ignore",
});
const dir = mkdtempSync(join(tmpdir(), "cloakroom-rehearsal-"));
const deploymentFile = join(dir, "sepolia.json");
copyFileSync(resolve(repoRoot, "contracts/deployments/sepolia.json"), deploymentFile);

try {
  const fork = createPublicClient({ transport: http(forkUrl) });
  for (let i = 0; ; i++) {
    try {
      await fork.getBlockNumber();
      break;
    } catch {
      if (i > 120) throw new Error("the fork did not start");
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  log(`fork of Sepolia at block ${await fork.getBlockNumber()} on ${forkUrl}`);
  for (const name of ["DEPLOYER_PRIVATE_KEY", "RELAYER_PRIVATE_KEY"]) {
    const address = privateKeyToAccount(envKey(name)).address;
    await fork.request({ method: "anvil_setBalance" as never, params: [address, toHex(parseEther("10"))] as never });
    log(`- ${name.split("_")[0]!.toLowerCase()} ${address}: 10 ETH on the fork only`);
  }
  const childEnv = { ...process.env, SEPOLIA_RPC_URL: forkUrl, DEPLOYMENT_FILE: deploymentFile };
  for (const script of ["scripts/bootstrap-sepolia.ts", "scripts/a1-checks.ts"]) {
    log(`\n=== ${script} (rehearsal)`);
    const run = spawnSync("pnpm", ["exec", "tsx", script], { cwd: resolve(repoRoot, "packages/core"), env: childEnv, stdio: "inherit" });
    if (run.status !== 0) {
      process.exitCode = 1;
      break;
    }
  }
} finally {
  anvil.kill();
  rmSync(dir, { recursive: true, force: true });
}
log(process.exitCode ? "\nREHEARSAL: FAIL" : "\nREHEARSAL: PASS — now run `bootstrap` and `a1` for real");
