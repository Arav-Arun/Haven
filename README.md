# Cloakroom

**Share files with ENS names privately: hidden members, and new files lock out when access ends.**

Today, sharing sensitive files means a bad trade-off. Google Drive and DocSend see every file and every viewer. Putting
access onchain is worse: anyone can see which investors got your data room.

Cloakroom lets you share files with any ENS name so that only the recipient knows:
- Each recipient gets access as a **fresh random address** that can't be traced to their name.
- For a data room, an **unlinked room** has a random name that isn't connected to you at all.
- Files are **encrypted and padded in your browser**, stored on **Swarm**, and listed on **Arkiv**.
- When someone's access ends, **every file added after that is unreadable to them**, enforced by encryption, with no
  transaction. What they already opened, they keep, as with any file you share.
- Every chain lookup goes through **Anon-RPC**, so RPC providers don't learn who is looking.

Built at ETHGlobal Mumbai 2026 for ENS (Best use of ENSv2), Arkiv (Build on Arkiv + the Swarm bonus) and the Ethereum
Foundation (Best use of Anon-RPC; CROPS). Licence: [MIT](LICENSE).

## Try it

| Where | How |
|---|---|
| Website | The live link is added at deploy time. Sign in with a wallet, or **Try it** with no wallet: two fresh identities in one tab |
| Phone | Open the website on your phone → Settings → **Install the app** (Android also gets "Share to Cloakroom") |
| Browser extension | Load `apps/extension/.output/chrome-mv3` unpacked, or the zip from the GitHub release; then website Settings → **Connect extension** |

Everything runs on Sepolia (ENSv2), Arkiv's Rabdi testnet and Swarm. Nothing is pre-seeded or mocked: every value on
screen is read live.

## How it works

```
 browser / phone / extension                                         public networks
 ┌───────────────────────────────┐   Anon-RPC (Nox mixnet)    ┌─────────────────────────────────────┐
 │ keys from one signature       │ ─────────────────────────▶ │ Sepolia: ENSv2 names, DriveRegistry │
 │ AES-256-GCM, padded buckets   │   isolated per room and    │   roles that end, access history    │
 │ stealth addresses (Fluidkey)  │   per stealth address      │ Arkiv: sealed file index, welcome   │
 │ validator for every entity    │                            │   notes, key copies, rosters        │
 └───────────────┬───────────────┘                            └─────────────────────────────────────┘
                 │ signed upload / ciphertext download         ┌─────────────────────────────────────┐
                 └───────────────▶ apps/api (relayer) ───────▶ │ Swarm: padded ciphertext            │
                                   /claim /room /drip          └─────────────────────────────────────┘
                                   /arkiv-rpc /upload /bytes
```

- **ENSv2:** every folder is an ENS name whose subregistry is a `DriveRegistry`, our only contract. It extends
  ENSv2's `UserRegistry` (Enhanced Access Control) with three role bits (viewer, editor, manager), **grants that end
  on their own** (`grantRolesUntil`), an **access history** anyone can query as a view call (`wasAllowed(account,
  role, t)`), and an **upgrade freeze**. Each user's own `PermissionedResolver` publishes a `cloak.key` record, which
  is how anyone can share with `alice.cloakroom.eth`. Rooms live under `rooms.cloakroom.eth`. Mounting a folder into
  your tree uses namespace aliasing.
- **Keys:** each folder version has a secret; epoch keys come from it by key regression, so holding the key for epoch
  *j* gives every earlier epoch and none later. A member with access until *T* gets the last epoch key that ends by
  *T*. That's why new files lock with no transaction.
- **Arkiv** holds eight entity types, all sealed: `cloak.file`, `cloak.welcome`, `cloak.keycopy`, `cloak.roster`,
  `cloak.rotation`, `cloak.refresh`, `cloak.link`, `cloak.tomb`. Anyone can write an entity a query matches, so every
  read goes through a validator that asks the folder's `DriveRegistry` whether the creator held the right role at the
  entity's creation time.
- **Swarm** holds only padded ciphertext (64 KB to 32 MB buckets), uploaded through the API with a signature from a key
  that has WRITE right now.

Details: [`docs/plan/CLOAKROOM_PLAN.md`](docs/plan/CLOAKROOM_PLAN.md) (design), [`docs/protocol.md`](docs/protocol.md).

## Repository

| Path | What |
|---|---|
| `contracts/` | `DriveRegistry.sol` (Foundry; unit, fuzz, invariant and fork tests against live Sepolia ENSv2) |
| `packages/core/` | The protocol and `createDriveClient` (keys, epochs, stealth shares, Arkiv, validator, Swarm, ENS) |
| `packages/platform/` | Anon-RPC wiring (web and extension harnesses), encrypted IndexedDB, extension storage, the inbox |
| `packages/ui/` | Shared React components (access tickets, share dialog, members, receipts, public view) |
| `apps/web/` | The website and installable phone app (Next.js static export, so it also runs from Swarm) |
| `apps/extension/` | Chrome extension (WXT, MV3) |
| `apps/api/` | The relayer API (Hono) |
| `infra/bee/` | A private Bee node on Fly.io |
| `arkiv/` | Arkiv judging files |

## Run it

Needs Node 22+, pnpm 11, Foundry.

```bash
pnpm install
cd contracts && forge build && cd ..
pnpm -r test
```

**1. Contracts and names (once).** Put `SEPOLIA_RPC_URL`, `DEPLOYER_PRIVATE_KEY` and `RELAYER_PRIVATE_KEY` in the
repo-root `.env` (throwaway testnet keys), then:

```bash
pnpm --filter @cloakroom/core bootstrap
```

It deploys the `DriveRegistry` implementation, registers `cloakroom.eth` and `rooms.cloakroom.eth`, gives the relayer
only `ROLE_REGISTRAR` on both, writes the addresses to `contracts/deployments/sepolia.json`, and prints the Etherscan
verify command. Check with any address: `cast call <registry> "wasAllowed(address,uint256,uint64)" …`.

**2. API.** Copy `apps/api/.env.example` to `apps/api/.env` and fill it in, then
`pnpm --filter @cloakroom/api start` (or deploy with `apps/api/fly.toml`). The relayer needs Sepolia ETH and tGLM.

**3. Website.** Copy `.env.example` values into `apps/web/.env.local`; `NEXT_PUBLIC_API_URL` and
`NEXT_PUBLIC_BEE_URL` are the API's URL, `NEXT_PUBLIC_ARKIV_RPC_URL` is `<API URL>/arkiv-rpc`. Then
`pnpm --filter @cloakroom/web dev`, or deploy `apps/web` to Vercel (`apps/web/vercel.json`).

**4. Extension.** `apps/extension/.env` (see its `.env.example`), then `pnpm --filter @cloakroom/extension zip`.

**5. End-to-end check.** With the API running and `API_URL` set: `pnpm --filter @cloakroom/core e2e`. Three random
identities run the whole story (room, upload, share, expiry, a locked file, removal, public view) and every
transaction link is appended to `docs/evidence.md`.

### One runnable Arkiv query

Every file entry of a folder, as anyone can read it:

```ts
import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { eq } from "@arkiv-network/sdk/query";
import { addr } from "@arkiv-network/sdk/schema";
import { FileSchema } from "@cloakroom/core";
import { http } from "viem";

const arkiv = createPublicClient({ chain: rabdi({ accessKey }), transport: http(`https://rpc.rabdi.db-chain.testnet.arkiv.network/${accessKey}`) });
const files = await arkiv.select().from(FileSchema).where(eq("folder", addr("0x<folder registry>"))).fetch();
// each row: folder, fileId, version, epoch, swarmRef, and meta (sealed: name, type, size and file key)
```

### Writer wallets

| Who | Writes | Address |
|---|---|---|
| Relayer (API) | Sepolia: names, room registries, drips. Arkiv: tGLM drips | from `RELAYER_PRIVATE_KEY`; shown at `GET /config` |
| Deployer | Sepolia: the implementation, `cloakroom.eth`, `rooms.cloakroom.eth` | from `DEPLOYER_PRIVATE_KEY` |
| Each user's K | Their own folders' entities | derived on the device |
| Each room's K_room | That room's entities | derived on the device; unlinked to K |
| Each member's stealth S | Their file entries | derived per share |

## State transitions

| Transition | Caller | Why they pay gas | If nobody calls |
|---|---|---|---|
| Claim name / create room | API registrar key | We sponsor onboarding | Bring your own `.eth`; rooms wait |
| Create folder | K | Wants a folder | – |
| `grantRolesUntil` + funding S | K, K_room or a manager | Wants to share | – |
| Access ends | Nobody | – | Ends automatically (epoch keys, `_getRoles`, Arkiv expiry) |
| Early removal + key refresh | A manager | Removes someone | Access lasts until the end date |
| Answer a refresh request | A folder manager's app | Keeps editors unblocked | Editors stay blocked; nothing leaks |
| `sweep` | Anyone | Frees a member slot | The grant stays stored but inactive |
| Arkiv writes and renewals | Writers and managers | Their own data | Entries expire after about 182 days; Swarm data stays until the stamp runs out |

No funds move in the product beyond gas dust.

## Who can link what

| Party | Can link | Can't link |
|---|---|---|
| Anyone (Sepolia, Arkiv, Swarm) | A named-drive folder to its owner's name; a member's random address to the folder or room it's in; counts, end dates, timing, padded sizes | A member's address to their name or to their other shares; a room to its owner |
| Owner and managers | Every member's address to their name (they shared it) | – |
| Other members | Members who chose to be visible | Hidden members |
| Our API | Public keys of named drives; upload and drip requests per key; weak timing hints | IPs (when routed); room → owner (proof-of-work requests, batched drips) |
| RPC providers / Anon-RPC exits | Requests, not who sent them | – |
| Our Swarm gateway, if HTTPS isn't routed | Your IP ↔ which encrypted blobs you fetched | Contents, names, identities |

## CROPS

- **C (censorship resistance):** we run the API (names, rooms, drips, uploads), the website host and the Swarm
  gateway; an Anon-RPC network can fail. If the API refuses you: bring your own `.eth` name and gas, and upload to any
  Bee node. If Vercel goes down: the same build runs from Swarm. If one private network fails: switch in Settings.
- **O (open source):** MIT. The contracts, the API, the apps and a Bee node config are all in this repo, and the whole
  stack runs from it (`bootstrap`, `apps/api`, `apps/web`, `infra/bee`).
- **P (privacy):** see "Who can link what". Sepolia and Arkiv calls go through Anon-RPC by default, isolated per room
  and per stealth address; the receipts panel marks every call "Private" or "Direct", and Settings shows whether file
  traffic is routed (measured with a real request, not assumed). Deliberately direct: the one bootstrap read of the
  worker's specifier, the wallet's own traffic (WalletConnect relay), and Swarm/API calls when the worker can't carry
  generic HTTPS. No analytics, trackers or third-party scripts: the page's security policy only allows our own scripts.
- **S (security):** keys come from one domain-bound signature (or a passkey) and stay on the device, encrypted at rest
  under a non-extractable key. In-app keys hold only gas dust, and the registry can't be upgraded by anyone. Dangerous
  roles stay with the main wallet. Every Arkiv entity is validated against onchain roles. Not audited.
- **Main compromise:** keys live in the browser so there are no wallet pop-ups. **Escape:** the main wallet keeps every
  dangerous power, and passkeys are planned.

## What's still exposed

- Whatever someone already opened, they keep. No system can stop a reader copying plaintext.
- Membership counts, end dates and timing are public, even in unlinked rooms.
- ENS caps each role at 15 holders per folder; `sweep` frees expired slots.
- ENSv2 on Sepolia is pre-launch, and our contract is unaudited.

## Credits

ENS Drive (`github.com/krishnan74/eth-tokyo-2026`) was a reference for ideas; no code was copied. Built with the
Fluidkey stealth-account-kit (MIT), the anon-rpc harnesses (MIT), the Arkiv SDK and Swarm's Bee. How AI was used:
[`AI_USAGE.md`](AI_USAGE.md).
