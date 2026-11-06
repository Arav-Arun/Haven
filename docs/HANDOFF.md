# Haven: handoff notes for the next agent

Written 2026-11-06. Repo: `/Users/arav/Desktop/Haven`, remote `https://github.com/Arav-Arun/ETHGlobalMumbai`, branch
`main` (the only branch). Last pushed commit: `fe7d211`. Working tree was clean when this was written.

### Continuation update — 2026-11-06, evening IST

- Later that evening Bee exited after its postage listener reported a backwards block number. The Fly machine's
  restart policy was set to `always` and the machine restarted without deleting its volume. A refreshed tunnel on
  localhost port 11638 works. Bee is running, but its batch-store rebuild is slow: around 20:32 IST `/chainstate`
  reported block 49,094,531 against tip 49,141,185 and `/stamps` still returned 503. Its goroutine profile showed it
  processing postage batch-store entries. Do not buy or retry a batch until `/stamps` is available and existing
  batches have been checked. `fly machine exec` on the API machine can also reach the private Bee API if the local
  tunnel fails. The API Arkiv proxy returned chain ID 7794095.
- The local web export was rebuilt using the production public URLs and compared with Vercel: all 12 exported route
  HTML files and 34 unique scripts/styles referenced by those pages matched byte-for-byte. Preserve the public
  production environment when generating a release manifest; this comparison is not an end-to-end wallet test.
- The live e2e script creates temporary identities and requests Sepolia ETH and Arkiv tGLM drips; it also sends tGLM
  to an editor's stealth address. This moves testnet funds, so obtain the user's explicit authorization for that flow
  or arrange for the user to perform the funding, consistent with the user's no-fund-transfers rule below.
- The Fly API was stuck before listening on a 256 MB machine. `apps/api/Dockerfile` now starts Node directly with the
  tsx loader instead of running extra pnpm and tsx wrapper processes. The new Fly deployment passed its health check;
  `/health` returns 200 and `/config` returns the Bee doorbell overlay. The Dockerfile change is uncommitted.
- A fresh Bee proxy on local port 11634 works. Bee is still syncing: at approximately 20:09 IST it was at block
  48,421,775 of 49,140,856. `/stamps` remains unavailable and the approved batch has not been purchased. Check the
  current chain state and wallet and calculate the cost before buying the already-approved batch; never blindly retry
  a POST whose outcome is unknown. The former proxy on 11633 had stalled.
- `havenethglobal.xyz` is attached to the Vercel project, but its registrar still uses parking nameservers. Set
  `ns1.vercel-dns.com` and `ns2.vercel-dns.com` at the registrar, then verify in Vercel and add the domain to the
  WalletConnect allowlist. The four production public origin/API/Bee/Arkiv URLs have been corrected; a production
  rebuild completed successfully at `eth-global-mumbai-six.vercel.app`. Landing-page scripts contain the correct API
  host and production origin, and not the old incorrect API host. The custom-domain wallet flow is still untested.
- The extension's local `.env` now has the production API, Bee and Arkiv gateway URLs and the public release signer
  address; its Chrome zip was rebuilt in `apps/extension/.output/`. A successful build is not an end-to-end test.
- Live balances checked: relayer approximately 0.244 Sepolia ETH; release signer 10 tGLM. Recheck before asking for
  funding. The local API suite (9 tests), core suite (75 tests), website build and extension zip passed. Full live e2e,
  Swarm uploads, final-domain wallet sign-in, and the signed website release have not been verified.
- The local website build used localhost settings. Do not publish its release manifest as the production site: first
  reproduce and verify the exact production build and configuration. The Vercel project contains server-side secret
  variables that a static build may not need; review their necessity without revealing values.

Haven (formerly Cloakroom) is private file sharing with ENS names: time-limited access, stealth addresses, encrypted
files on Swarm, records on Arkiv, traffic through Anon-RPC. It runs as a website, a phone PWA and a browser extension.
Built at ETHGlobal Mumbai 2026 by Team **Deploy For Good**.

Target prize tracks: **ENS-1**, **ARKIV-2 + ARKIV-5 (Swarm)**, **EF-1**, with **EF-3** also ticked. `PRIZES.md` has
each track's must-have list. Check it before submitting.

---

## 1. Read these first

| File | Why |
| --- | --- |
| `CLAUDE.md` | Repo rules (ownership split, frozen files, no faking). |
| `CLAUDE.local.md` | Hackathon context, prize tracks, ethskills rules. |
| `docs/plan/HAVEN_PLAN.md` | The design. Section 6 = the only allowed contract addresses. Section 22 = review fixes, don't weaken them. |
| `docs/plan/PLAN_SHARED.md`, `PLAN_A.md`, `PLAN_B.md`, `CLOAKROOM_ADDONS.md` | Build plans and add-ons spec. |
| `PRIZES.md`, `SHOWCASE.md` | Prize requirements and past winners. |
| `arkiv/*.md` | Required Arkiv prize docs. `arkiv/swarm.md` still has blanks to fill (see section 5). |
| `contracts/deployments/sepolia.json` | Every deployed address. |

## 2. Rules the user insists on (do not break)

- **Commits are authored only by the user.** No `Co-Authored-By`, no Claude or AI attribution lines in commits or PRs.
- **No faking or hardcoding.** No mocks, seeded data, placeholder values or fake hashes. Every value shown is read live
  from Sepolia, Arkiv or Swarm. Only configuration (addresses, endpoints) is fixed.
- **Never commit `.env` files, private keys or seeds.** Never echo a pasted key back in chat. Testnet throwaway keys only.
- **Never force-push** or rewrite pushed history.
- The Arkiv access key stays server-side (API only).
- No third-party scripts, trackers or analytics in any client.
- The agent must **not move crypto funds itself** (the user sends funds). Purchases need explicit confirmation of item
  and total. **Exception already approved:** buying the 3 xBZZ Swarm postage batch (section 5).
- `packages/types/src/index.ts` and root config files are frozen.

## 3. Stack and layout

- pnpm 11 monorepo. Node 26 locally, Node 22 in the Docker image.
- Packages (renamed from `@cloakroom/*` to `@haven/*`):
  - `packages/core` (`@haven/core`): client logic: ENS, stealth addresses, crypto, Arkiv, Swarm, transport.
  - `packages/ui` (`@haven/ui`): shared React components (Ticket, MembersPanel...).
  - `packages/platform` (`@haven/platform`): browser and extension platform bits (Anon-RPC worker, storage).
  - `packages/types` (`@haven/types`): shared types (frozen).
  - `apps/web` (`@haven/web`): Next.js 16 static export, Tailwind v4, RainbowKit 2.2.11, wagmi 2, viem 2.
  - `apps/api` (`@haven/api`): relayer, Swarm upload gateway, Arkiv RPC proxy, gas drip, doorbells.
  - `apps/extension`: WXT browser extension.
  - `contracts`: Foundry. `DriveRegistry` extends ENSv2 `UserRegistry` (`grantRolesUntil`, `wasAllowed`, `accessOf`,
    `historyOf`).
  - `infra/bee`: Fly config for our Swarm Bee node.

Useful commands:

```bash
pnpm install
pnpm --filter @haven/core test        # 75 tests, all passing at fe7d211
pnpm --filter @haven/core e2e         # live end-to-end run (needs API + funded relayer + postage batch)
pnpm --filter @haven/api dev          # API on :8787
pnpm --filter @haven/web dev          # web on :3000
pnpm --filter @haven/web build        # static export to apps/web/out
```

## 4. What is done

### Features

- **ENS:** each folder is an ENSv2 subname registry. Access is ENS roles with an end time (`grantRolesUntil`). Rooms
  under `rooms.haven.eth`.
- **Stealth addresses (Fluidkey kit):** a fresh stealth address per share, a sealed welcome note
  (`createWelcome`/`openWelcome`), member key copies.
- **Key rotation:** epoch key chain rotates hourly (every 60 s in demo mode). Removing a member refreshes keys for the
  folder and its subfolders. Each room has its own key.
- **Group sharing and team rules (add-on F2):** sharing to an address list or "everyone under acme.eth" is done
  client-side in `packages/core/src/client.ts` (`shareWithGroup`, `shareWithRule`, `groupHolders`), because the
  contract has no parent/group links.
- **Folder inheritance:** subfolders follow parent members (`grantExisting`, `syncInherited`, `propagate`,
  `adoptInherited`, walked in `maintain()`). Inherited and group members can't be removed one by one.
- **Arkiv:** `haven.*` entities (files, keylog, devices, releases, rebuilds) on the Rabdi chain (7794095).
- **Swarm:** padded ciphertext only (64 KB to 32 MB buckets), signed uploads through the API, GSOC "doorbells" for live
  updates (add-on F4).
- **Anon-RPC (nox):** RPC calls go through the private network with one isolation key per stealth address and per
  room. `anonCanReach()` in `packages/core/src/transport.ts` sends local `http://` calls direct and labels them
  "Direct", because Anon-RPC tunnels only reach `https://` hosts on port 443.
- **Wallets:** RainbowKit picker shows MetaMask, Phantom, Rainbow, Rabby, plus injected and WalletConnect.
- **Etherscan links:** "View on Etherscan" on every folder and room; ticket serials link to the member's address.
- **Landing page:** redesigned (layout inspired by the Noa site, Haven's own look, no night sky), new arch-and-keyhole
  logo and icons (`apps/web/scripts/make-icons.mjs`), footer credit to Team **Deploy For Good**. Small "AI slop" text,
  chips and icons removed.
- **Workspace:** cleaned and moved to `/Users/arav/Desktop/Haven`. Nested submodule gitdir paths were fixed to the new
  location.

### Deployed on Sepolia (verified)

| What | Address |
| --- | --- |
| DriveRegistry implementation (verified source) | [`0x779Ee739785907454748aAfed760130Bdf0b7628`](https://sepolia.etherscan.io/address/0x779Ee739785907454748aAfed760130Bdf0b7628#code) |
| `haven.eth` registry | [`0xd20bC8330a9E9fCc14B8111Ab0D2CA5626Fc0632`](https://sepolia.etherscan.io/address/0xd20bC8330a9E9fCc14B8111Ab0D2CA5626Fc0632) |
| `rooms.haven.eth` registry | [`0x951D7D861710dcb645013eD1Fb3A0589980174db`](https://sepolia.etherscan.io/address/0x951D7D861710dcb645013eD1Fb3A0589980174db) |
| Resolver | [`0x1162Fc8f4713F684e3c9864402606CC20e81E2D5`](https://sepolia.etherscan.io/address/0x1162Fc8f4713F684e3c9864402606CC20e81E2D5) |
| Relayer (registrar role only) | [`0xc09b72D5DceF2eE9716b91CEfb14Bd06D2856969`](https://sepolia.etherscan.io/address/0xc09b72D5DceF2eE9716b91CEfb14Bd06D2856969) |
| Deployer | `0x03E0eab0E4AeA87F9bff8CA2923ab748D820Da9c` |
| Swarm Bee node wallet (Gnosis) | [`0xec074829fB5dd8090178f9f667359DD4Ec82A04f`](https://gnosisscan.io/address/0xec074829fB5dd8090178f9f667359DD4Ec82A04f) |

### Hosting

- **Fly.io, region `sin`** (Fly has no Mumbai region):
  - `haven-bee`: Bee 2.8.3 light node, private, reachable at `http://haven-bee.internal:1633` from other Fly apps.
    Funded with xDAI and xBZZ (from the Swarm gift code). **Still syncing** (see section 5).
  - `havenethglobal-api`: the API (`apps/api/fly.toml`). The name `haven-api` was taken. **Deploy fails its health
    check** (see section 5).
- **Vercel:** project `eth-global-mumbai`, builds `apps/web` (`apps/web/vercel.json`: `"framework": null`, build
  `pnpm --filter @haven/web build`, output `out`). Live at `https://eth-global-mumbai-six.vercel.app`, but wallet
  sign-in there needs the final origin (see section 5).
- **Domain:** `havenethglobal.xyz` bought by the user, not yet pointed at Vercel.

### Local env files (not committed; names only)

- Root `.env`: `SEPOLIA_RPC_URL`, `DEPLOYER_PRIVATE_KEY`, `RELAYER_PRIVATE_KEY`, `RELEASE_PRIVATE_KEY`,
  `ETHERSCAN_API_KEY`, `ARKIV_ACCESS_KEY`, `SWARM_GIFT_PRIVATE_KEY`.
- `apps/api/.env`: `PORT`, `SEPOLIA_RPC_URL`, `RELAYER_PRIVATE_KEY`, `ARKIV_RPC_URL`, `ARKIV_ACCESS_KEY`, `BEE_URL`,
  `POSTAGE_BATCH_ID` (**empty**), `ROOM_POW_DIFFICULTY`, `DRIP_SEPOLIA_WEI`, `DRIP_ARKIV_WEI`, `DRIP_BATCH_SECONDS`,
  `DOORBELL_PROXIMITY`, `SWARM_GIFT_PRIVATE_KEY`, `DEPLOYER_PRIVATE_KEY`.
- `apps/web/.env.local` (local dev): `NEXT_PUBLIC_DEMO_MODE=true`, `NEXT_PUBLIC_APP_ORIGIN=http://localhost:3000`,
  Sepolia RPC (publicnode), `NEXT_PUBLIC_PRIVATE_NETWORK=nox`, WalletConnect project ID, and API, Bee and Arkiv RPC
  URLs all on `http://localhost:8787` (Arkiv at `/arkiv-rpc`).
- `apps/extension/.env`: `WXT_APP_ORIGIN=https://havenethglobal.xyz`.

## 5. What is left (in order)

### 5.1 Swarm postage batch: DONE

- Bought 2026-11-06 after the node synced (the user's approved 3 xBZZ, depth 20, amount 28610229492). Batch ID
  `cbbfb329338e20fb1d13171a20dc2da5f964daf85f939b7cefbec6568c63d1e9`, tx
  `0xcf9fd2e0aaf861c181d99aabd5925d26f9cd66d3e8c99ce684a043114a96d0fb`. `usable: true`, TTL about 8.2 days at the
  price then (201091 PLUR per chunk per block). The node wallet has 7 xBZZ left for a top-up
  (`PATCH /stamps/topup/<id>/<amount>`, which needs the user's OK since it spends xBZZ).
- Saved in `apps/api/.env` and as the Fly secret `POSTAGE_BATCH_ID` on `havenethglobal-api` (applied; `/health` ok).
- `arkiv/swarm.md` now has the batch, who gave it and the node. Still to fill: one Arkiv entity key with its Swarm
  reference from the e2e run, and the video timestamp.
- Not yet verified: a real upload through `POST /upload` (needs the e2e run or a file added in the app).

### 5.2 Fix the Fly API deploy (`havenethglobal-api`)

- `fly deploy` from `apps/api` timed out on the health check. Not diagnosed yet. Start with:
  ```bash
  fly logs --app havenethglobal-api
  ```
  ```bash
  fly secrets list --app havenethglobal-api
  ```
- Likely causes: missing secrets (the API needs the `apps/api/.env` values as Fly secrets, with
  `BEE_URL=http://haven-bee.internal:1633`), the listening port or host not matching `fly.toml`'s internal port, or a
  slow first start.
- Once it's healthy, `https://havenethglobal-api.fly.dev/config` should answer.

### 5.3 Vercel env and domain

- Vercel env vars (Production) must use the API's real host `https://havenethglobal-api.fly.dev`. An earlier pasted
  block used `haven-api.fly.dev`, which is wrong:
  - `NEXT_PUBLIC_APP_ORIGIN=https://havenethglobal.xyz`
  - `NEXT_PUBLIC_API_URL=https://havenethglobal-api.fly.dev`
  - `NEXT_PUBLIC_BEE_URL=https://havenethglobal-api.fly.dev` (reads go through the API's `GET /bytes/<ref>` gateway)
  - `NEXT_PUBLIC_ARKIV_RPC_URL=https://havenethglobal-api.fly.dev/arkiv-rpc`
  - `NEXT_PUBLIC_SEPOLIA_RPC_URL`, `NEXT_PUBLIC_PRIVATE_NETWORK=nox`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`,
    `NEXT_PUBLIC_DEMO_MODE`
  Then redeploy.
- **The origin matters.** Keys derive from a SIWE-format sign-in message bound to `NEXT_PUBLIC_APP_ORIGIN`. If the page
  is served from a different domain, MetaMask crashes with `Cannot read properties of undefined (reading 'origin')`.
  So only test the deployed site on the domain the origin names. Don't change the origin after people have used it
  (their keys would change).
- **User's steps:** set the domain's nameservers at the registrar to `ns1.vercel-dns.com` and `ns2.vercel-dns.com`
  (or add the A/CNAME records Vercel shows); add `havenethglobal.xyz` in the Vercel project's Domains; add the domain
  to the WalletConnect Cloud allowlist.

### 5.4 Funding (the user does this)

- Send more Sepolia ETH to the relayer `0xc09b72D5DceF2eE9716b91CEfb14Bd06D2856969` (it pays for registrations and gas
  drips).
- The release wallet needs tGLM (Arkiv gas) for the F3 website-release records.

### 5.5 Prove it end to end, then submit

1. `pnpm --filter @haven/core e2e` against the live API (step 9 covers groups, inheritance and doorbells). Record
   outputs in `docs/evidence.md` and `arkiv/swarm.md`.
2. F3 website release: sign the build's release record with `WXT_RELEASE_SIGNER` / `RELEASE_PRIVATE_KEY`.
3. Build the extension (`apps/extension`, WXT) and attach the zip.
4. Record the demo video, then fill in timestamps in `arkiv/*.md`.
5. ETHGlobal submission: check each target track's must-have list in `PRIZES.md` and the required files
   (`FEEDBACK-ENS.md`, `arkiv/*.md`, README CROPS section, `AI_USAGE.md`).

## 6. Running the demo locally (works today, without Swarm uploads)

1. Terminal 1, the tunnel to the Bee node: `fly proxy 11633:1633 --app haven-bee`.
2. Terminal 2, the API with the local Bee URL:
   ```bash
   BEE_URL=http://localhost:11633 pnpm --filter @haven/api dev
   ```
3. Terminal 3: `pnpm --filter @haven/web dev`, then open `http://localhost:3000`.
4. Connect MetaMask on Sepolia → sign in → create a folder → share it with an ENS name or address → open the ticket →
   "View on Etherscan". File uploads only work once `POSTAGE_BATCH_ID` is set.

If localhost shows a 500 for `@haven/ui/styles.css`, delete `apps/web/.next` and restart (left over from the package
rename).

## 7. Pitch material already given to the user

- **3-minute demo:** private sharing first (not "Google Drive for ENS"). Show a share → the stealth ticket → the role
  with an end time on Etherscan → the verified contract.
- **Roadmap items:** automatic rotation of member stealth addresses (below), mainnet ENSv2, mobile push via doorbells,
  more storage options.
- **Idea, not built: rotating member addresses.** Today each share gets one fresh stealth address for its whole life.
  A manager's app could, every N days, make a new stealth address for the same member, grant the same role and end time,
  write a new welcome note on Arkiv, then let the old grant expire. Limits: rotating everyone at once with random order
  and overlap is needed to stop timing links; costs two Sepolia transactions per member per rotation; overlap uses two
  of a role's 15 slots for a while; only owners and managers can rotate. It would live in `maintain()` in
  `packages/core/src/client.ts`, as an off-by-default setting.

## 8. Known gotchas

- Fly has no `bom` region; everything is in `sin`.
- Anon-RPC can't reach `http://` or local hosts. That's expected; those calls show as "Direct".
- The free public Gnosis RPC works for the Bee node. Alchemy hadn't enabled Gnosis on the user's key.
- The xBZZ token on Gnosis is `0xdBF3Ea6F5beE45c02255B2c26a16F300502F68da` (16 decimals).
- After Harshad's (teammate's) rebrand, package filters are `@haven/*`. Old `@cloakroom/*` commands fail.
- `.env` files must end with a newline, or the last two lines merge.
