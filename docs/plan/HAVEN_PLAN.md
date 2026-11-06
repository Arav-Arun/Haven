# Haven: build plan (ETHGlobal Mumbai 2026)

Version 2, written 2026-11-06. Version 2 fixes the eight problems an outside review found in
version 1; section 22 maps each one to its fix. The two-person build split is in `PLAN_SHARED.md`, `PLAN_A.md` and
`PLAN_B.md`. Prize details are in `PRIZES.md`, past winners in `SHOWCASE.md`.

- **Track:** From Scratch (new repo at the event, so we stay Finalist-eligible).
- **Reference:** ENS Drive (`github.com/krishnan74/eth-tokyo-2026`, ENS-1 2nd at Tokyo 2026) is our reference for
  ideas and ENSv2 gotchas. Its repo has no licence, so we write our own code and credit it in the README.
- **Status of facts:** addresses, packages and ENS contract functions were checked on 2026-11-06 unless marked
  **(check)**. Every (check) is in the first-hour list (section 17).
- **No faking, no hardcoding.** There is no mock client, no seeded or placeholder data and no fake hash anywhere. Every value the apps show is read live from Sepolia, Arkiv or Swarm. Only configuration (contract addresses, endpoints, Anon-RPC worker specifiers) is fixed, and it comes from env or one config file.
- **Nothing here is foolproof.** Section 21 lists what still leaks or can go wrong, so we say it before judges do.

---

## 1. Pitch

**Tagline (under 100 characters):** Share files with ENS names privately: hidden members, and new files lock out when access ends.

**Paragraph:** Today, sharing sensitive files means a bad trade-off.
- Google Drive and DocSend see every file and every viewer.
- Putting access onchain is worse: the whole world can see which investors got your data room.

Haven lets you share files with any ENS name so that only the recipient knows:
- Each recipient is added as a fresh random address that can't be traced to their name.
- For a data room, you can use an unlinked room that isn't connected to your name at all.
- Files are encrypted in your browser, stored on Swarm, and listed on Arkiv.
- When someone's access ends, every file added after that is unreadable to them, enforced by encryption, with no
  transaction. What they already opened, they keep, as with any file you share.
- Every chain lookup goes through Anon-RPC, so RPC providers don't learn who is looking.

**Words to use:** private sharing, data room, hidden members, new files lock out when access ends.
**Never say:** "access disappears" or "they lose the files" (not true for files they already opened), or "Google Drive
for ENS" as a headline.

---

## 2. Prizes (three partner picks)

| Pick | Prize | What we show | Required extras |
|---|---|---|---|
| ENS | **ENS-1** ($7k; 1st $3k) | `DriveRegistry`, an ENSv2 registry with: access that expires; an onchain access history (`wasAllowed(account, role, time)`); rights flowing down the folder tree; groups; frozen against upgrades; dangerous powers kept on the main wallet. Plus stealth members, unlinked rooms, mounting (namespace aliasing) and expiring links (subnames) | Sepolia, ENSv2 central, **no hard-coded values**, live demo link, open-source repo |
| Arkiv | **ARKIV-2** ($4k; 1st $3k) **+ ARKIV-5** Swarm bonus ($500); one pick | The drive's data (files, welcomes, key copies, rosters, key rotations, links) lives in Arkiv. Users see expiry. ENS's onchain access history decides whose writes count. Encrypted files on Swarm | `/arkiv/schema.md`, `friction.md`, `reach.md`, `why-arkiv.md`, `how-you-use-arkiv.md`, `swarm.md`; README lists writer wallets, one runnable query, AI usage; open-source licence |
| Ethereum Foundation | **EF-1** Anon-RPC ($5k; 1st $2.5k). Also tick **EF-3** (CROPS); EF places us in at most one | All JSON-RPC traffic (ENS on Sepolia, Arkiv) from web, phone and extension goes through Anon-RPC by default, with one isolation key per stealth address. Anything not routed is listed in the README and shown in the app | README `CROPS` section, FOSS licence, video of 3 min or less showing the moment privacy matters, no trackers |

The **Finalist** award is separate: $1k per person plus $500 travel for a team of 3–5.
If we win first place in all three picks, the most we'd make is about $9k.

---

## 3. Features

Columns: **Web** = website; **Phone** = the same site installed as a PWA; **Ext** = browser extension.
**Must** = the demo needs it. **Should** = build if on schedule. **Stretch** = only if ahead.

| # | Feature | What the user sees | Web | Phone | Ext | Priority |
|---|---|---|---|---|---|---|
| 1 | Safe sign-in | Sign one domain-bound message (twice on the first device, to check the wallet signs the same way each time). Wallets that can't are refused and pointed to passkey | ✓ | ✓ | pairs with web | Must |
| 2 | Free name | Claim `you.haven.eth` with no gas, or bring your own ENSv2 `.eth` | ✓ | ✓ | – | Must |
| 3 | Two kinds of folder | **In my drive** (listed under your name) or **Unlinked room** (random name, not connected to you; recommended for data rooms) | ✓ | ✓ | view | Must |
| 4 | Upload | Drag and drop; many files; up to 25 MB each; encrypted and padded in the browser | ✓ | ✓ camera/files | popup drop, right-click | Must |
| 5 | Preview and download | Images, PDF, video and text, decrypted locally; "download whole folder" | ✓ | ✓ | side panel | Must |
| 6 | Private share | Type an ENS name; pick Viewer / Editor / Manager and "access until"; editors and managers are funded by the sharer automatically | ✓ | ✓ | – | Must |
| 7 | Shared with me | Finds private shares by checking welcome notes locally | ✓ | ✓ | badge + notification | Must |
| 8 | Access that ends on time | Countdown on each member. At the end, new files are unreadable to them (encryption), the onchain role ends, and their key copy expires. No transaction | ✓ | ✓ | ✓ | Must |
| 9 | Same rights down the tree | Access to a folder covers its subfolders unless the subfolder was created as "separate access" | ✓ | ✓ | ✓ | Must |
| 10 | Remove someone | Revoke now; the folder and its subfolders get new keys in the same action | ✓ | ✓ | – | Must |
| 11 | Public view | Shows what outsiders see (Etherscan, Arkiv explorer) next to what you see, plus a plain sentence of what that metadata reveals | ✓ | compact | – | Must |
| 12 | Receipts panel | Each action: tx hashes, which permission check ran, Swarm reference, and which network route each call took (Anon-RPC or direct) | ✓ | compact | – | Must |
| 13 | Private network by default | Anon-RPC on; picker for Nym / Nox / Tor; red "Not private" banner if off | ✓ | ✓ | ✓ | Must |
| 14 | New-device recovery | Sign in on a new device and everything comes back, including unlinked rooms | ✓ | ✓ | ✓ | Must |
| 15 | Extension basics | Popup (recent files, shared with me, upload), right-click "Save to Haven", badge for new shares, background check that tops up members' gas for owners | – | – | ✓ | Must |
| 16 | Installable phone app | Home-screen icon, full screen, app shell works offline | – | ✓ | – | Must |
| 17 | Groups | Share once with a group; add people in one place; removing someone triggers a key refresh in every folder shared with the group | ✓ | ✓ | – | Should |
| 18 | Expiring links | Link for one file, for people with no wallet; the key sits in the `#fragment`, never sent to a server | ✓ | ✓ | copy link | Should |
| 19 | Member list for members only | Members see each other unless marked "hide from other members" | ✓ | ✓ | – | Should |
| 20 | Versions | Upload a new version; see history | ✓ | ✓ | – | Should |
| 21 | Mount a folder | Add someone's folder into your own ENS tree (namespace aliasing). Public, so the UI warns; not allowed for unlinked rooms | ✓ | – | – | Should |
| 22 | Android share target | "Share to Haven" from any app's share sheet | – | ✓ Android | – | Should |
| 23 | Side panel and Save page | Full drive in Chrome's side panel; save the current page privately | – | – | ✓ | Should |
| 24 | Passkey sign-in | No wallet needed; keys from a passkey (WebAuthn PRF). Phishing-resistant by design | ✓ | ✓ | pairs | Should |
| 25 | Search | Local search over decrypted names | ✓ | ✓ | ✓ | Should |
| 26 | App copy on Swarm | Same app served from Swarm via the ENS name; works if Vercel is down | ✓ | – | – | Should |
| 27 | Unlinkable room tokens | Blind-signed tokens so even our API can't link a room to the account that made it | ✓ | ✓ | – | Should |
| 28 | Gmail button | "Insert Haven link" in Gmail compose | – | – | ✓ | Stretch |
| 29 | Firefox build | Signed XPI | – | – | ✓ | Stretch |
| 30 | Files as ENS names | Every file resolves as an ENS name with no token, answered from Arkiv (CCIP-Read) | ✓ | – | – | Stretch |

**Dropped from version 1:** opt-in "seen" receipts. They would need viewers to write, and viewers must never need gas
(section 8).

---

## 4. Architecture

```
  Website · Phone (PWA) · Extension          one shared core package:
                                             keys · epochs · stealth · ENS · Arkiv · Swarm · validation
                │
                │  JSON-RPC (Sepolia, Arkiv) goes through the Anon-RPC worker's fetch;
                │  Swarm and API calls too if the worker allows any HTTPS request (first-hour check)
                ▼
  ENSv2 on Sepolia                Arkiv testnet (rabdi)                 Swarm (our Bee node)
  names, folders, rooms, roles,   files, welcomes, key copies,          encrypted, padded file contents
  access history (DriveRegistry)  rosters, rotations, links (expire)

  apps/api (Hono on Fly.io): free names, rooms, batched gas drips to public keys only, upload proxy.
  Holds no user keys and no role on any user folder.
```

| Onchain (ENSv2, Sepolia) | Arkiv | Swarm | Only on the device |
|---|---|---|---|
| Names, folder and room registries, who holds which role, from when and until when (history), groups, links, mounts | File entries, welcome notes, key copies, rosters, key rotations, link bundles | Encrypted, padded file contents; a copy of the app | Keys, decrypted names, search index |

**One custom contract:** `DriveRegistry`. Everything else is stock ENSv2 (UserRegistry, PermissionedResolver,
VerifiableFactory, Universal Resolver) or offchain.

---

## 5. Sign-in and identity keys

### The signed message
The signed message is SIWE-format, so the wallet itself checks the domain. It is fixed (a constant nonce and
issued-at), so it always produces the same keys:

```
haven.vercel.app wants you to sign in with your Ethereum account:
0xYourAddress

Create your Haven keys. Anyone who gets this signature can read all your Haven files.
Only sign this on https://haven.vercel.app.

URI: https://haven.vercel.app
Version: 1
Chain ID: 11155111
Nonce: havenkeysv1
Issued At: 2026-11-06T00:00:00.000Z
```

- **Phishing:** MetaMask and other SIWE-aware wallets warn when the domain doesn't match the site asking
  **(check which wallets)**. The app also shows its own warning before asking. The Swarm copy of the app gets the
  wallet's warning by design, so passkey is its recommended sign-in. The passkey path can't be phished: WebAuthn is
  bound to our domain.
- **Wallets that don't sign the same way twice:**
  - First device: the app asks for the signature **twice** and compares the two. It refuses if they differ, or if the
    address has contract code (Safe, Coinbase Smart Wallet and other smart-contract wallets), and points the user to
    passkey sign-in.
  - Every later device: the derived spending public key must equal the `haven.key` record on the user's ENS name.
    Otherwise the app stops with "This sign-in gives different keys; your files are safe; use your original method".
    It never silently creates a second identity.
- **Derived from the seed** (the signature, or the passkey PRF output):
  - spending key `s` and viewing key, via the Fluidkey kit's `generateKeysFromSignature` (passkey path: our own HKDF);
  - drive key `K = HKDF(seed, "drive")`;
  - room keys `K_room[n] = HKDF(seed, "room", n)`.
- **Recovery:**
  - Rooms are found again by checking `n = 0, 1, 2…` until no room exists.
  - The user's own key copies are sealed with `HKDF(K or K_room, folder)`.
- **Hot keys hold little:** K and room keys sign inside the app with no pop-ups, but hold only gas dust and **can't
  upgrade anything** (section 6).
- **Storage:** IndexedDB, wrapped by a non-extractable WebCrypto key. The extension uses `chrome.storage.session` by
  default. Strict CSP, no third-party scripts, pinned dependencies.

---

## 6. ENS design

### Names

| Name | What it is | Who holds what |
|---|---|---|
| `haven.eth` | App name, registered through `ETHRegistrar`. Subregistry: stock `UserRegistry` proxy. Contenthash: app copy on Swarm | Team multisig. API registrar key: only `ROLE_REGISTRAR` |
| `rooms.haven.eth` | Parent of all unlinked rooms | Team multisig. API registrar key: only `ROLE_REGISTRAR` |
| `alice.haven.eth` | A user. Resolver: Alice's own PermissionedResolver (`haven.key`). Subregistry: her drive root (a `DriveRegistry`) | Name owned by Alice's wallet W (dangerous powers); drive root everyday roles to K |
| `<random>.alice.haven.eth` | A folder in her drive: a `DriveRegistry` | W: dangerous powers. K: everyday roles |
| `r-<random>.rooms.haven.eth` | An unlinked room: a `DriveRegistry` with no link to Alice | `K_room[n]` (fresh key) |
| `l-<random>.<folder>` | Expiring link subname | K |
| `<label>.priya.haven.eth` → another folder's registry | Mount (namespace aliasing); not allowed for rooms | Priya's K |

### Roles in each `DriveRegistry`

| Role | Bit | Meaning |
|---|---|---|
| `ROLE_DRIVE_READ` | `1 << 40` | Viewer |
| `ROLE_DRIVE_WRITE` | `1 << 44` | Editor |
| `ROLE_DRIVE_SHARE` | `1 << 48` | Manager: adds and removes members, rotates keys |

- **Free bits:** stock registry roles at `48b3e2d` use bits 0, 4, 8, 12, 16, 20, 24, 28 (admin), 32, 36, 120 and 124.
  Confirm 40/44/48 are free **(check)**.
- **Power split (fixes the hot-key upgrade risk):**
  - **K** gets the everyday roles: `ROLE_REGISTRAR` (create subfolders and links), the three drive roles and their
    admin bits.
  - **W** (the main wallet) gets the dangerous roles, on the folder's name and registry: `ROLE_SET_SUBREGISTRY`,
    `ROLE_SET_PARENT`, `ROLE_UNREGISTER`, `ROLE_CAN_TRANSFER_ADMIN`.
  - **Rooms** have no W (that would link them), so `K_room` holds everything, and the freeze below still applies.
  - **Passkey users:** W is a second key from the passkey, used only after a fresh passkey prompt.

### `DriveRegistry` (our only contract)

`contract DriveRegistry is UserRegistry`. Proxies are deployed through the stock `VerifiableFactory`, with our own
initializer that calls the internal `_grantRoles` the same way `UserRegistry.initialize` does. At `48b3e2d`:
- `_checkRoles` calls `hasRoles`, which reads `_getRoles` for ROOT and for the resource;
- grant and revoke run the hooks `_onRolesGranted` and `_onRolesRevoked`;
- `_authorizeUpgrade` requires `ROLE_UPGRADE` on root.

| Feature | How |
|---|---|
| **Frozen against upgrades** | `_authorizeUpgrade` can't be overridden (not `virtual`), so our `_getRoles` **always strips `ROLE_UPGRADE` and its admin bit from every account**. Nobody, including K, can ever pass the upgrade check. No upgrade role is granted at initialisation either. Test: `upgradeToAndCall` reverts for every caller |
| **Access that expires** | `grantRolesUntil(resource, roleBitmap, account, until)`, with the same caller check as `grantRoles`. `_getRoles` drops drive bits once `block.timestamp >= until` |
| **Access history (fixes "past permissions need an archive node")** | The `_onRolesGranted` / `_onRolesRevoked` hooks append intervals `{roles, from, until, endedAt}` per account (at most 8 per account). `wasAllowed(account, roleBitmap, uint64 t)` is an ordinary view call against the latest block: no archive node and no log scanning. Events `AccessGranted` / `AccessEnded` allow rebuilding from logs as a fallback |
| **Same rights down the tree** | Chosen once, at creation (`inherit` can't be toggled later, so the history stays simple). `_getRoles(ROOT, a)` and `wasAllowed` add the parent's drive bits. The parent comes from stock `getParent()` and counts only if `parent.getSubregistry(label) == this`; at most 3 levels up |
| **Groups (Should)** | `addGroup(address)` (root role; at most 4 per folder). The folder grants drive bits to the group's address, which takes one holder slot. A member's group access at time t = the folder's interval for the group covers t **and** `group.wasAllowed(member, READ, t)` |
| **Freeing slots** | `sweep(resource, account)`: anyone may call it to revoke an expired grant, which frees one of the 15 holder slots. The history stays |
| **Views** | `accessOf(account) → (roles, from, until, via)` and `wasAllowed(...)` |

**Safety rules:**
- Inherited and group roles **only ever add the three drive bits**. Never admin bits, upgrade bits or registry roles.
- External calls (parent, groups) are low-level `staticcall`s with a gas cap and a return-length check, and they fail
  closed. ENS Drive found that `try/catch` doesn't catch return data it can't decode.

**Tests (Foundry; load `ethskills:security` and `ethskills:testing` first):**
- **Unit:** expiry; renewal; `sweep`; history intervals; `wasAllowed` before, during and after; inheritance on/off at
  creation; the back-pointer check; groups; K can't touch W's roles; upgrade reverts for everyone.
- **Fuzz:** times, bitmaps, hostile parent and group return data.
- **Invariants:**
  - an account is never allowed after `min(until, endedAt)`;
  - `wasAllowed` matches the live check at the current time;
  - no non-drive bit is ever inherited;
  - upgrade is impossible.
- **Fork test** through the Sepolia `VerifiableFactory`.

### ENSv2 Sepolia addresses (docs.ens.domains/learn/deployments, 2026-11-06)

Keep these only in `packages/core/src/addresses.ts`. Re-check before deploying.

| Contract | Address |
|---|---|
| ETHRegistrar | `0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3` |
| ETHRegistry | `0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4` |
| RootRegistry | `0xb458d6a3a77919449d03e7a6903c26827c1ec43f` |
| UserRegistryImpl | `0x9bd8a88719068d09ecee662f36c0e3856708366a` |
| PermissionedResolverImpl | `0x115eb53f0c60696633855f90b138178fb40b2b2c` |
| VerifiableFactory | `0xda70306c98e97ece36f997a21368e53298572991` |
| UniversalResolverV2 | `0x24e1d8e068620b647ca097f961a61055f4f42d72` |
| LabelStore | `0xed8246ff02203a4d4cb262bd78beaa7408a57cae` |
| ContractNamer | `0x606f2453484f4fa85b6e5fdb0e0bf777064bf9f3` |

- **Source:** `ensdomains/contracts-v2@48b3e2d` (the latest commit, 2026-07-03).
- **viem gotcha (from ENS Drive):** pass `UniversalResolverV2` explicitly; viem's built-in address targets another
  deployment.

---

## 7. Encryption and keys per folder (fixes the editor-leak bug)

### Keys

| Key | What it is | Who gets it |
|---|---|---|
| **Folder secret** `FS_v` | Random 32 bytes per folder per version v. Each version has a start time `t0_v` and an epoch length L (1 hour by default; 1 minute in demo mode) | Managers |
| **Epoch keys** | Key regression: `E_v[N] = HKDF(FS_v, "chain")` and `E_v[i-1] = SHA-256(E_v[i])`, with N = 8,760 epochs. Epoch i covers `[t0_v + iL, t0_v + (i+1)L)`. Holding `E_v[j]` lets you compute every earlier epoch key but **no later one** | Everyone with read access, up to their own end |
| **Member key** `MK_S` | Random 32 bytes per member per folder. Sent once inside the welcome note. Copied into the managers' roster (sealed with `HKDF(FS_v, "managers")`) so any manager can send that member new keys later | The member and the managers |
| **File key** | Random AES-256-GCM key per file. The content is padded, then encrypted. The name, type, size and file key are encrypted with `E_v[i]` for the epoch the file was written in | Whoever holds that epoch key |

### Who gets which epoch key
- A member with access until T gets one key copy per version: `E_v[j]`, where j is the last epoch that ends **at or
  before** T. They never get a key past their end; at worst they lose up to one epoch early.
- Members with no end date get `E_v[N]`. Managers get `FS_v`.
- **So when access ends, new files lock them out automatically, with no transaction and no waiting.** A file written
  after T is encrypted with a later epoch key they can't compute.

### Rules for writing and reading
1. **Write rule.** Before every upload, the app:
   - loads the folder's latest version (`haven.rotation`) and any open refresh requests;
   - encrypts with the **latest version's current epoch key**;
   - if a refresh request is open, editors are blocked with "Waiting for the owner to refresh access", while a
     manager's app refreshes first, automatically.
2. **Read rule.** Validation hides (and counts in the Public view) any file that:
   - was written by someone without WRITE at its creation time (`wasAllowed`); or
   - used a version that was no longer the latest when it was created; or
   - claims an epoch more than one epoch away from its creation time (no back-dating); or
   - was written by a non-manager while a refresh request was open.
3. **Early removal = refresh in the same action.** The manager's app:
   - revokes the role onchain;
   - creates version v+1 (new random secret, `t0` = now);
   - writes key copies for the remaining members from the roster's member keys;
   - does the same for every subfolder that inherits.

   Removal is always done by a manager, so there is no window where editors write with an old key.
4. **Subfolders** have their own independent secrets; nothing is derived from the parent key.
   - Inherited members get their own key copies in each inheriting subfolder. The manager's app writes them when
     sharing the parent, when creating the subfolder, and on every refresh (cascade).
   - A subfolder created as "separate access" gets no inherited copies.
5. **Groups (Should).** A folder shared with a group gives the group's managers `E_v[j_group]`. The group manager's app
   re-seals `E_v[min(j_group, j_member)]` for each group member, which key regression allows. Removing someone from a
   group early opens a **refresh request** in each shared folder. Rule 1 blocks editors there until a folder manager
   refreshes. A folder manager's app (web or extension background check) refreshes as soon as it sees the request.
6. **Links** carry a per-file bundle sealed with the link secret in the URL fragment. They don't use epochs.

### Padding and invariant
- **Padding:** every encrypted file is padded to the next of 64 KB, 256 KB, 1 MB, 4 MB, 16 MB or 32 MB, so exact sizes
  don't show.
- **Invariant test** (core, property-based, with fast-check), over random sequences of shares, expiries, removals,
  group changes and uploads: **no file written after a member's end, or after their removal, decrypts with any key that
  member ever received.**

### Private share to `vc.haven.eth`
1. Read `haven.key` (spending public key P) through the Universal Resolver.
2. Pick a random ephemeral key e. Compute `S = generateStealthAddresses({ spendingPublicKeys: [P], ephemeralPrivateKey: e })`.
   The welcome note is sealed with `HKDF(ECDH(e, P))`.
3. Onchain: `grantRolesUntil(S)`. For editors and managers, the sharer's key also sends S its gas in the same action
   (section 8).
4. On Arkiv: a `haven.welcome` (holds `e·G` and the sealed `MK_S`), a `haven.keycopy` for S, and a roster update.
5. **The recipient**, for each welcome note:
   - gets S's private key from `generateStealthPrivateKey({ spendingPrivateKey, ephemeralPublicKey })`;
   - unseals `MK_S`, then its key copies.

   It reads with isolation key = S.

**Libraries:** `@fluidkey/stealth-account-kit` 1.1.1 (MIT), `@noble/secp256k1`, `@noble/hashes`, WebCrypto
(AES-GCM, HKDF).

---

## 8. Gas without linking anyone (fixes stealth funding)

| Who | Needs gas? | Funded by | What the funding reveals |
|---|---|---|---|
| Viewer (stealth S) | **Never.** Reading is free view calls | – | Nothing |
| Editor (stealth S) | Arkiv tGLM to write file entries | **The sharer's key, in the same action as the grant.** Topped up by an owner or manager app (web, or the extension's background check) | That this folder's owner funded this member address, which the onchain grant already shows. Not who the member is |
| Manager (stealth S) | Arkiv tGLM and Sepolia ETH | Same as editor | Same |
| Drive key K | Sepolia and Arkiv | API drip | Nothing new: K is already public as the owner of a named drive |
| Room key `K_room` | Sepolia and Arkiv | API drip, **sent in batches every 10 minutes**, never from K | API-side timing at most; see section 9 and blind tokens (feature 27) |

- **Never fund a stealth address from the recipient's own wallet or K.**
- **The README gets the "who can link what" table** (section 21).

---

## 9. Unlinked rooms (fixes "the owner's activity is public")

- A room is `r-<random>.rooms.haven.eth`, a `DriveRegistry` whose root is `K_room[n]`, a fresh key from the seed.
  No record, transaction or gas payment connects it to `alice.haven.eth`, K or W.
- **Creation goes through the API** (`POST /room`): the API registers the label and deploys the registry, so `K_room`
  needs no funds at creation. Gas for later grants comes in a batched drip.
- **What the API learns:**
  - The API receives requests through Anon-RPC when generic HTTPS is supported, so it doesn't see IPs.
  - Room requests need a token. Must: proof-of-work plus a daily cap. Should (feature 27): a blind-signed token
    issued to claimed names, which the API can't link back to its account when redeemed.
- **The Public view states exactly what is visible.** For example: "Anyone can see that this room exists (created 6
  Nov), that it has 7 members (3 until 14 Nov), and that it holds 12 files of about 40 MB padded. They can't see who
  owns it, who the members are, or any names or contents."
- **Mounting is disabled for rooms;** it would publish a link. Members see the owner's name only if the owner chooses
  to show it.

---

## 10. Arkiv design

**Connection and limits:**
- SDK `@arkiv-network/sdk` 1.0.1 with `viem`; chain `rabdi({ accessKey })` (chain 7794095,
  `https://rpc.rabdi.db-chain.testnet.arkiv.network`); gas in tGLM.
- Limits: 32 attributes per entity; `str` up to 128 bytes; `bytes` up to 128 KiB per entity; maximum lifetime about
  182.5 days (renewed by managers' apps); 100 rows per page.

| Schema | Owner (`$owner`) | Indexed | Stored (all sealed) | Expires | Valid only if the owner had (at `$createdAt`) |
|---|---|---|---|---|---|
| `haven.file` | the writer | `folder` addr, `fileId` str, `version` u64, `epoch` u64 | `swarmRef` str, `meta` bytes | 182 days, renewed | WRITE, plus the read rules in section 7 |
| `haven.welcome` | the sharer | `folder` addr, `bucket` u64 (week) | `ephemeralPub` str, `sealedMemberKey` bytes | the member's end, or 182 days at most | SHARE |
| `haven.keycopy` | the sharer | `folder` addr, `recipient` addr, `version` u64 | `sealed` bytes | the member's end | SHARE |
| `haven.roster` | a manager | `folder` addr, `version` u64 | `managers` bytes, `members` bytes | renewed | SHARE |
| `haven.rotation` | a manager | `folder` addr, `version` u64 | `t0` u64, `epochLength` u64 | renewed | SHARE |
| `haven.refresh` | a group manager | `folder` addr | `reason` bytes | 30 days | SHARE on the group |
| `haven.link` | the sharer | `link` str (namehash) | `bundle` bytes | link end | SHARE |
| `haven.tomb` | the writer | `folder` addr, `fileId` str | – | 182 days | WRITE |

- **Why validation matters:** the SDK's own docs warn that anyone can write an entity a query matches. Every read
  passes the validator, which calls `wasAllowed` (section 6) as a normal view call.
  - Check that `$createdAt` can be selected and what unit it's in **(check)**. Fallback: the creating transaction's
    block time.
- **Expiry users can see:** guests' key copies vanish at their end; links stop; welcome notes expire, which keeps the
  scan small on phones.
- **Runnable README query:** `select().from(Files).where(eq("folder", "0x…")).fetch()`.
- **Access key:** Arkiv's guidance is to keep it on a backend, never in a browser bundle. So it lives only on our API,
  which exposes `POST /arkiv-rpc`, a JSON-RPC pass-through that adds the key server-side. Browsers, phones and the
  extension point their Arkiv client at that URL, through Anon-RPC like any other RPC. The pass-through forwards only
  the read methods the app uses plus `eth_sendRawTransaction` (writes are signed in the browser), and logs nothing.

---

## 11. Swarm

- **Bee node:** `ethersphere/bee` in Docker on Fly.io (persistent volume, Gnosis RPC), funded with xDAI and xBZZ by a
  human.
- **Postage:** the docs' example (depth 20, amount 100000000) is 0.010 BZZ for about 4 GB and about 6 hours, so buy
  enough for at least 7 days. Also ask the Swarm team for a batch. Record the batch ID and buyer in
  `/arkiv/swarm.md`.
- **Upload:** browser → `apps/api` `/upload` (signed by a key with WRITE) → Bee → reference. Only padded ciphertext
  leaves the browser.
- **Download:** Bee `/bytes/<ref>`. "Download whole folder" is the default when opening a folder, so the node can't
  tell which single file you wanted.
- **App copy:** upload the static export (`--index-document index.html`) and set `haven.eth`'s contenthash. Check
  that absolute asset paths load from the gateway (a subdomain gateway such as bzz.link, or Next `basePath`)
  **(check)**.
- **Rejected:** Swarm ACT (every reader would need a Bee node).
- **Library:** `@ethersphere/bee-js` 13.2.0.

---

## 12. Anon-RPC (fixes "may not carry most of the traffic")

- **Packages:** `@anon-rpc/browser-harness` 0.4.0 (web and phone) and `@anon-rpc/browser-extension-harness` 0.4.0
  (extension).
- **Workers** (from `adopters.json5`): Nym `0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0` (mainnet), Nox
  `0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A` (Sepolia), tor-js `0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e` (mainnet;
  demo gateway "may disappear").
- **Always routed:** all JSON-RPC (Sepolia and Arkiv), through a viem `custom({ request })` transport over
  `worker.fetch`. That covers every sensitive lookup:
  - name and `haven.key` lookups;
  - roles and `wasAllowed`;
  - file lists, welcome scans and key copies;
  - all writes.
- **One isolation key per stealth address and per room**, so the network can't link your shares to each other.
- **First-hour check:** does each worker forward any HTTPS request (Bee `/bytes`, our API), and does it honour
  `isolationKey`?
  - **If yes:** route Swarm and API calls too, so 100% is routed.
  - **If no:**
    - Ask the EF team for a worker setting that allows our Bee gateway and API.
    - Until then, Swarm and API calls go direct, **and we say so.** The README lists them as a deliberate exclusion
      (EF-1 allows stated exclusions), the receipts panel marks each direct call, and the Settings page explains it:
      "File contents download directly from our Swarm node. It sees your IP and which encrypted blobs you fetch, not
      what's in them or who you are."
- **Always excluded and stated:** the one bootstrap read of the worker specifier, and the wallet's own traffic (e.g.
  the WalletConnect relay).

---

## 13. How each flow works

1. **Sign in:** sign the message (twice on the first device) → check → keys → K gets a drip if new.
2. **Claim a name:** `/claim` deploys Alice's resolver with `haven.key`, deploys her drive root (K everyday, W
   dangerous), and registers the name. The app then checks that the API holds no role on either contract and that
   `haven.key` equals her derived key.
3. **Create a folder:** K deploys a `DriveRegistry` proxy and registers a random label, choosing "inherit" or "separate
   access". **Create a room:** `/room` with a token.
4. **Upload:** apply the write rule → pad → encrypt → `/upload` → `haven.file`.
5. **Share:** derive S → grant (with an end date) → fund S if editor or manager → welcome note, key copy, roster →
   cascade key copies into inheriting subfolders.
6. **Shared with me:** fetch new welcome notes by `bucket` → try each locally → read key copies and files with
   isolation key S. The extension does this every 15 minutes.
7. **End date:** nothing to do. Epoch keys, `_getRoles` and Arkiv expiry all end on their own.
8. **Remove early:** revoke → refresh the folder and its inheriting subfolders → delete their key copies.
9. **Groups / links / mount (Should):** as in sections 6, 7 and 9.
10. **New device:** sign in → check keys against `haven.key` → drive tree from ENS → rooms by checking n → entries from
    Arkiv → files from Swarm.
11. **Extension pairing:** the site sends the seed to the extension through `externally_connectable` (our origins
    only), after the user confirms.

---

## 14. Platforms

**Website (`apps/web`):**
- Next.js 16 with `output: 'export'` (one static build for Vercel and Swarm).
- wagmi (injected wallets + WalletConnect).
- Strict CSP, serving the Anon-RPC bootstrap ourselves (`iframeUrl`); no analytics.
- The new-folder dialog asks "In my drive" or "Unlinked room (recommended for data rooms)".

**Phone (the same build, as a PWA):**
- Serwist (`@serwist/next` 9.5) offline app shell, manifest, Android `share_target`, camera upload, iOS
  "Add to Home Screen" hint.
- No push notifications: a push server would learn which device waits for which shares.
- Shows "Connecting privately…" while the Nym worker (about 18 MB) starts.

**Extension (`apps/extension`):**
- WXT 0.21 + React, MV3.
- Permissions: `storage`, `contextMenus`, `alarms`, `notifications`, `offscreen`, `sidePanel`.
- Popup, right-click save, side panel (Should).
- 15-minute background check: new shares → badge; for owners, members' gas top-ups and open refresh requests.
- Released as a GitHub zip and an unlisted Chrome Web Store submission on day 1; a human pays the one-time developer
  fee.

**"Try it" for judges:** two fresh identities from random seeds (no wallet: Founder and Investor), with a switcher.
They get real names and rooms on testnet; the judge uploads their own files. Nothing is pre-seeded.

---

## 15. Backend (`apps/api`)

| Endpoint | Does | Limits |
|---|---|---|
| `POST /claim` | Deploys resolver and drive root, registers the name | Signed by K; 1 name per K; daily cap |
| `POST /room` | Registers a room label and deploys its registry with root `K_room` | Proof-of-work + daily cap (Must); blind token (Should) |
| `POST /drip` | Sepolia ETH and tGLM to **K or `K_room` only**, sent in a batch every 10 minutes | Once per key per day; global budget; balance floor |
| `POST /arkiv-rpc` | JSON-RPC pass-through to Arkiv that adds our access key server-side | Allowlisted methods only; rate limits; no logs |
| `POST /upload` | Streams ciphertext to Bee | Signed by a key with WRITE (`wasAllowed` now); 25 MB per file; quota per key; stamp budget guard |

- Relayer keys hold `ROLE_REGISTRAR` on `haven.eth` and `rooms.haven.eth`, and nothing else.
- Logs: rate-limit counters for 24 hours; no contents.
- **Escape:** users with their own `.eth` name and gas don't need the API, except for uploads (any Bee node works).

---

## 16. State transitions (copy into the README)

| Transition | Caller | Why they pay gas | If nobody calls |
|---|---|---|---|
| Claim name / create room | API registrar key | We sponsor onboarding | Bring your own `.eth`; rooms wait |
| Create folder | K | Wants a folder | – |
| `grantRolesUntil` + funding S | K, `K_room` or a manager | Wants to share | – |
| Access ends | Nobody | – | Ends automatically (epoch keys, `_getRoles`, Arkiv expiry) |
| Early removal + key refresh | A manager | Removes someone | Access lasts until the end date |
| Answer a group refresh request | A folder manager's app | Keeps editors unblocked | Editors stay blocked; nothing leaks |
| `sweep` | Anyone | Frees a member slot | The grant stays stored but inactive |
| Arkiv writes and renewals | Writers and managers | Their own data | Entries expire after about 182 days; Swarm data stays until the stamp runs out |

No funds move in the product beyond gas dust.

---

## 17. First-hour checks (H0–H3; split between A and B in `PLAN_SHARED.md`)

1. **Register the app names:** `haven.eth` through `ETHRegistrar`, then `rooms.haven.eth`.
2. **`DriveRegistry` at `48b3e2d`:** it compiles; bits 40/44/48 are free; `_onRolesGranted` / `_onRolesRevoked` work
   for the history; stripping `ROLE_UPGRADE` in `_getRoles` blocks `upgradeToAndCall`; our initializer works through
   `VerifiableFactory`.
3. **PermissionedResolver** proxy with `initialize(grants, calls)` sets `haven.key`; the deployer keeps no roles.
4. **Namespace aliasing** resolves through `UniversalResolverV2`; an expired subname stops resolving.
5. **Arkiv:**
   - `$createdAt` can be selected (and its unit);
   - a custom viem transport works;
   - expiry works;
   - a native tGLM transfer K → S works.
6. **Swarm:** Bee node up with a postage batch; upload and download work.
7. **Anon-RPC:**
   - JSON-RPC through `worker.fetch` works for Sepolia and Arkiv (`eth_call`, `eth_getLogs`,
     `eth_sendRawTransaction`, Arkiv queries);
   - **does any-HTTPS fetch work?**
   - is `isolationKey` honoured?
   - how fast are Nym, Nox and Tor?
8. **Fluidkey kit:** derive keys; S from P; the recipient recovers S's private key.
9. **Wallets:** MetaMask, Rabby and a Ledger give identical signatures for the fixed message; smart wallets are
   detected; MetaMask's domain warning fires on a wrong origin.
10. **Funds:** faucets for about 1 Sepolia ETH (relayer budget) and tGLM.

**If any check fails, change the design before building on it.** Each check has a stated fallback in its section.

---

## 18. Demo script (3 minutes; also the EF video)

1. **0:00:** "Who did you share your data room with? Onchain, everyone knows. Here's how no one does."
2. **0:15 Founder:** sign in → create an **unlinked room** "Series A" → drag in the deck and financials.
3. **0:40 Share:** `vc.haven.eth` as viewer until a time 2 minutes away (demo epochs are 1 minute); `priya` as
   editor. Funding for Priya goes out in the same action.
4. **1:00 Public view:** random addresses with end dates; ciphertext on Arkiv; the plain sentence "Anyone can see…
   They can't see who owns it…". Then show that `acme.haven.eth` has no link to the room.
5. **1:20 Investor on a phone:** "Shared with you: Series A"; the deck opens.
6. **1:45 Lawyer in Chrome:** right-click a term sheet → "Save to Haven" → it appears in the room.
7. **2:05 End date passes:**
   - the investor still has the deck they opened (we say so);
   - the founder uploads "Final terms", and on the investor's phone it shows as **locked**;
   - no transaction was needed.
8. **2:30 Privacy:** the receipts panel shows the route of every lookup (Nym), and what went direct, if anything.
   Stop Vercel; the Swarm copy still works.
9. **2:50:** close.

---

## 19. Submission checklist

- [ ] **Repo:** public, MIT licence, steady commits.
- [ ] **README covers:**
  - setup and architecture;
  - stock ENSv2 vs new;
  - the state transitions table;
  - the "who can link what" table;
  - routed and direct traffic;
  - limits;
  - the `CROPS` section;
  - AI usage;
  - writer wallets;
  - a runnable Arkiv query.
- [ ] **ENS-1:**
  - live demo link;
  - contracts verified on Sepolia;
  - no hard-coded values;
  - links to the lines of `_getRoles` and `wasAllowed`;
  - `FEEDBACK-ENS.md`.
- [ ] **ARKIV-2 / ARKIV-5:** all six `/arkiv/*.md` files, including `swarm.md` (entity key + openable Swarm link,
  batch ID, buyer, Bee node, files, run steps, video timestamp, friction).
- [ ] **EF-1 / EF-3:**
  - Anon-RPC on by default;
  - exclusions stated;
  - the `CROPS` section;
  - video of 3 minutes or less;
  - no trackers.
- [ ] **Live at judging:**
  - Vercel;
  - the Swarm copy;
  - the installable PWA;
  - the extension zip (plus store links if approved);
  - "Try it" with no wallet.

---

## 20. Tests that prove the fixes

| Fix | Test |
|---|---|
| Editors can't leak to expired or removed members | Core property test: no file written after a member's end or removal decrypts with any key they received |
| Write rule | Core tests: stale-version write, back-dated epoch, write during an open refresh request, and a write by an expired editor are each hidden by the validator |
| Access history | Foundry: `wasAllowed` before, during and after; revoke mid-way; renew; inherited; group |
| Can't upgrade | Foundry: `upgradeToAndCall` reverts for K, W and the owner; fuzz over role grants |
| Power split | Foundry: K can't set a subregistry, set the parent, unregister or transfer |
| Wallet checks | Core tests: two different signatures are refused; a key mismatch with `haven.key` is refused |
| Gas doesn't link | e2e: viewers never receive funds; S is funded only by the sharer; the API drip goes only to K or `K_room` |

---

## 21. What's still exposed (say it before judges ask)

**Who can link what:**

| Party | Can link | Can't link |
|---|---|---|
| Anyone (Sepolia, Arkiv, Swarm) | A named-drive folder to its owner's name; a member's random address to the folder or room it's in; counts, end dates, timing, padded sizes | A member's address to their name or to their other shares; a room to its owner |
| Owner and managers | Every member's address to their name (they shared it) | – |
| Other members | Members who chose to be visible | Hidden members |
| Our API | Public keys of named drives; upload and drip requests per key; weak timing hints between requests | IPs (if routed); room → owner (blind tokens + batched drips) |
| RPC providers / Anon-RPC exits | Requests, not who sent them | – |
| Our Bee node, if HTTPS isn't routed | Your IP ↔ which encrypted blobs you fetched | Contents, names, identities |

**CROPS gate (expand into the README `CROPS` section):**
- **C (censorship resistance):** our API can refuse names, rooms, drips and uploads; Vercel can go down; an Anon-RPC
  network can fail.
  - Escape: bring your own `.eth` name and gas, use any Bee node, open the Swarm copy at `haven.eth`, or switch
    network in Settings.
- **O (open source):** MIT licence; contracts verified on Etherscan; the API and a Bee node run from the repo, so
  anyone can self-host the whole stack.
- **P (privacy):** the table above, plus what's public (counts, end dates, timing, padded sizes) and which traffic is
  routed or direct (section 12).
- **S (security):**
  - keys come from one domain-bound signature or a passkey and stay on the device;
  - in-app keys hold gas dust and can't upgrade anything (the registry is frozen);
  - dangerous roles stay with the main wallet;
  - strict CSP, no third-party scripts;
  - not audited.
- **Main compromise:** in-browser keys, so there are no pop-ups. **Escape:** passkey sign-in, and W keeps every
  dangerous power.

**Other limits:**
- **What someone already opened, they keep.** A member can always copy plaintext they could read; no system can stop
  that.
- **Membership counts and timing are public,** even in unlinked rooms.
- **Hot keys:** in-app keys live in the browser, so XSS or a malicious extension would expose them. They hold only gas
  dust and can't upgrade anything; strict CSP, no third-party scripts.
- **Group removal window:** removing someone from a group leaves a short gap before a folder manager refreshes the
  keys. Editors are blocked during it; viewers can't get new files because none are written.
- **Member caps:** ENS caps each role at 15 holders per folder. Groups and `sweep` help.
- **Long-term crypto:** key wraps use secp256k1 ECDH, which a future quantum computer could break on archived data.
  AES-256 is fine.
- **Beta and unaudited:** ENSv2 on Sepolia is pre-launch, and our contract is unaudited.

---

## 22. Review findings and fixes

| # | Finding | Fix (section) |
|---|---|---|
| 1 | Gas funding links stealth addresses | Viewers never need gas; the sharer funds editors and managers in the grant action; API drips go only to public keys, batched; "who can link what" table (8, 21) |
| 2 | The owner's activity is public | Unlinked rooms under `rooms.haven.eth` with fresh keys, created through the API with tokens; a plain-language metadata sentence in the Public view (9) |
| 3 | Editors can leak new files to expired members; subfolders keep old keys | Epoch keys by key regression (expiry is cryptographic); refresh in the same action as removal; write rule and read rule; independent subfolder secrets with cascading refresh; property test (7, 20) |
| 4 | "Access ends" overclaims | New wording everywhere: new files lock out; what they opened, they keep (1, 18) |
| 5 | Phishing; wallets that don't sign deterministically | Domain-bound SIWE-format message with a warning; sign twice and compare; detect smart wallets; check against `haven.key` on new devices; passkey path (5) |
| 6 | A hot key can upgrade the contract | `_getRoles` strips the upgrade role from everyone, so it's frozen; dangerous roles on W; K only everyday roles and gas dust (6) |
| 7 | Anon-RPC may not carry HTTP traffic | All JSON-RPC routed; a first-hour check for any-HTTPS; otherwise ask EF, and state and show what goes direct; "download whole folder" (12, 11) |
| 8 | Past permissions need an archive node | Access history stored in `DriveRegistry`; `wasAllowed(account, role, t)` is a normal view call; event-log rebuild as a fallback (6, 10) |

---

## 23. Sources

- **ENSv2:**
  - docs.ens.domains (overview, permissioned registry and resolver, enhanced access control, registry hierarchy,
    deployments);
  - `github.com/ensdomains/contracts-v2` at `48b3e2d`: `EnhancedAccessControl.sol` (`hasRoles` → `_getRoles`, the
    grant and revoke hooks), `UserRegistry.sol` (`initialize`, `_authorizeUpgrade`), `RegistryRolesLib.sol`.
- **ENS Drive (reference):** `github.com/krishnan74/eth-tokyo-2026` (`docs/feedback/ens.md`).
- **Fluidkey kit:** `github.com/fluidkey/fluidkey-stealth-account-kit` (MIT).
- **Arkiv:** docs.arkiv.network (limits), the `@arkiv-network/sdk` README.
- **Swarm:** docs.ethswarm.org (develop, ACT, buy-a-stamp-batch).
- **Anon-RPC:** `github.com/ethereum/anon-rpc` (harness READMEs, `adopters.json5`).
- **Key regression:** Fu, Kamara and Kohno, "Key Regression: Enabling Efficient Key Distribution for Secure
  Distributed Storage" (NDSS 2006).
