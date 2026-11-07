# Haven

**Private file sharing with ENS names. Nobody else can tell who you shared with, and access ends on its own.**

Sharing sensitive files today means a bad trade-off:
- **Google Drive and DocSend** see every file and every viewer.
- **Putting access onchain is worse:** anyone can read which investors got your data room.

Haven lets you share a folder with any ENS name so that only you and the recipient know:
- **Hidden members.** Each recipient gets access as a fresh random (stealth) address that can't be traced to their name.
- **Unlinked rooms.** A data room can have a random name that isn't connected to you at all.
- **Access that ends on its own.** When a member's time is up, every file added after that is unreadable to them. It's
  enforced by encryption, with no transaction.
- **Nothing in the clear.** Files are encrypted and padded in your browser, stored on **Swarm**, and indexed on **Arkiv**.
  Roles live in **ENSv2** on Sepolia.
- **Private by default.** Chain and database lookups go through **Anon-RPC**, so RPC providers can't see who is asking.

Built at **ETHGlobal Mumbai 2026** for three tracks:
- **ENS:** Best use of ENSv2.
- **Arkiv:** Build on Arkiv, plus the Swarm bonus.
- **Ethereum Foundation:** Anon-RPC, and CROPS.

License: [MIT](LICENSE).

---

## Try it

| Where | How |
|---|---|
| Website | Live link added at deploy time. Sign in with a wallet, or press **Try it** with no wallet (two fresh identities in one tab) |
| Phone | Open the website → Settings → **Install the app**. Android also gets "Share to Haven" |

Everything runs on Sepolia (ENSv2), Arkiv's Rabdi testnet and Swarm. Nothing is mocked or pre-seeded: every value on
screen is read live.

---

## How it works

```
 browser / phone                                                     public networks
 ┌───────────────────────────────┐   Anon-RPC (Nym/Nox/Tor)   ┌─────────────────────────────────────┐
 │ keys from one signature       │ ─────────────────────────▶ │ Sepolia: ENSv2 names, DriveRegistry │
 │ AES-256-GCM, padded buckets   │   one isolation key per    │   roles that end, access history    │
 │ stealth addresses (Fluidkey)  │   room and stealth address │ Arkiv: sealed file index, welcome   │
 │ validator for every entity    │                            │   notes, key copies, rosters        │
 └───────────────┬───────────────┘                            └─────────────────────────────────────┘
                 │ signed upload / ciphertext download         ┌─────────────────────────────────────┐
                 └───────────────▶ apps/api (relayer) ───────▶ │ Swarm: padded ciphertext            │
                                   /claim /room /drip          └─────────────────────────────────────┘
                                   /arkiv-rpc /upload /bytes
```

1. **Sign in.** You sign one domain-bound message (SIWE). Every Haven key is derived from that signature on your
   device: drive key, room keys and stealth keys. Keys never leave the device.
2. **Get a name.** Claim `you.haven.eth` for free (the API pays the gas and keeps no role afterwards), or bring your own
   ENSv2 `.eth`. Your resolver publishes a `haven.key` record, which is how anyone can share with you.
3. **Make a folder.** Every folder is an ENS name whose subregistry is a `DriveRegistry`, our one contract. A folder is
   either in your drive (`f-….you.haven.eth`) or an unlinked room (`r-….rooms.haven.eth`).
4. **Upload.** Files are encrypted and padded to fixed size buckets in the browser, then stored on Swarm. Arkiv gets a
   sealed entry pointing at the ciphertext.
5. **Share.** Type an ENS name and an end date. Haven:
   - derives a stealth address for the recipient;
   - grants it a role that ends on its own (`grantRolesUntil`);
   - funds it with gas dust if it's an editor or manager (viewers send no transactions);
   - leaves a sealed welcome note on Arkiv that only the recipient can find.
6. **Access ends.** Each folder's key changes every epoch, and keys only chain backwards. A member gets the last key
   that ends by their end date, so new files lock for them with no transaction. Their onchain role ends, and Arkiv
   deletes their key copy.

Design: [`docs/plan/HAVEN_PLAN.md`](docs/plan/HAVEN_PLAN.md). Protocol details: [`docs/protocol.md`](docs/protocol.md).

---

## Why each track's technology is used in a new way

### ENS: names as folders, and ENSv2 roles as file permissions

Most ENS integrations resolve a name to an address. Haven uses **ENSv2's registries and roles as the access-control
layer of a file system**:

- **Every folder is an ENS name with its own registry.** `DriveRegistry` extends ENSv2's `UserRegistry` (Enhanced Access
  Control) with three role bits: viewer, editor and manager.
- **Roles that expire.** ENSv2 roles are normally permanent until revoked. `grantRolesUntil(roles, account, until)`
  makes them end on their own, so access stops even if the owner forgets.
- **Onchain access history.** `wasAllowed(account, role, t)` answers "could this address do this at time *t*?" as a
  view call. Haven's Arkiv validator relies on it, and any other app can too.
- **Sharing to a name without revealing it.** The recipient's `haven.key` text record (on their own
  `PermissionedResolver`) lets the sharer derive a stealth address. Their name never appears onchain next to the
  folder.
- **More of ENSv2, used for real features:**
  - **Namespace aliasing** mounts a shared folder into your own tree.
  - **Expiring subnames** are share links that stop working at their end date.
  - **Groups** are their own registries (`g-….you.haven.eth`).
  - **"Share with everyone at `acme.eth`"** reads a team's subnames and keeps the folder's members in sync with them.
- **Safety.** The registry is frozen against upgrades. Dangerous powers stay with your main wallet, while the everyday
  key in the app holds only gas dust.
- **Gasless names without trusting us.** The API registers `you.haven.eth` and then holds no role on it. The client
  checks this onchain (`verifyClaim`).
- **No hardcoded values.** Addresses come from `contracts/deployments/sepolia.json`. Everything shown is read live from
  Sepolia.

Tested against the live Sepolia ENSv2 deployment with fork tests (`contracts/test/DriveRegistry.fork.t.sol`). What we
learned about the live contracts is in [`FEEDBACK-ENS.md`](FEEDBACK-ENS.md) and [`docs/checks-a.md`](docs/checks-a.md).

### Arkiv: a public database for private data, with writes checked against ENS

The Arkiv judging files are in [`arkiv/`](arkiv/):
- [`schema.md`](arkiv/schema.md)
- [`why-arkiv.md`](arkiv/why-arkiv.md)
- [`how-you-use-arkiv.md`](arkiv/how-you-use-arkiv.md)
- [`friction.md`](arkiv/friction.md)
- [`reach.md`](arkiv/reach.md)
- [`swarm.md`](arkiv/swarm.md)

What's different about this use:

- **Who may write is decided by ENS.** On Arkiv, anyone can create an entity that matches a query. So every Haven
  entity is created read-only, and the client accepts it only if its `$creator` held the right `DriveRegistry` role at
  `$createdAt`. Entries planted by anyone else never show. The Public view counts them.
- **Expiry means access ends.** A guest's key copy and welcome note expire when their access does. So even a new
  device can't fetch them afterwards, and the database deletes them, not our server. Share links expire the same way.
- **Private data in a public database.** Only addresses, random ids, version numbers and week buckets are indexed.
  Names, file metadata, member lists and keys are sealed (AES-256-GCM). Even so, every screen is one indexed query.
- **A public key directory keyed by ENS name** (`haven.keylog`). It's a signed, hash-chained history of each name's
  encryption key. Any app can look up a name's key, and tell a swapped key from a real change, with one Arkiv query.
- **A signed release log** (`haven.release`, `haven.rebuild`). Every website build is signed on Arkiv with its file
  hashes, and anyone who rebuilds a commit can post a matching `haven.rebuild`.
- **Swarm bonus.**
  - **Storage:** file contents live on Swarm as padded ciphertext, and Arkiv holds the sealed pointer.
  - **Live updates:** Swarm GSOC "doorbells" tell members to re-check Arkiv.
  - **The website itself** is also published to Swarm.

Thirteen entity types in total, defined in [`packages/core/src/arkiv.ts`](packages/core/src/arkiv.ts).

### Ethereum Foundation: Anon-RPC on every call, isolated per identity

- **On by default everywhere:**
  - **Coverage:** web and phone app.
  - **Traffic:** all JSON-RPC traffic for Sepolia (ENS, roles) and Arkiv.
  - **Networks:** Nym, Nox or Tor, chosen in Settings. Turning it off shows a red "Not private" banner.
- **One isolation key per room and per stealth address.** Even an Anon-RPC exit can't tell that two of your rooms, or
  two of your shares, belong to the same person.
- **Every call is labelled.** The receipts panel marks each request "Private" or "Direct". Settings checks whether file
  traffic can be routed by making a real request rather than assuming.
- **A signed, reproducible frontend.** Each release's file hashes are signed on Arkiv and the build is stored on
  Swarm, with `haven.eth`'s contenthash pointing to it, so anyone can rebuild a commit and check what is served.
- **No trackers.** There are no analytics and no third-party scripts. Fonts are self-hosted, and a strict
  Content-Security-Policy allows only our own scripts.

---

## CROPS

- **C:**
  - **What we control:** the website domain (Vercel), the API relayer (free names, rooms, gas drips, uploads, the Arkiv
    pass-through and the Swarm gateway), its Bee node, and the default RPC settings.
  - **If any of it goes away or refuses you:** open the same build from Swarm through `haven.eth`'s contenthash, bring
    your own `.eth` name and gas, use any Bee node, switch Anon-RPC network, or self-host the API from this repo. Your
    data stays on Sepolia, Arkiv and Swarm.
- **O:**
  - **License:** MIT.
  - **Run it yourself:** contracts, core, API, website, phone app and Bee node config all build and run from
    this repo alone. You supply only your own testnet keys, RPC URL, Arkiv access key and Swarm postage batch.
- **P:**
  - **RPC providers, Arkiv and the Anon-RPC exits** see requests but not who sent them. Requests are split by room and
    stealth address.
  - **Our API** sees:
    - claim requests (a public name and key);
    - Arkiv queries;
    - upload signers and Swarm references;
    - your IP only when traffic isn't routed (for example, doorbell WebSockets).
  - **Others:** Vercel sees page loads. WalletConnect's relay sees your wallet session if you use it. There are no
    analytics.
- **S:**
  - **Keys:** derived on the device from one domain-bound signature, never sent anywhere, and stored encrypted under a
    non-extractable WebCrypto key.
  - **Files:** every file and record is encrypted before it leaves the device.
  - **Trust assumptions:** you trust the website code (signed releases let you check it), your wallet, and the ENSv2 contracts
    (pre-launch). `DriveRegistry` is unaudited. Our API, the RPCs, Arkiv and Swarm only ever see ciphertext.

More detail on P is in "Who can link what" below.

---

## Run it

Needs Node 22+, pnpm 11 and Foundry.

```bash
git clone --recurse-submodules <this repo> && cd ETHGlobalMumbai
pnpm install
cd contracts && forge build && cd ..
pnpm -r test                     # every package's tests
```

**1. Contracts and names (once).**
1. Put these in the repo-root `.env`:
   - `SEPOLIA_RPC_URL`;
   - `DEPLOYER_PRIVATE_KEY` and `RELAYER_PRIVATE_KEY`: throwaway testnet keys, both funded with Sepolia ETH;
   - optionally `ETHERSCAN_API_KEY`.
2. Run:
   ```bash
   pnpm --filter @haven/core rehearse    # optional: the same steps on a local fork of Sepolia first
   pnpm --filter @haven/core bootstrap
   ```

The bootstrap:
- deploys the `DriveRegistry` implementation, and verifies it on Etherscan when `ETHERSCAN_API_KEY` is set;
- registers `haven.eth`, through ENSv2's ETHRegistrar, and `rooms.haven.eth`;
- gives the relayer only `ROLE_REGISTRAR` on both;
- writes every address to `contracts/deployments/sepolia.json`.

It's safe to re-run. `pnpm --filter @haven/core a1` then checks a claim, a room, mount aliasing and expiry live.

**2. API.**
1. Copy `apps/api/.env.example` to `apps/api/.env` and fill it in. The relayer needs Sepolia ETH and tGLM.
2. Run `pnpm --filter @haven/api start`, or deploy to Fly.io from the repo root:
   ```bash
   fly deploy --config apps/api/fly.toml --dockerfile apps/api/Dockerfile .
   ```

**3. Website and phone app.**
1. Copy the app values from `.env.example` into `apps/web/.env.local`:
   - `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_BEE_URL` are the API's URL;
   - `NEXT_PUBLIC_ARKIV_RPC_URL` is `<API URL>/arkiv-rpc`.
2. Run `pnpm --filter @haven/web dev`, or deploy `apps/web` to Vercel (`apps/web/vercel.json`).

Set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` for mobile wallet links. Without it, only injected browser wallets work.

**4. Website release (signed frontend).**
1. Commit, then run `pnpm --filter @haven/web build`.
2. Set `RELEASE_PRIVATE_KEY`, `DEPLOYER_PRIVATE_KEY`, `BEE_URL` and `POSTAGE_BATCH_ID`, then run
   `pnpm --filter @haven/core release publish <version>`.

This uploads the site to Swarm, writes `haven.release` on Arkiv and points `haven.eth` at the Swarm copy. Anyone can rebuild a commit and run
`release rebuild <rootHash>`.

**6. End to end.** With the API running and `API_URL` set, run `pnpm --filter @haven/core e2e`. Three random
identities run the whole story:
- a room and an upload;
- shares that end;
- a locked file;
- an early removal;
- the Public view.

Every transaction link is appended to `docs/evidence.md`.

### One runnable Arkiv query

Every file entry of a folder, as anyone can read it:

```ts
import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { eq } from "@arkiv-network/sdk/query";
import { addr } from "@arkiv-network/sdk/schema";
import { FileSchema } from "@haven/core";
import { http } from "viem";

const arkiv = createPublicClient({ chain: rabdi({ accessKey }), transport: http(`https://rpc.rabdi.db-chain.testnet.arkiv.network/${accessKey}`) });
const files = await arkiv.select().from(FileSchema).where(eq("folder", addr("0x<folder registry>"))).fetch();
// each row: folder, fileId, version, epoch, swarmRef, and meta (sealed: name, type, size and file key)
```

The public key log of a name, as any app can read it. To filter out forged entries, check each `sig` against the name's
controller, as `checkKeyLog` in `@haven/core` does:

```ts
import { asc, eq } from "@arkiv-network/sdk/query";
import { str } from "@arkiv-network/sdk/schema";
import { KeyLogSchema } from "@haven/core";

const log = await arkiv.select().from(KeyLogSchema).where(eq("ensName", str("investor.haven.eth"))).orderBy(asc("seq")).fetch();
// each row: ensName, seq, kind, spendingPublicKey, devicePublicKey, prevEntryKey, sig (EIP-712)
```

### Writer wallets

| Who | Writes | Address |
|---|---|---|
| Relayer (API) | Sepolia: names, room registries, gas drips. Arkiv: tGLM drips, and the `haven.keylog` / `haven.device` entries users signed | From `RELAYER_PRIVATE_KEY`; shown at `GET /config` |
| Deployer | Sepolia: the implementation, `haven.eth`, `rooms.haven.eth` | From `DEPLOYER_PRIVATE_KEY` |
| Each user's drive key K | Their own folders' entities | Derived on the device |
| Each room's key K_room | That room's entities | Derived on the device; not linked to K |
| Each member's stealth address | Their file entries | Derived per share |
| Release key R | Arkiv: `haven.release`, `haven.unrelease` | From `RELEASE_PRIVATE_KEY` |
| Any rebuilder | Arkiv: `haven.rebuild` | Their own key |

---

## Who can link what

| Party | Can link | Can't link |
|---|---|---|
| Anyone (Sepolia, Arkiv, Swarm) | A named-drive folder to its owner's name; a member's random address to the folder or room it's in; counts, end dates, timing, padded sizes | A member's address to their name or their other shares; a room to its owner |
| Owner and managers | Every member's address to their name (they shared it) | – |
| Other members | Members who chose to be visible | Hidden members |
| Our API | Public keys of named drives; Arkiv queries; upload and drip requests per key; weak timing hints | IPs (when routed); room → owner (proof-of-work requests, batched drips) |
| RPC providers / Anon-RPC exits | Requests, not who sent them | – |
| Our Swarm gateway, if HTTPS isn't routed | Your IP ↔ which encrypted blobs you fetched | Contents, names, identities |
| Our API and Bee node (doorbells) | Your IP ↔ which doorbell chunk addresses you listen to, and when | Which folder a topic belongs to, or anything in a ring |
| Anyone (key log) | A name's public keys and when they changed; how many devices it lists | Device labels (sealed), which folders it's in |

## State transitions

| Transition | Caller | If nobody calls |
|---|---|---|
| Claim name / create room | API registrar key (we sponsor onboarding) | Bring your own `.eth`; rooms wait |
| Create folder, share (`grantRolesUntil` + gas for editors) | The owner, or a manager | – |
| Access ends | Nobody | Ends automatically (epoch keys, role expiry, Arkiv expiry) |
| Early removal + key refresh | A manager | Access lasts until its end date |
| `sweep` (frees an expired member's slot) | Anyone | The grant stays stored but inactive |
| Key log entry | The user signs; the API relays | Nobody can share with that name until the app writes it (it retries on every open) |
| Team or group sync | An owner's or manager's app | A removed name keeps access until the next sync; nothing new leaks after the refresh |
| Arkiv writes and renewals | Writers and managers | Entries expire after about 182 days |

No funds move in the product beyond gas dust.

## What's still exposed

- **What someone already opened, they keep.** No system can stop a reader copying plaintext.
- **Metadata is public.** Membership counts, end dates and timing are public, even in unlinked rooms.
- **Keys live in the browser.** XSS or a malicious browser extension would expose them. They hold only gas dust and can't
  upgrade anything.
- **Member cap.** ENS caps each role at 15 holders per folder. `sweep` frees expired slots.
- **Not production-ready.** ENSv2 on Sepolia is pre-launch, and `DriveRegistry` is unaudited.

---
## Repository

| Path | What |
|---|---|
| `contracts/` | `DriveRegistry.sol` (Foundry: unit, fuzz, invariant and fork tests against live Sepolia ENSv2) |
| `packages/core/` | The protocol and `createDriveClient`: keys, epochs, stealth shares, ENS, Arkiv, validator, Swarm |
| `packages/platform/` | Anon-RPC wiring, encrypted IndexedDB |
| `packages/ui/` | Shared React components |
| `apps/web/` | Website and installable phone app (a Next.js static export, so it also runs from Swarm) |
| `apps/api/` | The relayer API (Hono) |
| `infra/bee/` | A Bee node on Fly.io |
| `arkiv/` | Arkiv judging files |
| `docs/` | Design, protocol, and the checks each of us ran |

## Credits

- **References:** ENS Drive (`github.com/krishnan74/eth-tokyo-2026`) was a reference for ideas. No code was copied.
- **Built with:** the Fluidkey stealth-account-kit (MIT), the Anon-RPC harnesses (MIT), the Arkiv SDK and Swarm's Bee.
- **AI:** how it was used is described in [`AI_USAGE.md`](AI_USAGE.md).
