# Protocol

The full design, with the reasoning, is [`plan/CLOAKROOM_PLAN.md`](plan/CLOAKROOM_PLAN.md). This page is the short
reference for the code as built.

## Keys (`packages/core/src/keys.ts`)
- Seed: `r ‖ s` of a wallet's signature of a fixed, domain-bound SIWE message; or 32 random bytes ("Try it").
- From the seed: spending and viewing keys (Fluidkey kit for wallets), `K = HKDF(seed, "drive")`,
  `K_room[n] = HKDF(seed, "room/n")`. The spending public key is published as `cloak.key`.
- Later devices must derive the same `cloak.key`, or sign-in stops with `KEY_MISMATCH`.

## Folders (`ens.ts`, `client.ts`)
- A folder is a `DriveRegistry` proxy, registered as `f-<random>.<parent name>`; groups are `g-<random>`; rooms are
  `r-<random>.rooms.cloakroom.eth` with root `K_room[n]`.
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
- Read the recipient's `cloak.key` P; pick e; `S = stealth(P, e)`; grant S; fund S (editors and managers) from the
  folder's key; write a welcome note (`e·G` and the member key sealed with `HKDF(ECDH(e, P))`), a key copy and the
  roster in one Arkiv transaction.
- The recipient scans welcome notes by week, opens the ones meant for them, and derives S's private key.

## Reading (`validator.ts`)
- An entity counts only if read-only and its creator held the right role at its creation time; files also need the
  latest version, a plausible epoch, and no open refresh unless the writer manages the folder.

## Traffic (`transport.ts`, `@cloakroom/platform`)
- All JSON-RPC (Sepolia and Arkiv) through Anon-RPC, isolated by the folder's key address; API and Swarm calls too
  when the worker carries generic HTTPS (measured), otherwise direct and marked so in receipts.

## Add-on F1: public key log (`keydir.ts`)
- `cloak.keylog` on Arkiv, keyed by ENS name: entries seq 0, 1, 2…, each EIP-712 signed by the name's controller
  (K of the drive root for `<label>.cloakroom.eth`; the token owner for any other ENSv2 name) and pointing at the
  previous entry's Arkiv key. Validity goes by the signature, so the API can relay entries (`POST /keylog`).
- Share refuses a broken chain or a key that disagrees with `cloak.key` (`KEY_MISMATCH`), and a key that changed since
  the last share until the user confirms (trust on first use, stored locally). Fingerprint: one word per byte of
  `keccak256(compressed key)`, 8 words from the frozen list in `words.ts`.
- `claimName` writes seq 0; every sign-in writes a `cloak.device` entry (90 days, renewed while used). A
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
- `release publish`: the site (tar) and the manifest to Swarm, `cloak.release` signed by R, `cloakroom.eth`
  contenthash → the site.
- The extension re-downloads every file a Cloakroom tab loaded, hashes it, and matches a non-revoked release signed
  by R. Only then does it answer the page's `keys-request` (on a MessageChannel port). With "Keep keys in the extension"
  the site keeps the seed in memory only.

## Add-on F4: doorbells (`doorbell.ts`)
- Topic `HKDF(E_v[epoch], "doorbell/<folder>")`; GSOC key mined towards our Bee overlay; payload `{type, arkivKey}`
  sealed and padded to 256 bytes; SOC signed with EIP-191 over `keccak256(id ‖ BMT address)`.
- Writers ring on upload, share and key refresh (a refresh rings the old topic). Members subscribe to the current and
  next epoch's topics and resubscribe at each epoch end; every ring is checked by re-reading Arkiv. No config or a
  dropped socket: re-read Arkiv every 30 s.
