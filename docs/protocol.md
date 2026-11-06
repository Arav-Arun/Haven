# Protocol

The full design, with the reasoning, is [`plan/HAVEN_PLAN.md`](plan/HAVEN_PLAN.md). This page is the short
reference for the code as built.

## Keys (`packages/core/src/keys.ts`)
- Seed: `r ‖ s` of a wallet's signature of a fixed, domain-bound SIWE message; or 32 random bytes ("Try it").
- From the seed: spending and viewing keys (Fluidkey kit for wallets), `K = HKDF(seed, "drive")`,
  `K_room[n] = HKDF(seed, "room/n")`. The spending public key is published as `haven.key`.
- Later devices must derive the same `haven.key`, or sign-in stops with `KEY_MISMATCH`.

## Folders (`ens.ts`, `client.ts`)
- A folder is a `DriveRegistry` proxy, registered as `f-<random>.<parent name>`; groups are `g-<random>`; rooms are
  `r-<random>.rooms.haven.eth` with root `K_room[n]`.
- Roles: viewer `1<<40`, editor `+1<<44`, manager `+1<<48` and the admin bits. `grantRolesUntil` ends them on time;
  `wasAllowed(account, roles, t)` answers for any past time.

## Encryption (`epochs.ts`, `keycopies.ts`, `records.ts`, `padding.ts`)
- Each version v of a folder: secret `FS_v`, start `t0`, epoch length (1 hour; 1 minute in demo mode).
  `E[N] = HKDF(FS_v, "chain")`, `E[i-1] = SHA-256(E[i])`, N = 8,760.
- Members get one key copy per version: `E[j]` for the last epoch ending by their end date, sealed with their member key.
  Managers get `FS_v`. Owners seal their own copy with `HKDF(K, folder)`.
- Files: padded to a bucket, AES-256-GCM with a random file key; the name, type, size and file key are sealed with the
  epoch key of the time of writing.
- Removal: revoke onchain, then version v+1 with copies for everyone left.

## Sharing (`stealth.ts`)
- Read the recipient's `haven.key` P; pick e; `S = stealth(P, e)`; grant S; fund S (editors and managers) from the
  folder's key; write a welcome note (`e·G` and the member key sealed with `HKDF(ECDH(e, P))`), a key copy and the
  roster in one Arkiv transaction.
- The recipient scans welcome notes by week, opens the ones meant for them, and derives S's private key.

## Reading (`validator.ts`)
- An entity counts only if read-only and its creator held the right role at its creation time; files also need the
  latest version, a plausible epoch, and no open refresh unless the writer manages the folder.

## Traffic (`transport.ts`, `@haven/platform`)
- All JSON-RPC (Sepolia and Arkiv) through Anon-RPC, isolated by the folder's key address; API and Swarm calls too
  when the worker carries generic HTTPS (measured), otherwise direct and marked so in receipts.

## Add-on F1: public key log (`keydir.ts`)
- `haven.keylog` on Arkiv, keyed by ENS name: entries seq 0, 1, 2…, each EIP-712 signed by the name's controller
  (K of the drive root for `<label>.haven.eth`; the token owner for any other ENSv2 name) and pointing at the
  previous entry's Arkiv key. Validity goes by the signature, so the API can relay entries (`POST /keylog`).
- Share refuses a broken chain or a key that disagrees with `haven.key` (`KEY_MISMATCH`), and a key that changed since
  the last share until the user confirms (trust on first use, stored locally). Fingerprint: one word per byte of
  `keccak256(compressed key)`, 8 words from the frozen list in `words.ts`.
- `claimName` writes seq 0; every sign-in writes a `haven.device` entry (90 days, renewed while used). A
  `revoke-device` entry makes that device's app sign itself out when it next opens.
- Another ENS name (e.g. `priya.acme.eth`) is linked by its owner wallet signing a `publish` entry for it.

## Add-on F2: subtree sharing (`subtree.ts`)
- A rule `{parent, role, until, excluded}` is stored only inside the sealed roster (managers part). Nothing is written
  to ENS.
- Sync (in `maintain()`, and "Sync now"): list `parent`'s subnames from its registry's `LabelRegistered` events (the
  event carries the label), keep live ones (`getStatus`, `getExpiry`, `ownerOf`), resolve each holder's key from the
  F1 log. New holders become ordinary stealth shares (the roster remembers name and controller); a name that is gone,
  excluded or transferred is revoked, then one key refresh. Over 14 people is refused.

## Add-on F3: verified frontend (`release.ts`, `scripts/release.ts`, the extension)
- `manifest = {version, gitCommit, publicEnv, files: {path: sha256}}` over the export's `.html/.js/.css`;
  `rootHash = sha256(canonical JSON)`. Build id = git commit.
- `release publish`: the site (tar) and the manifest to Swarm, `haven.release` signed by R, `haven.eth`
  contenthash → the site.
- The extension re-downloads every file a Haven tab loaded, hashes it, and matches a non-revoked release signed
  by R. Only then does it answer the page's `keys-request` (on a MessageChannel port). With "Keep keys in the extension"
  the site keeps the seed in memory only.

## Add-on F4: doorbells (`doorbell.ts`)
- Topic `HKDF(E_v[epoch], "doorbell/<folder>")`; GSOC key mined towards our Bee overlay; payload `{type, arkivKey}`
  sealed and padded to 256 bytes; SOC signed with EIP-191 over `keccak256(id ‖ BMT address)`.
- Writers ring on upload, share and key refresh (a refresh rings the old topic). Members subscribe to the current and
  next epoch's topics and resubscribe at each epoch end; every ring is checked by re-reading Arkiv. No config or a
  dropped socket: re-read Arkiv every 30 s.

## Add-on Z1: anonymous writes (`zk.ts`)
- Each writer (K, K_room or a stealth member S) derives a Semaphore v4 identity `HKDF(key, "haven/zk-identity/<folder>")`
  and joins once: a `haven.zkjoin` entry with its commitment, EIP-712 signed by its member address, relayed by
  `POST /zk/join`. Only the member knows S's key, so not even the sharer can make its proofs.
- Writer group at time t: commitments of valid joins whose member held WRITE at t (`wasAllowedMany`), in join order.
  Nobody maintains it; removal and end dates apply by themselves.
- Upload: a proof (depth 5, fresh random scope) with message `keccak256("haven.zkupload v1", folder, sha256(body), time)`
  authorises `POST /zk/upload` with no signer; a second proof with message `keccak256("haven.zkfile v1", folder, fileId,
  version, epoch, swarmRef, keccak256(meta))` goes in a `haven.zkfile` entry relayed by `POST /zk/file`. The API checks
  both against the current group root and accepts each nullifier once.
- Read: proof valid, message from the entry's own fields, root = the group's root at the entry's creation time; then the
  file rules, never with the manager exception. The writer recognises its own entries by recomputing the nullifier.
- Needs at least 2 writers in the group. Proving files (`apps/api/zk`, served at `/zk/*`) are checked against sha256
  hashes pinned in `zk.ts`; the verification key ships inside `@semaphore-protocol/proof`.
- Still visible: which member addresses joined (they hold WRITE onchain anyway), group size, timing, and the requester's
  IP to our API when the request isn't routed.

## Groups and inherited subfolders (`client.ts`)
- A group is a `g-<random>` DriveRegistry whose sealed roster lists people by ENS name. Sharing a folder with it stores
  the rule `group:<registry>` in the folder's sealed roster and makes one stealth share per person; each sync compares
  the rule's people with the group's roster (removals first: revoke, then one key refresh).
- A subfolder created with `inherit` carries `i: 1` in its sealed folder info. The owner's app grants the parent's
  member addresses on it with the same roles and ends, and writes key copies sealed with each member's existing member
  key (rule `inherited`). Members find it because their address holds a role there. Changes to the parent propagate
  down at once, and `maintain()` re-checks every inheriting subfolder.

