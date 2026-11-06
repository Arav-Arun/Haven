# Hushdrive: shared rules for the two-person build

Both people read this file first, then their own plan (`PLAN_A.md` or `PLAN_B.md`). The design itself is in
`HUSHDRIVE_PLAN.md`; when this file and that one disagree, `HUSHDRIVE_PLAN.md` wins on design, and this file wins on
who does what.

## 1. How the split works

| | Person A: protocol | Person B: apps and infra |
|---|---|---|
| Owns these folders | `contracts/`, `packages/core/`, `apps/api/`, `arkiv/`, `docs/protocol.md`, `docs/checks-a.md`, `FEEDBACK-ENS.md` | `packages/platform/`, `packages/mock/`, `packages/ui/`, `apps/web/`, `apps/extension/`, `infra/bee/`, `README.md`, `AI_USAGE.md`, `docs/checks-b.md` |
| Builds | `DriveRegistry` and its tests; the real `DriveClient` (keys, epochs, stealth, ENS, Arkiv, Swarm client, validation); the API (claim, room, drip, upload) | Anon-RPC and storage adapters; a mock `DriveClient` for UI work; every screen on website, phone and extension; the Bee node; deploys |
| Never touches | The other person's folders | The other person's folders |

**How the two halves meet:** through one frozen file, `packages/types/src/index.ts` (section 3).
- A **implements** `DriveClient` for real.
- B **uses** it, starting with B's own mock version.
- B also gives A the `AnonFetch` and `KeyValueStore` adapters that the real client needs.

**Timeline** (hours from the start of hacking; shift to the real deadline):

| When | What |
|---|---|
| H0–H0.5 | **Step 0** (Person A): create the repo, the skeleton and the frozen interface; push to `main` |
| H0.5–H3 | First-hour checks, split as in section 7 |
| H3–H14 | Build on branches `plan-a` and `plan-b` |
| **H14** | **Checkpoint merge M1** (recommended; 1 hour, both people): B's web app switches from the mock to A's real client |
| H15–H30 | Build on branches again, rebased on `main` |
| **H30** | **Final merge M2** |
| H30–H36 | Fix integration bugs together, docs, video, submission |

You *can* skip M1 and merge only at the end, because the folders don't overlap and the interface is fixed. **Don't:**
the first real run always finds surprises, and M1 leaves time to fix them.

---

## 2. Step 0 (Person A, before either starts; about 30 minutes)

1. Create an empty public GitHub repo `hushdrive` at the event (From Scratch track). Clone it.
2. Create this skeleton:
   ```
   package.json            {"name":"hushdrive","private":true,"packageManager":"pnpm@9",
                            "scripts":{"build":"pnpm -r build","test":"pnpm -r test","typecheck":"pnpm -r typecheck"}}
   pnpm-workspace.yaml     packages: ["packages/*", "apps/*"]
   tsconfig.base.json      strict, ES2022, moduleResolution "bundler"
   .gitignore              node_modules, .env*, !.env.example, out, dist, .next, .output, contracts/out, contracts/cache
   .env.example            (section 4, exactly)
   LICENSE                 MIT
   CLAUDE.md               (section 5, exactly)
   docs/plan/              copies of HUSHDRIVE_PLAN.md, PLAN_SHARED.md, PLAN_A.md, PLAN_B.md
   packages/types/         package.json {"name":"@hush/types","version":"0.0.0","type":"module",
                                         "exports":"./src/index.ts"}, src/index.ts (section 3, exactly)
   packages/core/          package.json name "@hush/core"      (empty src/, A fills it)
   packages/platform/      package.json name "@hush/platform"  (empty src/, B fills it)
   packages/mock/          package.json name "@hush/mock"      (empty src/, B fills it)
   packages/ui/            package.json name "@hush/ui"        (empty src/, B fills it)
   apps/web/ apps/extension/ apps/api/ contracts/ arkiv/ infra/bee/   (empty, with a .gitkeep)
   ```
3. Commit with "Step 0: workspace skeleton and frozen interface". Push to `main`.
4. **Person A:** `git checkout -b plan-a`. **Person B:** clone, then `git checkout -b plan-b`.
5. Each person starts their Claude agent in the repo with the prompt at the top of their plan.

---

## 3. The frozen interface: `packages/types/src/index.ts`

**Never edit this on a branch.** If it must change, both people agree in chat; one person changes it on `main`; both
rebase. Add things; don't rename or remove them.

```ts
// Frozen shared interface between Plan A (implements DriveClient) and Plan B (uses it).
export type Address = `0x${string}`;
export type Hex = `0x${string}`;
/** Unix time in seconds. */
export type Timestamp = number;

export type Role = "viewer" | "editor" | "manager";
export type AccessVia = "owner" | "direct" | "parent" | "group";
export type FolderKind = "drive" | "room" | "group";
export type PrivateNetwork = "nym" | "nox" | "tor" | "off";

// ---------- Platform adapters (B implements, A consumes) ----------

export interface AnonStatus {
  network: PrivateNetwork;
  state: "connecting" | "ready" | "failed" | "off";
  detail?: string;
}

export interface AnonFetch {
  /** Anonymized fetch. When network is "off" this is plain fetch. */
  fetch: typeof fetch;
  /** Same, but calls under different keys must not be linkable (anonOptions.isolationKey). */
  isolated(key: string): typeof fetch;
  /** True only if the worker forwards any HTTPS request, not just JSON-RPC (first-hour check). */
  supportsAnyHttps: boolean;
  status(): AnonStatus;
  onStatus(listener: (status: AnonStatus) => void): () => void;
  close(): void;
}

export interface KeyValueStore {
  get(key: string): Promise<Uint8Array | null>;
  set(key: string, value: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
}

// ---------- Domain types ----------

export interface Identity {
  ensName: string | null;            // "alice.hushdrive.eth" once claimed
  wallet: Address | null;            // main wallet W (null for passkey or "Try it")
  driveKey: Address;                 // K
  spendingPublicKey: Hex;            // published as the hush.key text record
}

export interface Access {
  role: Role | "owner";
  until: Timestamp | null;
  via: AccessVia;
}

export interface Folder {
  registry: Address;                 // the folder's ID everywhere
  ensName: string;                   // "f-7k2x.alice.hushdrive.eth" or "r-9f3k2x.rooms.hushdrive.eth"
  displayName: string;               // decrypted ("Series A")
  kind: FolderKind;
  parent: Address | null;
  inherit: boolean;                  // fixed at creation
  myAccess: Access | null;
  version: number;                   // current key version
  refreshPending: boolean;           // true = editors are blocked until a manager refreshes keys
}

export interface FileEntry {
  fileId: string;
  folder: Address;
  /** false when the file exists but you have no key for its epoch (e.g. written after your access ended). */
  readable: boolean;
  name: string | null;               // null when not readable
  mime: string | null;
  size: number | null;               // real size; padded size is in PublicView
  version: number;
  epoch: number;
  uploadedAt: Timestamp;
  uploadedBy: { address: Address; label: string };  // "you", a visible ENS name, or "private member"
  swarmRef: Hex;
  arkivKey: Hex;
}

export interface Member {
  address: Address;                  // the random address the chain shows
  label: string;                     // ENS name if visible to you, else "private member"
  role: Role;
  until: Timestamp | null;
  via: "direct" | "group";
  hiddenFromMembers: boolean;
  needsGas: boolean;                 // editors/managers below the top-up threshold
}

export interface ShareOptions {
  role: Role;
  until: Timestamp | null;
  hideFromMembers: boolean;
}

export interface IncomingShare {
  folder: Folder;
  sharedBy: string;                  // owner's ENS name, or "unlinked room"
  role: Role;
  until: Timestamp | null;
  firstSeenAt: Timestamp;
}

export interface ShareLink {
  url: string;
  ensName: string;
  expiresAt: Timestamp;
}

export type ReceiptStep =
  | { kind: "sepolia-tx" | "arkiv-tx"; label: string; hash: Hex; explorerUrl: string; ok: boolean }
  | { kind: "swarm"; label: string; ref: Hex; paddedBytes: number; ok: boolean }
  | { kind: "check"; label: string; detail: string; ok: boolean }
  | { kind: "route"; label: string; route: "anon" | "direct"; network: PrivateNetwork; isolationKey?: string };

export interface Receipt {
  id: string;
  action: string;
  startedAt: Timestamp;
  steps: ReceiptStep[];
  done: boolean;
  error?: DriveErrorCode;
}

export interface PublicView {
  folder: Address;
  ensName: string;
  /** Plain sentence: what anyone can see, and what they can't. */
  summary: string;
  ownerVisible: boolean;             // false for rooms
  members: { address: Address; roles: Role[]; until: Timestamp | null }[];
  arkiv: { key: Hex; schema: string; owner: Address; expiresAt: Timestamp; bytes: number; explorerUrl: string }[];
  swarm: { ref: Hex; paddedBytes: number }[];
  ignoredWrites: number;             // entities hidden by the validator
  directCalls: string[];             // traffic that did not go through Anon-RPC, if any
}

export type DriveErrorCode =
  | "NOT_SIGNED_IN"
  | "WALLET_NOT_SUPPORTED"           // contract wallet, or signatures differ
  | "KEY_MISMATCH"                   // derived key != hush.key on this name
  | "NAME_TAKEN"
  | "NO_HUSH_KEY"                    // recipient has no hush.key record
  | "NOT_AUTHORIZED"
  | "EXPIRED"
  | "REFRESH_PENDING"                // editors blocked until a manager refreshes keys
  | "TOO_LARGE"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "NETWORK"
  | "UNKNOWN";

export class DriveError extends Error {
  readonly code: DriveErrorCode;
  constructor(code: DriveErrorCode, message?: string) {
    super(message ?? code);
    this.name = "DriveError";
    this.code = code;
  }
}

// ---------- Client ----------

export interface DriveConfig {
  anon: AnonFetch;
  storage: KeyValueStore;
  appOrigin: string;                 // used in the sign-in message
  apiUrl: string;
  beeUrl: string;
  sepoliaRpcUrl: string;
  arkivRpcUrl: string;
  arkivAccessKey: string;
  demoMode: boolean;                 // true = 1-minute epochs
}

export type SignInSource =
  | { kind: "wallet"; address: Address; signatures: Hex[] }   // 2 signatures on the first device, else 1
  | { kind: "passkey"; prfOutput: Uint8Array }
  | { kind: "random" }                                          // "Try it"
  | { kind: "seed"; seed: Uint8Array };                         // extension pairing

export interface DriveClient {
  // session
  signInMessage(address: Address): string;
  /** True when this address has no hush.key yet, so the UI must collect two signatures. */
  needsSecondSignature(address: Address): Promise<boolean>;
  signIn(source: SignInSource): Promise<Identity>;
  restore(): Promise<Identity | null>;
  signOut(): Promise<void>;
  exportSeed(): Promise<Uint8Array>;                 // extension pairing only
  isNameAvailable(label: string): Promise<boolean>;
  claimName(label: string): Promise<Identity>;

  // folders and rooms
  listFolders(parent: Address | "root" | "rooms" | "groups"): Promise<Folder[]>;
  getFolder(folder: Address): Promise<Folder>;
  createFolder(parent: Address | "root", displayName: string, opts?: { inherit?: boolean }): Promise<Folder>;
  createRoom(displayName: string): Promise<Folder>;
  createGroup(displayName: string): Promise<Folder>;

  // files
  listFiles(folder: Address): Promise<FileEntry[]>;
  upload(folder: Address, file: Blob, name: string, onProgress?: (fraction: number) => void): Promise<FileEntry>;
  download(file: FileEntry): Promise<Blob>;
  downloadFolder(folder: Address, onProgress?: (fraction: number) => void): Promise<Map<string, Blob>>;
  deleteFile(file: FileEntry): Promise<void>;
  listVersions(folder: Address, fileId: string): Promise<FileEntry[]>;

  // sharing
  lookupRecipient(ensName: string): Promise<{ ensName: string; canReceive: boolean }>;
  /** recipient: an ENS name, or a group folder's registry address. */
  share(folder: Address, recipient: string, opts: ShareOptions): Promise<Member>;
  listMembers(folder: Address): Promise<Member[]>;
  removeMember(folder: Address, member: Address): Promise<void>;
  sharedWithMe(opts?: { since?: Timestamp }): Promise<IncomingShare[]>;
  /** Owner/manager housekeeping: gas top-ups, open refresh requests, renewals. Returns what it did. */
  maintain(): Promise<Receipt[]>;

  // links and mounts (Should)
  createLink(file: FileEntry, expiresAt: Timestamp): Promise<ShareLink>;
  openLink(url: string): Promise<{ file: FileEntry; blob: Blob }>;
  mount(folder: Address, label: string): Promise<void>;

  // transparency
  publicView(folder: Address): Promise<PublicView>;
  onReceipt(listener: (receipt: Receipt) => void): () => void;
}

export type CreateDriveClient = (config: DriveConfig) => DriveClient;
```

**Where things come from:**
- `@hush/core` exports `createDriveClient: CreateDriveClient` (A).
- `@hush/mock` exports `createMockDriveClient: CreateDriveClient` (B).
- `@hush/platform` exports `createAnonFetch(...)`, `createWebStorage()` and `createExtensionStorage()` (B).
- The web app and the extension pick the client with `NEXT_PUBLIC_DRIVE_MODE` / `WXT_DRIVE_MODE` (`mock` or `real`).

---

## 4. `.env.example` (complete; nobody edits it after Step 0)

New variables go in a package-local `.env.example`.

```
# --- apps (B) ---
NEXT_PUBLIC_DRIVE_MODE=mock                # mock | real
NEXT_PUBLIC_DEMO_MODE=true                 # 1-minute epochs
NEXT_PUBLIC_APP_ORIGIN=https://hushdrive.vercel.app
NEXT_PUBLIC_API_URL=
NEXT_PUBLIC_BEE_URL=
NEXT_PUBLIC_SEPOLIA_RPC_URL=
NEXT_PUBLIC_ARKIV_RPC_URL=https://rpc.rabdi.db-chain.testnet.arkiv.network
NEXT_PUBLIC_ARKIV_ACCESS_KEY=
NEXT_PUBLIC_PRIVATE_NETWORK=nym            # nym | nox | tor | off
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
# the extension uses the same names with the WXT_ prefix

# --- api (A) ---
RELAYER_PRIVATE_KEY=
ROOM_POW_DIFFICULTY=20
DRIP_SEPOLIA_WEI=
DRIP_ARKIV_WEI=
BEE_URL=
POSTAGE_BATCH_ID=

# --- contracts (A) ---
SEPOLIA_RPC_URL=
DEPLOYER_PRIVATE_KEY=
ETHERSCAN_API_KEY=
```

---

## 5. Repo `CLAUDE.md` (rules for both coding agents)

```markdown
# Hushdrive: rules for coding agents

Two people build this repo in parallel on separate laptops. Their branches are merged later.

- Person A (branch `plan-a`) owns: contracts/, packages/core/, apps/api/, arkiv/, docs/protocol.md,
  docs/checks-a.md, FEEDBACK-ENS.md.
- Person B (branch `plan-b`) owns: packages/platform/, packages/mock/, packages/ui/, apps/web/, apps/extension/,
  infra/bee/, README.md, AI_USAGE.md, docs/checks-b.md.
- Edit only the folders your person owns. If you need something from the other side, write it in
  docs/requests-<a|b>.md on your branch, and tell your human.
- packages/types/src/index.ts is FROZEN. Never edit it on a branch.
- Root files (package.json, pnpm-workspace.yaml, tsconfig.base.json, .env.example, CLAUDE.md) are frozen after Step 0.
  Add dependencies only in your own package's package.json.
- Read docs/plan/HUSHDRIVE_PLAN.md (design), docs/plan/PLAN_SHARED.md (rules) and your own plan before starting.
  Follow your plan's steps in order. After each step, run its "Done when" check, then commit.
- Commit at least once an hour with a clear message, and push your branch. Judges check commit history.
- Never commit .env files, private keys or seeds.
- Solidity: load ethskills `security` and `testing` first. Addresses only from HUSHDRIVE_PLAN.md section 6, never
  guessed.
- Never put plaintext file contents, names or keys into Arkiv, ENS, Swarm, logs or analytics.
- No third-party scripts, trackers or analytics in any client.
```

---

## 6. Rules while building

- **Disjoint folders.** Merges then have no conflicts except `pnpm-lock.yaml`. Resolve it by taking `main`'s version
  and running `pnpm install`.
- **Asking for things:** write what you need from the other person in `docs/requests-a.md` or `docs/requests-b.md` on
  your branch, and message them.
- **B never waits for A.** Everything B builds works against `@hush/mock` until M1.
- **A never waits for B.** A's end-to-end script runs in Node with plain `fetch` (a passthrough `AnonFetch`) and an
  in-memory `KeyValueStore`.
- **Commit at least hourly, and push.** If a laptop dies, the branch survives.

---

## 7. First-hour checks: who does which

Numbers refer to `HUSHDRIVE_PLAN.md` section 17. Write results (pass/fail, tx hashes, timings) in
`docs/checks-a.md` or `docs/checks-b.md`.

| Person | Checks |
|---|---|
| A | 1 app names · 2 `DriveRegistry` hooks, bits, upgrade freeze, initializer · 3 resolver · 4 aliasing and expired subname · 5 Arkiv · 8 Fluidkey kit · 9 wallet determinism |
| B | 6 Bee node and postage · 7 Anon-RPC (JSON-RPC, any-HTTPS, isolation key, speed) · 10 faucets · WalletConnect project ID · Chrome Web Store developer account (a human pays the one-time fee) |

**If a check fails:** the person who ran it posts the fallback they're switching to (each is in `HUSHDRIVE_PLAN.md`)
in chat, before H3.

---

## 8. Handoffs

| By | From → to | What |
|---|---|---|
| H3 | B → A | Anon-RPC result: which network is the default, and `supportsAnyHttps` (true/false) |
| H4 | B → A | `BEE_URL` and `POSTAGE_BATCH_ID` (a private message, not committed) |
| H4 | A → B | Arkiv access key and app names registered (for B's `.env`) |
| H8 | B → A | `@hush/platform` working on `plan-b` (A can copy the built file locally to test; don't commit it) |
| H12 | A → B | API URL live; contract addresses in `packages/core/src/addresses.ts` |
| H14 | both | **M1** |
| H28 | B → A | Swarm reference of the web build, so A sets `hushdrive.eth`'s contenthash |
| H30 | both | **M2** |

---

## 9. Merging

### M1 at H14 (checkpoint, about 1 hour, both people together)
```bash
git checkout main && git pull
git merge --no-ff origin/plan-a -m "M1: protocol"
git merge --no-ff origin/plan-b -m "M1: apps"
git checkout origin/main -- pnpm-lock.yaml 2>/dev/null; pnpm install
pnpm -r typecheck && pnpm -r test
NEXT_PUBLIC_DRIVE_MODE=real pnpm --filter web dev
git push origin main
# afterwards, each person:
git checkout plan-a && git rebase origin/main     # or plan-b
```

**M1 is done when, on the real client in the browser, through Anon-RPC:**
- sign in (two signatures) → claim a name → create a room;
- upload a file → reload → it opens;
- a second browser profile signs in and gets "Shared with me" for a share.

### M2 at H30 (final)
Same commands, `-m "M2: …"`. Then run the integration checklist together:
- [ ] Every flow in `HUSHDRIVE_PLAN.md` section 13 works on the website with `DRIVE_MODE=real`.
- [ ] The demo script (section 18) runs start to finish with demo epochs. The "locked" file shows on the phone.
- [ ] The extension, paired with the website: badge, right-click save, the `maintain()` top-up.
- [ ] The PWA installs on an Android phone and an iPhone; Android "Share to Hushdrive" works.
- [ ] The Public view shows the summary sentence; the receipts show routes; direct calls are listed if any.
- [ ] The validator hides a planted bad write (an expired editor writing, or a stale version).
- [ ] `pnpm -r test` and `forge test` pass; the contracts are verified on Etherscan.
- [ ] The Vercel deploy and the Swarm copy load; "Try it" works with no wallet.

### After M2 (H30–H36)

| Who | What |
|---|---|
| A | `/arkiv/*.md` (6 files), `FEEDBACK-ENS.md`, `docs/protocol.md`, README sections A owns (stock vs new, state transitions, writer wallets, runnable query, "who can link what"), sets the contenthash |
| B | README top and how-to, the `CROPS` section, `AI_USAGE.md`, the extension zip release, the demo video (3 min or less), and the Swarm timestamp in it for `swarm.md` |
| Both | Run `ethskills:qa`; rehearse the pitch; submit (ENS, Arkiv and EF picks; tick EF-3 too) |
