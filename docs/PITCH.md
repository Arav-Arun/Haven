# Haven: finalist pitch and Q&A prep

Written for **4 minutes on stage + Q&A**. Lines marked **[CUT FOR 3 MIN]** can go if the slot is shorter.
Speaking pace is about 150 words a minute. Say the words in quotes; the bold **DO:** lines are what you click.

---

## Part 1: the main pitch (finalists + all three sponsors in the room)

### 0:00 – 0:25 · The problem (no screen yet, or the landing page)

> "When a founder shares a data room with investors, they use Google Drive or DocSend. That means Google sees every
> file and every investor who opened it.
>
> The obvious crypto answer is 'put the access list onchain'. That's actually worse: now *anyone* can read which
> investors got your data room, forever.
>
> Haven fixes both. Your files are encrypted on your device. You share with an ENS name. On the chain, the person you
> shared with shows up only as a random address. And access ends on its own, even if you forget to remove it."

### 0:25 – 0:55 · Sign in and claim a name (ENS)

**DO:** Start sharing → Connect wallet → sign → Claim `founder.haven.eth` → open the Etherscan link.

> "One signature creates my keys, right here on the device. No server ever holds them.
>
> I claim a free name, `founder.haven.eth`. This is real ENSv2 on Sepolia. My name gets its own Permissioned
> Resolver, and Haven publishes my encryption key as a `haven.key` text record. Our relayer pays the gas, and the app
> checks onchain that the relayer kept *no* role on my resolver."

### 0:55 – 1:35 · Make a room and upload (ENS + Swarm + Arkiv)

**DO:** Rooms → New room → show `r-….rooms.haven.eth` → drop two files → point at "Padded to 64 KB" and the 4 MB one.

> "Every folder in Haven *is* an ENS name with its own registry. That registry is our contract, `DriveRegistry`. It
> extends ENSv2's UserRegistry and uses Enhanced Access Control roles as file permissions: viewer, editor, manager.
>
> A room gets a random name and its own key, so nobody can tie it back to me.
>
> The files are encrypted with AES-256-GCM in the browser and padded to fixed sizes, then stored on **Swarm**. Swarm
> only ever sees a 64 KB or a 4 MB blob of ciphertext. **Arkiv** gets a sealed entry pointing at it. The file's name
> and key are sealed inside that entry."

### 1:35 – 2:15 · Share with an ENS name (the core moment)

**DO:** Share → type `investor-x.haven.eth` → show the eight words → Viewer, 1 hour, Hide from other members → Share
→ open the new address on Etherscan.

> "Now I share by name. Haven reads the investor's public key from ENS and derives a fresh **stealth address** just
> for this share. These eight words are a fingerprint of their key, so we can check it in person.
>
> On Etherscan you can see the grant: a role, an end time, and an address that has never been seen before. Not their
> name.
>
> That end time comes from `grantRolesUntil`, a function we added on top of ENSv2 roles. Stock ENSv2 roles last until
> someone revokes them. Ours expire by themselves.
>
> **[CUT FOR 3 MIN]** The same dialog can share with a group, or with everyone under a namespace like `acme.eth`, and
> it stays in sync when people join or leave. Or it makes a share link that is itself an expiring ENS subname."

### 2:15 – 2:50 · The investor's side, and access ending (Arkiv)

**DO:** Laptop 2 → Shared → open the room → open the file. Then the "Board pack" room → the locked file.

> "On the investor's laptop, Haven found a sealed welcome note on Arkiv that only they could open. Their copy of the
> folder key is an Arkiv entity that **expires exactly when their access does**. The file downloads from Swarm and
> decrypts here.
>
> This other room was shared for five minutes. Those five minutes are over. Nobody sent a transaction. The role
> expired on Sepolia, the key copy expired on Arkiv, and the file added afterwards is locked for them."

### 2:50 – 3:20 · What an outsider sees (privacy, Arkiv)

**DO:** Laptop 3 → Public view → click one Arkiv record → explorer.

> "This is the same room through the eyes of someone with no keys: random addresses, padded sizes, encrypted records
> with expiry dates. No names, no files.
>
> Arkiv lets anyone write anything, so every Haven reader checks each entry's creator against the folder's ENS roles
> *at the moment it was written*, with one view call, `wasAllowed`. Fake writes are ignored, and counted right here."

### 3:20 – 3:45 · Private network (EF: Anon-RPC + CROPS)

**DO:** Receipts (every row says Private) → Settings → Private network → Nox → Off → do one action → receipt says
Direct → back to Nox.

> "Every chain and Arkiv read goes through **Anon-RPC** on the Nox mixnet by default. Each room and each stealth
> address gets its own isolation key, so even the network can't link my shares together.
>
> If I turn it off, the receipt says 'Direct'. Haven never hides what it leaks. No trackers, no analytics, a strict
> content security policy, and it's all MIT."

### 3:45 – 4:00 · Close

> "Haven: ENSv2 for permissions that expire, Arkiv for records that expire with them, Swarm for the files, and
> Anon-RPC for every read. Private sharing that doesn't depend on trusting us. Thank you."

---

## Part 2: one-minute versions for each sponsor

Use these if a sponsor judge asks "so how do you use *our* stuff?", or as the opener at their table.

### ENS: "ENSv2 roles are our file permissions"

> "We didn't use ENS to resolve a name to an address. We used ENSv2's registries and Enhanced Access Control as the
> access-control layer of a file system.
>
> - Every folder, room and group is its own `DriveRegistry`, a subregistry deployed through `VerifiableFactory`, that
>   extends `UserRegistry`.
> - Viewer, editor and manager are EAC role bits at nybbles 10, 11 and 12. A manager is just those roles plus their
>   admin bits, so ENS's own `_checkCanGrantRoles` decides who may grant what.
> - We added **roles that expire**, `grantRolesUntil`, and an **onchain access history**, `wasAllowed(account, roles, t)`,
>   so any app can ask 'could this address write here last Tuesday?' as a view call.
> - Each user's name has its own **Permissioned Resolver** holding `haven.key`.
> - We use **namespace aliasing** to mount a shared folder into your own tree, **expiring subnames** as share links,
>   and we read a namespace's subnames to share with 'everyone at `acme.eth`'.
> - Tested with fork tests against the live Sepolia ENSv2 deployment, and we wrote up six findings in
>   `FEEDBACK-ENS.md`, including that expiring grants might belong in EAC itself."

### Arkiv: "a public database for private data"

> "Arkiv is our whole index: fifteen entity types. File entries, welcome notes, key copies, rosters, key rotations,
> share links, a public key directory, and release records.
>
> Three things only Arkiv gave us:
> 1. **Expiry the user can trust.** A guest's key copy expires at the same second their role does. The database
>    removes it, not our server.
> 2. **No server to ask.** Reads go to a public database through Anon-RPC. There's no Haven database that knows who
>    opened what.
> 3. **Writes owned by their writers.** Each entry is created by the key that wrote it. We validate `$creator`
>    against ENS roles at `$createdAt`, so our server can't add, change or hide a file.
>
> Everything private is sealed with AES-256-GCM. Only folder addresses, random IDs, versions, epochs and week buckets
> are indexed. And `haven.keylog` is a signed, hash-chained key directory keyed by ENS name that any app can query.
>
> **Swarm bonus:** file contents live on Swarm as padded ciphertext, the reference sits in `haven.file.swarmRef`, and
> the decryption key is never in it: it's sealed in Arkiv's `meta`. We also use Swarm GSOC as encrypted 'doorbells'
> for live updates."

### Ethereum Foundation: "Anon-RPC by default, isolated per identity"

> "Anon-RPC isn't a setting in Haven, it's the default path. Every Sepolia and Arkiv JSON-RPC call goes through the
> browser harness, on Nox, Nym or Tor.
>
> The interesting part is **isolation keys**. Haven deliberately gives every user many unlinkable identities: a key
> per room, a stealth address per share. If all of those went out over one circuit, the network would link them
> again. So every room and every stealth address uses its own isolation key.
>
> And we're honest about the rest: each receipt is labelled Private or Direct, Settings tests whether HTTPS can be
> routed instead of assuming, and the README's CROPS section lists exactly what our API, the RPCs, Vercel and
> WalletConnect can see. The lead CROPS property is **Privacy**, and it's structural: your name isn't hidden by a
> setting, it's simply never written onchain."

---

## Part 3: technical Q&A

Short answer first, then the detail if they push. Where an answer admits a limit, say it plainly: judges trust teams
that know their weak spots.

### A. The smart contract (`contracts/src/DriveRegistry.sol`)

**Q: What does your contract actually add to ENSv2?**
It's a stock ENSv2 `UserRegistry` plus five things: roles with an end date (`grantRolesUntil`), an onchain access
history (`wasAllowed`, `historyOf`), a permissionless `sweep` for expired grants, a split between everyday and
dangerous powers, and a permanent upgrade freeze. Everything else, the registry, labels, EAC checks, is ENS's own code.

**Q: How does expiry work without anyone sending a transaction?**
We override `_getRoles`, which every EAC permission check reads through. If the account's end date has passed,
`_getRoles` simply doesn't return the drive roles. So the role is still in storage, but every check treats it as
gone from that second on. `_until[account]` holds the end date; `block.timestamp >= until` means expired.

**Q: What are the role values?**
Viewer = `ROLE_DRIVE_READ` = `1 << 40` (nybble 10). Editor adds `ROLE_DRIVE_WRITE` = `1 << 44`. Manager adds
`ROLE_DRIVE_SHARE` = `1 << 48`, plus the admin bits of all three (`<< 128`). In ENSv2's EAC each role has a 4-bit
nybble and its admin bit sits 128 bits higher; an admin bit lets you grant and revoke that role.

**Q: Why can't I just use `grantRootRoles`?**
We override it to refuse drive roles (`UseGrantRolesUntil`). That guarantees every drive grant has an end date. The
only exception is the owner, set once at initialization with `NO_END`.

**Q: Can a manager lock the owner out?**
No. Stock ENSv2 lets any admin of a role revoke it from anyone. We override `revokeRootRoles` so only the owner can
revoke the owner's drive roles (`OwnerAccessIsFixed`), and `grantRolesUntil` refuses to time-limit the owner.

**Q: Can a manager extend their own access, or give someone longer access than they have?**
No. Rule 3: `until > grantorEnd` reverts with `GrantOutlivesGrantor`. A grant can never outlive the grantor.

**Q: If access expired, can a re-grant bring old roles back?**
No. If the account's roles are expired, `grantRolesUntil` first revokes the stale roles, then grants the new ones. So
expired access never resurrects, for example a stale manager bit coming back with a viewer re-grant.

**Q: How does `wasAllowed` work? Why not just read events?**
Each account has a ring buffer of up to 8 `Interval`s `{from, until, endedAt, roles}`, packed into one storage slot
each. `wasAllowed(account, roles, t)` walks them newest first and returns whether the interval covering `t` had those
roles. It's a plain view call, so a browser can validate an Arkiv entry's creator at its creation time without an
archive node or log scanning. `wasAllowedMany` batches it, so one call validates a whole folder's entries.

**Q: What happens after 8 intervals?**
Older ones are overwritten (the events keep the full record), and `wasAllowed` fails closed: it answers false for
times only the overwritten ones covered. In practice each share uses a fresh stealth address, so one address sees one
or two intervals.

**Q: Why did you hook `_grantRoles`/`_revokeRoles` instead of ENS's `_onRolesGranted` hooks?**
In `PermissionedRegistry` those hooks are `override` without `virtual`, so we can't override them, and they're
skipped during initialization and registration. `EnhancedAccessControl._grantRoles` / `_revokeRoles` are virtual and
see every path. That's finding #1 in `FEEDBACK-ENS.md`.

**Q: Why is it non-upgradeable, and how did you do it?**
Users have to trust that the rules of their folder can't change under them. `UserRegistry._authorizeUpgrade` isn't
virtual, so we strip `ROLE_UPGRADE` and its admin from everyone inside `_getRoles`, `upgradeToAndCall` always
reverts, and `canUpgradeFrom` returns false so no other proxy can be upgraded *into* a DriveRegistry either.

**Q: What's the everyday / dangerous split?**
The drive key K (derived from your signature, used every day) gets registrar and drive roles. The main wallet W gets
the dangerous ones: set subregistry, set parent, unregister, transfer admin, each with its admin bit, so K can't use or
revoke them. A room has no W, because a W would link the room to its owner, so the room key holds both.

**Q: What's `sweep` for?**
ENSv2 caps each role at 15 holders, and that counts raw storage, so an expired grant still uses a slot. Anyone can
call `sweep(account)` on an expired grant to free it. History stays.

**Q: How is each folder deployed?**
`VerifiableFactory.deployProxy` with an atomic `initializeDrive(driveKey, mainWallet)`, so nobody can front-run the
initializer. Then it's set as the subregistry of `f-<random>.you.haven.eth` or `r-<random>.rooms.haven.eth`.

**Q: How did you test it?**
26 unit tests, fuzz tests, 3 invariants (history at "now" always equals the live role check; the owner always keeps
everyday roles; upgrade is impossible), fork tests against the live Sepolia ENSv2 contracts, and a mutation script
(`contracts/test/mutation/mutate.sh`) that breaks each rule one at a time and checks some test fails.

**Q: Is it audited?**
No. It's unaudited testnet code, and the README says so.

**Q: Which ENSv2 version did you build against?**
We pinned `contracts-v2` main at `48b3e2d`. The live Sepolia deployment is the `audit-results-19102026` branch,
65 commits ahead. Role bits, the EAC hooks we override and `IRegistry` are identical, and the fork test proves it
works against the live contracts.

**Q: Deployed addresses?**
DriveRegistry implementation `0x779Ee739…7628` (verified on Etherscan), `haven.eth` registry `0xd20bC833…0632`,
`rooms.haven.eth` registry `0x951D7D86…74db`. All in `contracts/deployments/sepolia.json`.

### B. Cryptography and privacy

**Q: Where do keys come from?**
From the `r ‖ s` of one signature over a fixed, domain-bound SIWE message. From that seed: spending and viewing keys
(Fluidkey kit), the drive key `K = HKDF(seed, "drive")` and room keys `HKDF(seed, "room/n")`. A new wallet signs twice
to check its signatures are deterministic. Keys are stored encrypted under a non-extractable WebCrypto key.

**Q: How does the stealth share work?**
The sharer reads the recipient's spending public key P, picks a random e, and derives the stealth address S with the
Fluidkey kit. S gets the role. A welcome note on Arkiv carries `e·G` and the member key, sealed with
`HKDF(ECDH(e, P))`. The recipient tries each week's notes: ECDH with their private key opens exactly the ones meant
for them, and gives them S's private key.

**Q: Isn't scanning every welcome note slow?**
Notes are bucketed by week, so you only scan the weeks you care about, and trying one is a single ECDH on the device.
It's the same trade-off as stealth-address payments.

**Q: How do you stop someone keeping access after it ends? You can't un-send a key.**
Two layers. Onchain, the role expires. Cryptographically, keys change every epoch (1 hour) and only chain backwards:
`E[i-1] = SHA-256(E[i])`. A member gets the epoch key for the last epoch that ends before their end date, so they can
derive every *earlier* key but never a later one. Files added after their access ends use a key they can't derive.
That's the "Locked" file in the demo.

**Q: And early removal?**
A manager revokes onchain, then does a key refresh: a new folder secret, version v+1, with key copies for everyone
who's left. Honestly: anyone keeps the plaintext of files they already opened. No system can stop that.

**Q: Managers?**
Managers get the folder secret, not just an epoch key, so they can derive future epochs. Removing a manager needs a
key refresh. That's in the README.

**Q: Why padding?**
File size is a strong fingerprint. Buckets are 64 KB, 256 KB, 1 MB, 4 MB, 16 MB and 32 MB (max file 25 MB), so Swarm
and outsiders only learn the bucket.

**Q: What still leaks?**
Membership counts, end dates and timing are public, even for rooms. A named-drive folder is linkable to its owner's
name (rooms aren't). Our API sees claim requests, upload signers and Swarm references. We list all of it in "Who can
link what" in the README.

**Q: Why the eight words?**
They're a fingerprint of the recipient's key (one word per byte of `keccak256` of the key). It's trust-on-first-use:
if a key changes since your last share, Haven stops and asks.

### C. ENS questions

**Q: Why not just use one registry with subnames per file?**
Because the permission unit is the folder. A registry per folder gives it its own role table, so roles are scoped to
the folder, managers of one folder have no power over another, and the 15-holder cap is per folder.

**Q: Where is `haven.key` stored?**
As a text record on the user's own Permissioned Resolver, set during initialization, so the relayer that deployed it
keeps no role. The client verifies that (`verifyClaim`).

**Q: Can I use my own `.eth` name instead of `haven.eth`?**
Yes. Link any ENSv2 name you control: your owner wallet signs a `publish` entry in the Arkiv key log, and people can
share with it.

**Q: How does "share with everyone at acme.eth" work?**
We read the parent registry's `LabelRegistered` events to list subnames, keep the live ones (`getStatus`,
`getExpiry`, `ownerOf`), look up each holder's key in the key log, and make a stealth share for each. A name that's
gone or transferred gets revoked, then one key refresh. Nothing is written to ENS: the rule lives in the sealed roster.

**Q: Where's namespace aliasing?**
Mounting a shared folder into your own tree: your name's registry points a label at the shared folder's
DriveRegistry, so it appears in your drive without copying.

**Q: How are share links expiring subnames?**
A link is a subname with an expiry. The Arkiv `haven.link` entry is keyed by its namehash and expires at the same time,
and it carries one file's key, sealed.

### D. Arkiv and Swarm

**Q: Anyone can write to Arkiv. How do you stop spam or forged files?**
The validator only counts an entity if it was created read-only and its `$creator` held the right role at
`$createdAt`, checked with `wasAllowedMany`. Files also need the latest key version, an epoch within one epoch of
creation (no back-dating), and no open refresh unless the writer is a manager. Everything else is ignored and counted
in the Public view. We go by `$creator`, never `$owner`, because an owner can hand an entity to someone else.

**Q: Why expiry on Arkiv and also on the contract?**
They protect different things. The contract stops a stale address from writing. Arkiv expiry takes the key copy and
welcome note out of the query surface at the same moment. Expiry can't erase data someone already saved, and we say so.

**Q: What would you lose with Postgres?**
Expiry enforced by the database instead of our promise, no server that sees who reads what, writes owned by their
writers, and an index anyone can audit (`arkiv/why-arkiv.md`).

**Q: What's on Swarm vs Arkiv?**
Swarm: padded ciphertext of the file. Arkiv: `haven.file` with `swarmRef` in the clear and `meta` sealed (name, type,
size and the file key). The Swarm reference is a plain (unencrypted) reference to ciphertext we encrypted ourselves,
so it contains no key. That's the security warning on the Swarm bonus, and we avoid it by design.

**Q: Who pays for Arkiv writes and Swarm?**
Our API drips tGLM and relays key-log entries (validity goes by the EIP-712 signature, not by who sent it). The API
holds the postage batch and uploads to our Bee node; it checks the upload is signed by a current writer.

**Q: What are GSOC doorbells?**
Encrypted Swarm single-owner chunks used as notifications: "something changed, re-check Arkiv". The topic is derived
from the epoch key, so only members can find it. Polling every 30 s is the fallback, and delivery on our light node
still needs live verification (README says so).

**Q: Why not store the files on Arkiv?**
Entities hold up to 128 KiB; files go up to 25 MB. Arkiv is the index, Swarm is the storage.

### E. Anon-RPC and CROPS

**Q: How much traffic goes through Anon-RPC?**
All Sepolia and Arkiv JSON-RPC, by default. API and Swarm HTTPS calls go through it too when the selected worker can
carry generic HTTPS, which Settings measures with a real request. When it can't, those calls go direct and the receipt
says Direct. Doorbell WebSockets are direct; that's a stated trade-off.

**Q: Which networks?**
Nox (default, Sepolia), Nym and Tor, using the worker specifiers from the anon-rpc repo's `adopters.json5`, through
`@anon-rpc/browser-harness`. On a strict CSP we host our own bootstrap page, as the harness README describes.

**Q: Why isolation keys?**
Haven gives each user many unlinkable identities. One shared circuit would link them back together, so each room key
and each stealth address gets its own isolation key.

**Q: What if your API or domain goes away? (CROPS "C")**
Your files, roles and records are on Swarm, Sepolia and Arkiv, not with us. Our API only sponsors onboarding (free
names, gas, uploads, the Arkiv access key). You can self-host it from the repo, use your own `.eth` name and Bee node,
and the release tooling can publish the site to Swarm behind `haven.eth`'s contenthash. Honest limit: without our API,
a new user needs their own gas and Arkiv key.

**Q: Which CROPS letter leads?**
Privacy. Structurally: the recipient's name is never written onchain at all, and the receipts show exactly which
requests were private.

**Q: Can I verify the frontend I'm running?**
The release tooling builds a manifest of every file's SHA-256, signs a `haven.release` entry on Arkiv and points
`haven.eth` at the Swarm copy; anyone who rebuilds the commit can post a matching `haven.rebuild`. A normal Vercel
deploy isn't automatically a signed release.

### F. Product and "why should this win" questions

**Q: Who is this for?**
Anyone sharing sensitive files with people outside their company: founders with data rooms, lawyers with clients,
journalists with sources, DAOs with contributors, and later AI agents that need time-limited access to documents.

**Q: Why would a normal user pick this over Google Drive?**
Same flow (folder, upload, share with a name, pick an end date), but no company sees the files or the list of who
you shared with, and access ends on its own. Onboarding is one signature and a free name; viewers never send a
transaction.

**Q: What's new compared with other "ENS drive" projects?**
They resolve a name and store files. We use ENSv2 roles as the permission system, add expiry and history to them,
and hide who has access with stealth addresses. ENS Drive was a reference for ideas only; no code was copied.

**Q: What does it cost a user?**
Nothing on testnet: the API sponsors names and rooms, and editors and managers get gas dust. Viewers send no
transactions at all.

**Q: Biggest limitation?**
Pick one and own it: metadata like membership counts and timing is still public, and keys live in the browser, so XSS
or a malicious browser add-on is the main risk. The keys only hold gas dust and can't upgrade anything.

**Q: What's next after the hackathon?**
Mainnet once ENSv2 is final there and the contract is audited, proposing expiring grants upstream to ENS's EAC, and
team features on top of the `acme.eth` sync.

**Q: How did you use AI?**
Described in `AI_USAGE.md`. Say it briefly and honestly.

---

## Part 4: numbers to know by heart

| Thing | Value |
|---|---|
| Role bits | viewer `1<<40`, editor `+1<<44`, manager `+1<<48`, admin bits `<<128` |
| Max members per role per folder | 15 (ENSv2 cap; `sweep` frees expired slots) |
| History kept per address | 8 intervals (ring buffer, fails closed) |
| Epoch length | 1 hour (1 minute in demo mode); 8,760 epochs per key version (one year) |
| Padding buckets | 64 KB, 256 KB, 1 MB, 4 MB, 16 MB, 32 MB; max file 25 MB |
| File encryption | AES-256-GCM, random file key per file |
| Arkiv entity types | 15 (8 private folder types, 5 public, 2 for anonymous writes) |
| Arkiv default expiry | about 182 days, renewed by managers |
| Anon-RPC networks | Nox (default), Nym, Tor |
| Contract tests | 26 unit, 3 invariants, 2 fork tests, plus a mutation script |
| Chains | Sepolia (ENSv2), Arkiv Rabdi testnet (7794095), Swarm (postage on Gnosis) |
| License | MIT |

## Before you walk on stage

- [ ] Arkiv entity types: say **fifteen** (8 private folder types, 5 public, 2 for anonymous writes).
- [ ] Anonymous uploads (Semaphore) need at least two writers and the proving service. Only demo it if you've tested
      it today.
- [ ] Have the Etherscan link for the DriveRegistry implementation and one Arkiv entity open in tabs, in case a judge
      asks to see something onchain.
- [ ] If a transaction is slow on stage, keep talking: "this is a real Sepolia transaction, it takes about 12
      seconds", then move to the next point and come back.
