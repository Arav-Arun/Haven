# Cloakroom add-ons: build spec for a coding agent

**Audience:** a coding agent adding four features to the Cloakroom repo. Read this whole file before writing code.

**Context:** Cloakroom is private file sharing with ENS names. It has:
- stealth members;
- time-limited access through epoch keys;
- rooms as ENSv2 registries (`DriveRegistry`);
- file records on Arkiv;
- encrypted files on Swarm;
- every chain read through Anon-RPC.

The full design is in `CLOAKROOM_PLAN.md` (version 2). Build rules are in `PLAN_SHARED.md`, `PLAN_A.md` and `PLAN_B.md`.

**Rules that apply to every feature below:**
- **Ownership:** Person A's folders are `contracts/`, `packages/core/`, `apps/api/` and `arkiv/`. Person B's are
  `packages/platform/`, `packages/ui/`, `apps/web/`, `apps/extension/` and `infra/bee/`. Edit only your person's
  folders.
- **Frozen interface:** `packages/types/src/index.ts` may only be extended with new optional members, agreed by both
  people and committed on `main`. Each feature lists the additions it needs.
- **No faking or hard-coding:** no mock clients, seeded data, fake hashes or placeholder values in anything shown.
  Every value is read live from Sepolia, Arkiv or Swarm.
- **No plaintext anywhere public:** never put file contents, file names, folder names or secret keys into ENS, Arkiv,
  Swarm, logs or analytics.
- **Addresses:** use only the ENSv2 Sepolia addresses table in `CLOAKROOM_PLAN.md` section 6. Never guess one.
- **Solidity:** load the ethskills `security` and `testing` skills first.
- **Network:** all JSON-RPC goes through the `AnonFetch` transport. If something can't be routed, record it as a
  `direct` route in receipts and list it in the README.
- **Commits:** commit after each step's "Done when" check passes.
- **Checks:** items marked **(check)** must be verified first. If one fails, use the stated fallback and write the
  result in `docs/checks-a.md` or `docs/checks-b.md`.

**Build order:** F1 → F2 → F3 → F4. F1 is needed by F2 and F3.

---

## F1. Public key directory + key transparency log (Arkiv)

### Why
**Problem:** sharing encrypts to the recipient's public key, which today is the `hush.key` text record on their ENS
name. If that name, its resolver or our onboarding API were compromised, a sender would silently encrypt to an
attacker. Arkiv is also currently used only for private, encrypted data.

**Fix:** a **public, append-only key log on Arkiv, keyed by ENS name**.
- Any app (Cloakroom or anyone else) can look up a name's current key.
- Any app can see every past key change and detect a swap.
- Old device keys expire on their own.

This uses Arkiv for what it's best at: public, queryable, expiring data that anyone can read without asking us.

### Data model (Arkiv schemas, owned by Person A in `packages/core/src/arkiv.ts`)

| Schema | Owner (`$owner`) | Indexed columns | Stored columns | Expiry |
|---|---|---|---|---|
| `hush.keylog` | the user's drive key K | `ensName` str, `seq` u64, `kind` str (`"publish"` \| `"rotate"` \| `"revoke-device"`) | `spendingPublicKey` str (66 hex chars), `devicePublicKey` str (optional), `prevEntryKey` str (the previous entry's Arkiv key, or empty for the first), `sig` bytes | Maximum lifetime (about 182.5 days); renewed by the user's app |
| `hush.device` | the user's drive key K | `ensName` str, `deviceId` str | `devicePublicKey` str, `label` bytes (encrypted to the user), `sig` bytes | 90 days, renewed while the device is used. An expired device is no longer trusted |

**Signature:** `sig` is an EIP-712 signature by K over `{ensName, seq, kind, spendingPublicKey, devicePublicKey,
prevEntryKey}`.
- EIP-712 domain: `{name: "Cloakroom", version: "1", chainId: 11155111}`.
- K must be the root of the name's drive registry: check with `hasRootRoles` on the drive root registered under that
  name.

### Rules the client enforces (`packages/core/src/keydir.ts`)
1. **Valid chain.** A name's key history is the entries with matching `ensName`, ordered by `seq`. It's valid only
   if:
   - `seq` goes 0, 1, 2… with no gaps;
   - each `prevEntryKey` points to the previous entry;
   - every `sig` verifies;
   - the signer is the name's current drive-root K.

   An invalid chain gives `KEY_MISMATCH`.
2. **Agreement.** The current key = the last `publish` or `rotate` entry. It must equal the `hush.key` text record. If
   they differ, refuse to share and show "This name's key doesn't match its public log".
3. **Trust on first use.** Store each recipient's key fingerprint in the user's local `KeyValueStore` the first time
   you share with them. If a later lookup returns a different key, warn ("investor.eth's key changed on <date>") and
   require an explicit confirmation before sharing.
4. **Fingerprint for out-of-band checks:**
   - the first 4 bytes of `keccak256(spendingPublicKey)`, shown as 8 words from a fixed public word list;
   - shown on the profile page and in the share dialog, so two people can compare in person.
5. **Onboarding.** `claimName` writes `seq 0, kind "publish"` immediately after the name is registered.
   `signIn` on a new device writes a `hush.device` entry.

### Interface additions (`packages/types`, optional members)
```ts
export interface KeyLogEntry {
  seq: number;
  kind: "publish" | "rotate" | "revoke-device";
  spendingPublicKey: Hex;
  at: Timestamp;
  arkivKey: Hex;
}
export interface KeyInfo {
  ensName: string;
  current: Hex;
  fingerprint: string[];
  history: KeyLogEntry[];
  matchesEns: boolean;
  changedSinceLastShare: boolean;
}
// added to DriveClient:
lookupKey?(ensName: string): Promise<KeyInfo>;
confirmKeyChange?(ensName: string): Promise<void>;
listDevices?(): Promise<{ deviceId: string; label: string; lastSeen: Timestamp; expiresAt: Timestamp }[]>;
revokeDevice?(deviceId: string): Promise<void>;
```

### UI (Person B)
- **Profile page `/u/[name]`:** current key fingerprint (8 words), a key history timeline, devices (own profile
  only), and a "Verify in person" panel.
- **Share dialog:** fingerprint next to the recipient; a warning banner when the key changed or doesn't match ENS.
- **Settings → Devices:** list and revoke devices.

### Public reach (for `/arkiv/reach.md`)
- **Schema:** document the two schemas and one runnable query in the README, so any app can read the directory:
  ```ts
  select().from(KeyLog).where(eq("ensName", "investor.hushdrive.eth")).orderBy(asc("seq")).fetch()
  ```
- **Standalone use:** the directory is useful on its own, for example to any chat or email app that wants to encrypt
  to ENS names.

### Tests
- **Core:**
  - a valid chain is accepted;
  - a missing `seq`, a broken `prevEntryKey`, a bad signature or a wrong signer is each rejected;
  - a log that doesn't match `hush.key` blocks sharing;
  - a changed key triggers the warning;
  - an expired device is untrusted.
- **e2e:** claim a name → the log has `seq 0`; rotate → `seq 1`; a second client detects the change.

### Done when
A new name has a public log readable with the README query, and the share dialog shows its fingerprint. A forged
entry, written by a different wallet with the same `ensName`, is ignored and shown as such on the profile page.

---

## F2. Share with an ENS subtree, privately ("everyone at `acme.eth`")

### Why
Teams already manage people with ENS subnames (`priya.acme.eth`, `raj.acme.eth`). Sharing a room with "everyone
under `acme.eth`" means onboarding and offboarding happen in ENS, not in our app.

Doing it **onchain** ("room X → acme.eth") would publish the link between the room and the team. So the subtree rule
lives **only in the room's encrypted roster**, and the owner's app turns it into ordinary **stealth shares**, one per
subname holder. The chain only ever sees random member addresses.

### How it works (`packages/core/src/subtree.ts`, Person A)
1. **The rule.** Each rule is stored in the room's encrypted manager roster:
   ```ts
   { kind: "subtree", parent: "acme.eth", role, until, excluded: string[] }
   ```
   Nothing is written to ENS.
2. **Listing members.** Read the subnames of `parent` from its ENSv2 registry:
   - registration events through `eth_getLogs` on the parent's subregistry, and labels from the stock `LabelStore`
     **(check: confirm the event name and that labels can be read; fallback: the parent's registry `TransferSingle`
     events plus `LabelStore`)**;
   - for each label, keep it only if `ownerOf` is non-zero and it hasn't expired;
   - resolve the holder's key through F1 (`lookupKey`), and skip names with no valid key log.
3. **Sync** runs in `maintain()`: on the web app at every open, and in the extension's 15-minute background check.
   - **New holder** → a normal private share (stealth address, `grantRolesUntil`, welcome note, key copy). The roster
     records which ENS name each stealth address came from, so only managers know.
   - **Name gone** (expired, unregistered or transferred) → `removeMember` for its stealth address, which refreshes
     the keys of the room and its inheriting subfolders.
   - **Name on `excluded`** → treated exactly like "name gone".
4. **Until the sync runs:** if `maintain()` sees that a holder disappeared but can't refresh yet (no manager key on
   this device), it writes a `hush.refresh` request. Editors stay blocked with `REFRESH_PENDING` until a manager
   refreshes, so no new file leaks.
5. **Cap:** EAC allows at most 15 holders per role. Above 14 subtree members, refuse with a clear message ("Use
   several rooms, or split the team").
6. **Ownership change:** if a subname changes owner, the old holder's stealth address is removed and the new holder is
   shared fresh.

### Interface additions
```ts
export interface SubtreeRule {
  parent: string;
  role: Role;
  until: Timestamp | null;
  excluded: string[];
  memberCount: number;
  lastSyncedAt: Timestamp;
}
// added to DriveClient:
shareWithSubtree?(folder: Address, parentEnsName: string, opts: ShareOptions): Promise<SubtreeRule>;
listSubtreeRules?(folder: Address): Promise<SubtreeRule[]>;
excludeFromSubtree?(folder: Address, parentEnsName: string, memberEnsName: string): Promise<void>;
removeSubtreeRule?(folder: Address, parentEnsName: string): Promise<void>;
```

### UI (Person B)
- **Share dialog**, new tab "Team": enter `acme.eth` → preview "12 members found (2 have no Cloakroom key)" → role →
  end date → Share.
- **Members panel:** a "via acme.eth" badge; exclude a person; a "last synced" time with a "Sync now" button.
- **Explainer line:** "The chain only sees random addresses. It never learns this room is shared with acme.eth."

### Tests
- **Core:**
  - adding a subname → the next sync shares it;
  - revoking it → the next sync removes it and refreshes keys;
  - excluding a name → removed;
  - a transfer → old holder removed, new holder added;
  - more than 14 members → refused.
- **Property test (extends the existing one):** after a subname is revoked or excluded and the sync runs, no new file
  is readable with any key that holder received.
- **Privacy check:** after a subtree share, assert that no Sepolia or Arkiv record contains the parent name or its
  namehash in plaintext.

### Done when
On Sepolia, sharing a room with a real test parent name gives each subname holder access. Revoking one subname
removes them on the next sync, and a file uploaded after that is unreadable to them. Etherscan shows only random
member addresses.

**Future work (README only):** a zero-knowledge membership proof, so it's automatic without a sync.

---

## F3. Verified frontend in the extension (EF / CROPS)

### Why
Our biggest real risk: keys live in the browser. If the hosted website were swapped (a hacked host, DNS, CDN or
dependency), malicious JavaScript could steal keys. That's how the Bybit hack (Feb 2025) worked: attackers swapped
JavaScript on a wallet's website.

**Fix:**
1. Every release publishes the fingerprints of its files on **ENS** (contenthash of `hushdrive.eth`, pointing to the
   Swarm copy) and in a public **Arkiv release log**.
2. The **extension refuses to hand keys to a page** whose loaded scripts don't match a published release.

The EF's CROPS idea list includes "a tool that proves the shipped frontend matches the public repo".

### Release publishing (Person B: `apps/web` build script; Person A: the Arkiv schema in core)
1. **Reproducible build:** pin Node and pnpm versions; `next build` with `output: 'export'`; set
   `SOURCE_DATE_EPOCH`; fixed file ordering.
2. **Manifest:** `manifest.json` = `{ version, gitCommit, files: { "<path>": "<sha256 hex>" } }`, covering every
   `.js`, `.css` and `.html`; `rootHash = sha256(canonical JSON)`.
3. **Publish:**
   - upload the build to Swarm and set `hushdrive.eth`'s contenthash to it;
   - write an Arkiv `hush.release` entity:

     | Owner | Indexed | Stored | Expiry |
     |---|---|---|---|
     | release key R, a dedicated key held by the team multisig signer | `version` str, `rootHash` str | `gitCommit` str, `manifestSwarmRef` str, `sig` bytes | maximum lifetime, renewed |
4. **Rebuilders (optional, Should):** anyone can rebuild from `gitCommit` and post a `hush.rebuild` entity
   `{rootHash, matched: bool}` from their own wallet. The extension shows the count of independent matching
   rebuilds.
5. **Revoking a release:** a `hush.release-revoke` entity `{rootHash}` owned by R. The extension treats a revoked
   release as bad.

### Verification (Person B: `apps/extension`)
1. When a Cloakroom tab loads (match `NEXT_PUBLIC_APP_ORIGIN`), the extension:
   - collects every script and stylesheet URL the page loaded, from `performance.getEntriesByType("resource")` plus
     the DOM;
   - re-downloads each one from the extension's background context;
   - computes SHA-256 hashes.
2. **(check)** Chrome MV3 can't read response bodies directly, hence the re-download. Firefox can use
   `webRequest.filterResponseData`. State in the README: this catches swapped files served to everyone (Bybit-style),
   but not a host that serves malicious code only to one targeted visitor. The Swarm copy defends against that case.
3. Fetch the latest non-revoked `hush.release` through Anon-RPC, then its manifest from Swarm. Check that every
   loaded file's hash appears in the manifest and that `sig` verifies against R.
4. **Match** → a green badge ("Verified release v1.2, matches commit abc123, 2 independent rebuilds"). The extension
   then answers the page's key requests (pairing and signing, below).
5. **Mismatch** → a red badge, a full-page warning overlay ("This page's code doesn't match any published Cloakroom
   release"), and **no keys are released**. Offer "Open the verified copy", which loads the Swarm build by contenthash.
6. **Key custody:** when the extension is installed, it becomes the key holder.
   - The website asks the extension, through `chrome.runtime.sendMessage` from an allowed origin, to decrypt or sign
     on its behalf.
   - Raw keys are only exported to the page after verification passes.
   - Without the extension, the website works as before, and the UI shows "Install the extension to verify this page
     before using your keys".

### Interface additions (`packages/platform`, Person B)
```ts
export interface VerificationResult {
  status: "verified" | "mismatch" | "unknown";
  version?: string;
  gitCommit?: string;
  rebuilds?: number;
  mismatchedFiles?: string[];
}
export function verifyCurrentPage(): Promise<VerificationResult>;  // extension-side
export function requestVerifiedKeys(extensionId: string): Promise<Uint8Array | null>;  // page-side
```

### Tests
- A manifest builds identically twice: `rootHash` is equal, so the build is reproducible.
- The extension verifies an unmodified local build.
- Editing one byte in a served JS file produces a mismatch, and no keys are released.
- A revoked release produces a mismatch.

### Done when
On the deployed site, the extension shows "Verified". Then serve a build with one file altered, from a local test
host on an allowed origin: the extension blocks key release and shows the red overlay. **Record this as the CROPS
"moment it matters" in the demo video.**

---

## F4. Live updates with Swarm pub/sub

### Why
Today, "Shared with me", new files and refresh requests are found by polling Arkiv: on open, and every 15 minutes in
the extension. A Swarm pub/sub "doorbell" makes updates appear **within seconds**, without polling. It also uses Swarm
for more than storage.

**Arkiv stays the source of truth.** A doorbell only says "something changed, check Arkiv now". It never carries data
that must be trusted.

### Swarm technology to use
- **GSOC (Graffiti Single Owner Chunks):** a chunk address that anyone holding a shared key can write to. A Bee node
  lets clients **subscribe over a WebSocket** and receive each new write in real time.
- **(check):** with `@ethersphere/bee-js` 13.2.0 and our Bee node, confirm:
  - GSOC send works (`bee.gsocSend` or the current equivalent);
  - subscribe works (`bee.gsocSubscribe` or WebSocket `/gsoc/subscribe/{address}`);
  - the browser can reach the WebSocket through our gateway.
- **Fallback if GSOC isn't available:** Swarm **feeds** (single-owner, updatable pointers), polled every 30 seconds.
  That's still faster than today, and it stays Swarm-native.
- **Don't use PSS (Swarm's direct messaging):** it needs the receiver to run its own Bee node, and browsers don't.

### Topics, which hide who's talking
- **Room doorbell:** topic = `HKDF(E_v[current epoch], "doorbell")`. Only current members can compute it.
  - It **changes every epoch** with the key chain, so a member whose access ended can't keep listening.
  - Members subscribe to the current topic and resubscribe at each epoch change.
- **Personal inbox doorbell:** topic = `HKDF(spendingPrivateKey, "inbox", weekNumber)`, so only the user can compute
  it.
  - A sharer can't compute it, so sharers ring a **shared inbox doorbell** instead: topic =
    `HKDF(ECDH(sharer ephemeral key, recipient spendingPublicKey), "inbox")`.
  - It's written once per share, alongside the welcome note. The recipient learns the ephemeral public key only from
    the welcome note, so this doorbell can only speed up *later* events for that share.
  - **So in practice:** the first "Shared with me" is still found by the Arkiv scan. All later activity in that room
    comes through the room doorbell.
- **Payload:** `{type: "file" | "member" | "refresh" | "rotation", arkivKey}`, encrypted with the topic's key
  (AES-GCM) and padded to a fixed 256 bytes, so outsiders learn nothing from its size.

### Flow
1. A writer uploads a file and writes its Arkiv entity, then rings the room doorbell with `{type: "file", arkivKey}`.
2. Members' apps (web, PWA when open, and the extension in the background) receive it. Each app decrypts it, then
   fetches and **validates** that Arkiv entity with the normal validator before showing anything. A forged doorbell
   leads only to a rejected fetch.
3. Managers' apps receive a `refresh` doorbell and run `maintain()` at once, which shortens the group and subtree
   removal window from 15 minutes to seconds.

### Privacy notes (put in the README)
- Our Bee node sees which topic addresses a connection subscribes to and when, plus the connection's IP unless it's
  routed (Anon-RPC carries WebSockets only if the worker supports them; this is part of the any-HTTPS check).
- Topics rotate every epoch and can't be linked to a room without its keys.
- Mark the subscription as a `direct` route in receipts when it isn't routed.

### Who builds what
- **Person A:** `packages/core/src/doorbell.ts` with `ring(folder, event)` and `subscribe(folder, onEvent)`, the
  topic derivation, payload encryption and padding, and wiring `ring` into `upload`, `share`, `removeMember` and
  refresh.
- **Person B:**
  - the Bee node allows GSOC and WebSocket through the gateway (`infra/bee`);
  - web and PWA subscribe for the open room and "Shared with me" rooms;
  - the extension's background script keeps subscriptions for owned and shared rooms and shows notifications;
  - receipts show the doorbell route.

### Interface additions
```ts
export interface LiveEvent {
  folder: Address;
  type: "file" | "member" | "refresh" | "rotation";
  arkivKey: Hex;
  receivedAt: Timestamp;
}
// added to DriveClient:
subscribe?(folders: Address[], listener: (e: LiveEvent) => void): () => void;
```

### Tests
- A ring results in the subscriber seeing the event, followed by a validated Arkiv fetch.
- A forged payload, written with the right topic but pointing to an invalid entity, is ignored.
- After a member's end epoch, they can't derive the new topic.
- Every payload is exactly 256 bytes.

### Done when
Two browsers on the same room: an upload in one appears in the other within about 5 seconds with no refresh, and the
extension shows a notification. Disconnect the Bee WebSocket and the app falls back to polling, with no errors.

---

## Summary for the pitch

| Add-on | Sponsor | One line |
|---|---|---|
| F1 Key directory + transparency log | Arkiv | A public, ENS-keyed key log that any app can query, and that catches swapped keys |
| F2 Private ENS subtree sharing | ENS | Share with your whole ENS team; the chain never learns it's your team |
| F3 Verified frontend | EF / CROPS | The extension won't give your keys to a page that doesn't match the published, open-source build |
| F4 Swarm pub/sub doorbells | Swarm (ARKIV-5) | Live updates in seconds, on rotating topics only current members can compute |
