# Haven

**Share files with ENS names privately: hidden members, and new files lock out when access ends.**

Today, sharing sensitive files means a bad trade-off. Google Drive and DocSend see every file and every viewer. Putting
access onchain is worse: anyone can see which investors got your data room.

Haven lets you share files with any ENS name so that only the recipient knows:
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
| Phone | Open the website on your phone → Settings → **Install the app** (Android also gets "Share to Haven") |
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

## Add-ons

| Add-on | For | What it does |
|---|---|---|
| **Public key log** | Arkiv | Every ENS name has an append-only, signed key history on Arkiv (`cloak.keylog`). Sharing refuses a key that doesn't match its log or its `cloak.key` record, and warns when a recipient's key changed since you last shared. Profiles (`/u/?n=name`) show the 8-word fingerprint to compare in person, the history, devices, and any forged entries (ignored). |
| **Share with an ENS team** | ENS | Share with "everyone at `acme.eth`". The rule lives only in the folder's encrypted roster; each subname holder becomes an ordinary stealth member, and names that expire, move or are excluded lose access at the next sync. The chain only sees random addresses. |
| **Verified frontend** | EF, CROPS | Each release's file hashes are published on Arkiv and its build on Swarm (`cloakroom.eth`'s contenthash). The extension re-downloads and hashes the files a Haven tab loaded and hands keys only to a page that matches; otherwise a red warning offers the verified copy. Builds are reproducible (build id = git commit). |
| **Groups** | ENS | Make a group once (its own ENS registry, `g-….yourname.eth`), add people, then share any folder with it. Like a team rule, the group lives only in the folder's encrypted roster and each person becomes an ordinary stealth member; adding or removing someone in the group changes every folder shared with it at the next sync, with a key refresh on removal. |
| **Subfolders that follow their parent** | ENS | A subfolder can inherit its parent's members: the owner's app grants the same member addresses there, with the same roles and end dates, and key copies sealed with the member keys they already hold. Removing someone from the parent removes them from every inheriting subfolder in the same action, with a key refresh. (The contract has no parent link yet, so the app keeps them in step.) |
| **Live updates** | Swarm | Swarm GSOC "doorbells" on topics that change every epoch, so only current members can listen. A ring only says "check Arkiv now"; nothing is shown until the validator accepts it. Without them the app re-reads Arkiv every 30 seconds. |

**Limits, said plainly.**
- The extension catches files swapped for everyone (the Bybit case). A host that serves bad code only to one targeted
  visitor could still pass a re-download check; the Swarm copy, fixed by its hash, is the defence there.
- Revoking a device signs out the app on it; a copy of the seed taken from that device is not stopped.
- Team sharing works with names whose holders have a key log (Settings → "Link another ENS name"). Sync runs when an
  owner's or manager's app opens and every 15 minutes in the extension, so a removal takes effect at the next sync.
- Doorbell privacy: our Bee node (through the API) sees which chunk addresses a connection subscribes to, when, and the
  connection's IP: subscriptions are WebSockets, which the private network doesn't carry, so receipts mark them
  "Direct". Topics rotate every epoch and can't be tied to a folder without its keys.
- Future work: a zero-knowledge proof of membership in an ENS subtree, so team access needs no sync at all.

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
Set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` to enable RainbowKit's mobile wallet links and QR pairing;
without it, only injected browser wallets are available. WalletConnect pairing uses its relay service.

**4. Extension.** `apps/extension/.env` (see its `.env.example`), then `pnpm --filter @cloakroom/extension zip`.

**5. Website release (add-on F3).** Commit, then `pnpm --filter @cloakroom/web build` and
`pnpm --filter @cloakroom/core release publish <version>` with `RELEASE_PRIVATE_KEY` (R, funded with tGLM),
`DEPLOYER_PRIVATE_KEY`, `BEE_URL` and `POSTAGE_BATCH_ID` set. It uploads the site and its manifest to Swarm, writes
`cloak.release` and points `cloakroom.eth` at the Swarm copy; put the printed R address in the extension's
`WXT_RELEASE_SIGNER`. Anyone can rebuild the commit and run `release rebuild <rootHash>`; `release revoke <rootHash>`
withdraws a build.

**6. End-to-end check.** With the API running and `API_URL` set: `pnpm --filter @cloakroom/core e2e`. Three random
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

The public key log of a name, as any app can read it (forged entries are filtered by checking each `sig` against the
name's controller, as `checkKeyLog` in `@cloakroom/core` does):

```ts
import { asc, eq } from "@arkiv-network/sdk/query";
import { str } from "@arkiv-network/sdk/schema";
import { KeyLogSchema } from "@cloakroom/core";

const log = await arkiv.select().from(KeyLogSchema).where(eq("ensName", str("investor.cloakroom.eth"))).orderBy(asc("seq")).fetch();
// each row: ensName, seq, kind, spendingPublicKey, devicePublicKey, prevEntryKey, sig (EIP-712)
```

### Writer wallets

| Who | Writes | Address |
|---|---|---|
| Relayer (API) | Sepolia: names, room registries, drips. Arkiv: tGLM drips | from `RELAYER_PRIVATE_KEY`; shown at `GET /config` |
| Deployer | Sepolia: the implementation, `cloakroom.eth`, `rooms.cloakroom.eth` | from `DEPLOYER_PRIVATE_KEY` |
| Each user's K | Their own folders' entities | derived on the device |
| Each room's K_room | That room's entities | derived on the device; unlinked to K |
| Each member's stealth S | Their file entries | derived per share |
| Relayer (API), add-ons | Arkiv: `cloak.keylog` and `cloak.device` entries users signed (validity is the signature) | same relayer |
| Release key R | Arkiv: `cloak.release`, `cloak.unrelease` | from `RELEASE_PRIVATE_KEY`; the extension's `WXT_RELEASE_SIGNER` |
| Any rebuilder | Arkiv: `cloak.rebuild` | their own key |

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
| Key log entry (claim, new device, revoke, link a name) | The user signs; the API relays | Users can be shared with; we sponsor | No log: nobody can share with that name until the app writes it (it retries on every open) |
| Team sync (add, remove, refresh) | An owner's or manager's app | Keeps the team's access current | A gone name keeps access until the next sync; nothing new leaks after the refresh |
| Release, revoke, rebuild | R; anyone for rebuilds | Users can verify the site | The extension reports "unknown" and releases no keys |
| Doorbell ring | The writer's app | Members see changes in seconds | Members find them at the next 30 s re-read |
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
| Our API and Bee node (doorbells) | Your IP ↔ which doorbell chunk addresses you listen to, and when | Which folder a topic belongs to, or anything in a ring |
| Anyone (key log) | A name's public keys and when they changed; how many devices it lists | Device labels (sealed), which folders it's in |

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
  roles stay with the main wallet. Every Arkiv entity is validated against onchain roles. Recipients' keys are checked
  against their public key log before every share. Not audited.
- **Main compromise:** keys live in the browser so there are no wallet pop-ups. **Escape:** the main wallet keeps every
  dangerous power; with the extension, "Keep keys in the extension" means the website never stores them and gets them
  only after its code matches a published, reproducible release (the moment that matters: a swapped site gets a red
  warning instead of your keys).

## What's still exposed

- Whatever someone already opened, they keep. No system can stop a reader copying plaintext.
- Membership counts, end dates and timing are public, even in unlinked rooms.
- ENS caps each role at 15 holders per folder; `sweep` frees expired slots.
- ENSv2 on Sepolia is pre-launch, and our contract is unaudited.

## Credits

ENS Drive (`github.com/krishnan74/eth-tokyo-2026`) was a reference for ideas; no code was copied. Built with the
Fluidkey stealth-account-kit (MIT), the anon-rpc harnesses (MIT), the Arkiv SDK and Swarm's Bee. How AI was used:
[`AI_USAGE.md`](AI_USAGE.md).
