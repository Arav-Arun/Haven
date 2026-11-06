# Plan A: protocol (contracts, core library, API)

**Person A owns:** `contracts/`, `packages/core/`, `apps/api/`, `arkiv/`, `docs/protocol.md`, `docs/checks-a.md`,
`FEEDBACK-ENS.md`. Branch: `plan-a`. Person A also does Step 0 (`PLAN_SHARED.md` section 2).

## Starter prompt (paste into your Claude agent)

> You are building Plan A of Cloakroom in this repo. Read `CLAUDE.md`, `docs/plan/CLOAKROOM_PLAN.md`,
> `docs/plan/PLAN_SHARED.md` and `docs/plan/PLAN_A.md`, in that order.
> - Edit only the folders Plan A owns.
> - Implement the frozen interface in `packages/types/src/index.ts` exactly; never edit that file.
> - Work through the steps of `PLAN_A.md` in order. After each step, run its "Done when" check, write the result in
>   `docs/checks-a.md`, commit and push.
> - Before writing Solidity, load the ethskills `security` and `testing` skills.
> - Never guess an address: use only the table in `CLOAKROOM_PLAN.md` section 6.
> - Ask me before any step that needs a human: faucets, accounts, funding.
> - No faking or hardcoding: no mock data, placeholder values or fake hashes. Every value comes from Sepolia, Arkiv
>   or Swarm; only configuration (addresses, endpoints) is fixed.

**Human-only tasks for Person A** (an agent can't do these):
- Sepolia faucet drips.
- Arkiv Hub sign-in for the access key and tGLM.
- Etherscan API key.
- Approving the deployer key's first transactions.

**Delivery order for B** (there is no mock client, so B wires screens as these land). Merge `plan-a` into `main`
after each group, about every 3 hours:
1. Session: `signInMessage`, `needsSecondSignature`, `signIn`, `restore`, `signOut`, `exportSeed`,
   `isNameAvailable`, `claimName`.
2. Rooms and folders: `createRoom`, `createFolder`, `listFolders`, `getFolder`.
3. Files: `upload`, `listFiles`, `download`, `downloadFolder`.
4. Sharing: `lookupRecipient`, `share`, `listMembers`, `removeMember`, `sharedWithMe`.
5. Transparency: `publicView`, `onReceipt`, `maintain`.
6. The rest: groups, links, mount, versions, delete.

---

## A0 · Step 0 (H0–H0.5)
Follow `PLAN_SHARED.md` section 2 exactly, then `git checkout -b plan-a`.
**Done when:** `main` has the skeleton and the frozen interface, and B has cloned it.

## A1 · First-hour checks (H0.5–H3)
Run checks 1, 2, 3, 4, 5, 8 and 9 from `CLOAKROOM_PLAN.md` section 17, using throwaway scripts in
`contracts/script/` and `packages/core/scripts/`.
- Generate the deployer and relayer keys locally (`.env` only). The human funds them from faucets.
- Register `cloakroom.eth` (`ETHRegistrar` commit–reveal; another name if taken) and `rooms.cloakroom.eth`. Give the
  relayer key only `ROLE_REGISTRAR` on both registries.
- Measure gas for:
  - a `DriveRegistry` proxy deploy plus `register`;
  - `grantRolesUntil`;
  - a tGLM transfer.

  This sizes the drips.

**Done when:** `docs/checks-a.md` has pass/fail, tx hashes and gas for each check. Any failure is posted to B with the
fallback chosen. B has the app names (handoff H4). The Arkiv access key stays in `apps/api/.env`, never in a browser.

## A2 · `DriveRegistry`, part 1 (H3–H7)
- **Setup:**
  - `forge init` in `contracts/`;
  - add `ensdomains/contracts-v2` as a submodule pinned at `48b3e2d` (with its own submodules);
  - set remappings;
  - load ethskills `security` and `testing`.
- **Implement**, per `CLOAKROOM_PLAN.md` section 6:
  - `contract DriveRegistry is UserRegistry`;
  - our initializer (root roles to K; dangerous roles to W when given; no upgrade roles);
  - `_getRoles`: strip `ROLE_UPGRADE` and its admin bit from everyone, and drop expired drive bits;
  - `grantRolesUntil`;
  - the history in `_onRolesGranted` / `_onRolesRevoked` (at most 8 intervals per account);
  - `wasAllowed`, `accessOf` and `sweep`;
  - events `AccessGranted` / `AccessEnded`.
- **Tests:** unit, fuzz and invariant, as listed in `CLOAKROOM_PLAN.md` sections 6 and 20, plus a fork test through
  the Sepolia `VerifiableFactory`.
- **Deploy:** deploy the implementation to Sepolia and verify it on Etherscan. Write
  `contracts/deployments/sepolia.json`. Add `pnpm --filter @cloakroom/core gen` to export the ABI and addresses into
  `packages/core/src/generated.ts`.

**Done when:**
- `forge test` passes, including invariants and the fork test;
- the implementation is verified;
- a demo proxy on Sepolia shows grant → `wasAllowed` true → time passes → false, with the interval still readable;
- `upgradeToAndCall` reverts when called by K.

## A3 · Core foundations (H7–H9)
In `packages/core` (TypeScript, vitest, fast-check):
- **`transport.ts`:** a viem `custom({ request })` transport that POSTs JSON-RPC through `AnonFetch.fetch` (or
  `isolated(key)`) and records a `route` receipt step. `passthroughAnon()` and `memoryStore()` for Node and tests.
- **`keys.ts`:**
  - `signInMessage(address)`, the fixed SIWE-format text from section 5;
  - the two-signature comparison;
  - smart-wallet detection (`getCode`);
  - key derivation from a signature (Fluidkey kit), a passkey PRF, a random seed or an exported seed;
  - K, `K_room[n]`, and the `cloak.key` comparison.
- **`epochs.ts`:**
  - key regression (`E[N] = HKDF(FS, "chain")`, `E[i-1] = SHA-256(E[i])`, N = 8,760);
  - epoch maths from `t0` and L (1 minute when `demoMode`);
  - `epochKeyFor(until)` (the last epoch ending at or before `until`);
  - padding buckets (64 KB, 256 KB, 1 MB, 4 MB, 16 MB, 32 MB);
  - AES-GCM and HKDF helpers.
- **`stealth.ts`:** create and open welcome notes with the Fluidkey kit (`generateStealthAddresses`,
  `generateStealthPrivateKey`); `MK_S` sealing.

**Done when:** unit tests pass, including:
- same signature → same keys;
- different signatures → `WALLET_NOT_SUPPORTED`;
- a holder of `E[j]` can derive `E[i]` for every i ≤ j and never `E[j+1]`;
- welcome round-trip; a wrong key doesn't match.

## A4 · ENS, Arkiv, validator, Swarm client (H9–H11)
- **`ens.ts`:**
  - **Reads**, through `UniversalResolverV2` (passed explicitly): `cloak.key`, the registry walk, `accessOf`,
    `wasAllowed`, and listing child folders from the registry's registration events (`eth_getLogs`) **(check;
    fallback: a sealed `cloak.index` entity per owner)**.
  - **Writes from K or `K_room`:** create a folder (`VerifiableFactory` proxy + `register`), `grantRolesUntil`,
    `revokeRoles`, `sweep`, link subnames, mount.
  - Every write adds receipt steps.
- **`arkiv.ts`:**
  - the eight schemas from section 10;
  - writers, queries and renewals;
  - a native tGLM transfer (to fund S).
- **`validator.ts`:** the read rules from section 7. Check `wasAllowed` at `$createdAt`; reject a stale version, a
  back-dated epoch, a non-manager write during an open refresh, and wrong schema owners. Count hidden entities.
- **`swarm.ts`:**
  - upload through the API, as a request signed by the writer key;
  - download through `beeUrl` (Anon-RPC if `supportsAnyHttps`; otherwise direct, recorded as a `direct` route);
  - `downloadFolder`.

**Done when:** a script on Sepolia + Arkiv + Bee:
- creates a room;
- writes and reads each schema;
- shows the validator hiding a planted write from an address without WRITE.

## A5 · API (H11–H13)
`apps/api`, Hono, per `CLOAKROOM_PLAN.md` section 15:
- **`POST /claim`:** deploy the PermissionedResolver with `cloak.key` through `initialize(grants, calls)`, deploy the
  drive root (K everyday, W dangerous), register the name. Return what it did so the client can verify the API holds
  no role.
- **`POST /room`:** check the proof-of-work and the daily cap; register `r-<random>.rooms.cloakroom.eth`; deploy the
  registry with root `K_room`.
- **`POST /drip`:**
  - only for a K or `K_room` that holds root on a registry whose parent chain ends at `cloakroom.eth` or
    `rooms.cloakroom.eth`;
  - queued and sent **in a batch every 10 minutes**;
  - once per key per day; global budget; balance floor.
- **`POST /arkiv-rpc`:** a JSON-RPC pass-through to `ARKIV_RPC_URL` that adds `ARKIV_ACCESS_KEY` server-side (Arkiv's
  guidance: never ship the key in a browser bundle). Forward only the read methods the client uses plus
  `eth_sendRawTransaction`; rate-limit; log nothing.
- **`POST /upload`:** the signature must be from a key with WRITE now (`wasAllowed` at the current time); 25 MB cap;
  quota per key; stamp budget guard; streams to Bee with `POSTAGE_BATCH_ID`.
- **`GET /health`.**
- **Logs:** rate-limit counters for 24 hours, nothing else.
- **Deploy:** Dockerfile; `fly launch`; secrets with `fly secrets set`. Tell B the URL (handoff H12).

**Done when:** each endpoint works with curl against the deployed URL, and abuse limits return `RATE_LIMITED`.

## A6 · `createDriveClient`, Must methods + e2e part 1 (H12–H14)
- **Implement:**
  - session: `signInMessage`, `needsSecondSignature`, `signIn`, `restore`, `signOut`, `exportSeed`,
    `isNameAvailable`, `claimName`;
  - folders: `listFolders`, `getFolder`, `createFolder` (inherit=false for now), `createRoom`;
  - files: `listFiles`, `upload` (write rule), `download`, `downloadFolder`;
  - sharing: `lookupRecipient`, `share` (grant + funding S in the same action + welcome + key copy + roster),
    `listMembers`, `removeMember` (revoke + refresh), `sharedWithMe`;
  - transparency: `publicView` (with the summary sentence and direct calls), `onReceipt`.
- **e2e script** (`pnpm --filter @cloakroom/core e2e`, Node, passthrough Anon-RPC, demo epochs):
  1. Founder signs in and creates a room.
  2. Founder uploads two files.
  3. Founder shares with Investor (viewer, end in 2 minutes) and Editor (editor).
  4. Investor finds the share and opens both files.
  5. Editor uploads a file; Founder sees it.
  6. Wait for Investor's end. Founder uploads; Investor sees it with `readable: false`.
  7. Founder removes Editor early. Editor's next upload is refused, and a planted write by Editor is hidden.
  8. The funding check: Investor received no funds; Editor was funded only by the room key.

**Done when:** the e2e passes against Sepolia + Arkiv + Bee, and its tx hashes are saved in `docs/evidence.md`.
**This is A's M1 deliverable.**

## — M1 at H14 (`PLAN_SHARED.md` section 9) —

## A7 · Inheritance and `maintain()` (H15–H19)
- **`DriveRegistry`, part 2:**
  - inheritance fixed at creation (parent back-pointer check, at most 3 levels, drive bits only, `staticcall` with a
    gas cap, fails closed) in both `_getRoles` and `wasAllowed`;
  - tests;
  - deploy and verify a new implementation (new proxies use it).
- **Core:**
  - `createFolder(..., { inherit })`;
  - inherited key copies written when sharing the parent and when creating a subfolder;
  - a refresh that cascades to inheriting subfolders.
- **`maintain()`:**
  - top up editors and managers below the threshold (from the folder or room key);
  - answer open refresh requests;
  - renew entities older than 150 days.

**Done when:** an e2e step shows a parent member opening a subfolder file with no extra share, and that member's
removal refreshes both folders.

## A8 · Proving the fixes (H19–H22)
- **Property test (fast-check)** over an in-memory model of ENS and Arkiv, with random sequences of shares, expiries,
  removals, uploads and (later) group changes: **no file written after a member's end, or after their removal, decrypts
  with any key that member ever received.**
- **Validator tests:** stale version, back-dated epoch, write during an open refresh, expired editor, wrong schema
  owner.
- **Wallet tests:** different signatures refused; `KEY_MISMATCH` on a new device.

**Done when:** all pass in CI (`pnpm -r test`), with seeds logged so failures can be reproduced.

## A9 · Shoulds (H22–H27; stop at H27 whatever is done)
In order:
1. **Groups:**
   - `addGroup` in the contract;
   - `createGroup`;
   - share to a group (the group manager re-seals bounded epoch keys);
   - early removal from a group opens `cloak.refresh`, which blocks editors until a folder manager's `maintain()`
     refreshes;
   - property test extended to groups.
2. **Links:** `createLink` / `openLink` (expiring subname + `cloak.link` + fragment secret).
3. **Mount:** `mount`, refused for rooms.
4. **Versions:** `listVersions`, `deleteFile` (tomb).
5. **Blind room tokens** (feature 27), if time.

## A10 · Docs and evidence (H27–H30)
- **`arkiv/`:** `schema.md`, `friction.md`, `reach.md`, `why-arkiv.md`, `how-you-use-arkiv.md` and `swarm.md`. For
  `swarm.md`, the batch ID and buyer come from B; the video timestamp is filled in after B records the video.
- **`FEEDBACK-ENS.md`:** friction from building on ENSv2, with concrete suggestions.
- **`docs/protocol.md`:**
  - contract design, stock vs new, links to the exact lines of `_getRoles` and `wasAllowed`;
  - the key schedule;
  - the read and write rules;
  - the state transitions table;
  - the "who can link what" table;
  - writer wallets;
  - one runnable Arkiv query.
- **`docs/evidence.md`:** every deploy, setup and e2e transaction.
- **Contenthash:** set `cloakroom.eth`'s contenthash to the Swarm reference B sends (H28).

**Done when:** every file exists with real links and hashes. No placeholders.

## — M2 at H30 —

## A11 · After M2 (H30–H36)
- Fix integration bugs with B.
- Run the integration checklist (`PLAN_SHARED.md` section 9).
- Help with the video.
- Submit: pick ENS, Arkiv and EF; tick EF-3 too.

---

## If you fall behind
- **Cut, in this order:** blind tokens → versions → mount → links → groups.
- **Never cut:**
  - the freeze, expiry, history and `wasAllowed`;
  - epoch keys and the write and read rules;
  - sharer-funded editors;
  - rooms;
  - inheritance;
  - the property test;
  - the e2e.
