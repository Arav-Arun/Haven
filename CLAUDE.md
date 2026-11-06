# Haven: rules for coding agents

Two people build this repo in parallel on separate laptops. Their branches are merged later.

- Person A (branch `plan-a`) owns: contracts/, packages/core/, apps/api/, arkiv/, docs/protocol.md,
  docs/checks-a.md, FEEDBACK-ENS.md.
- Person B (branch `plan-b`) owns: packages/platform/, packages/ui/, apps/web/, apps/extension/,
  infra/bee/, README.md, AI_USAGE.md, docs/checks-b.md.
- Edit only the folders your person owns. If you need something from the other side, write it in
  docs/requests-<a|b>.md on your branch, and tell your human.
- packages/types/src/index.ts is FROZEN. Never edit it on a branch.
- Root files (package.json, pnpm-workspace.yaml, tsconfig.base.json, .env.example, CLAUDE.md) are frozen after Step 0.
  Add dependencies only in your own package's package.json.
- Read docs/plan/HAVEN_PLAN.md (design), docs/plan/PLAN_SHARED.md (rules) and your own plan before starting.
  Follow your plan's steps in order. After each step, run its "Done when" check, then commit.
- Commit at least once an hour with a clear message, and push your branch. Judges check commit history.
- Never commit .env files, private keys or seeds.
- Solidity: load ethskills `security` and `testing` first. Addresses only from HAVEN_PLAN.md section 6, never
  guessed.
- Never put plaintext file contents, names or keys into Arkiv, ENS, Swarm, logs or analytics.
- No third-party scripts, trackers or analytics in any client.
- No faking or hardcoding: no mock clients, seeded or placeholder data, or fake hashes. Every value shown is read
  live from Sepolia, Arkiv or Swarm. Only configuration (addresses, endpoints) is fixed, loaded from env or one config file.
