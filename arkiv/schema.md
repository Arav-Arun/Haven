# Arkiv schema

- **15 entity types,** all defined with the SDK's `defineSchema` in
  [`packages/core/src/arkiv.ts`](../packages/core/src/arkiv.ts):
  - 8 private ones for folders
  - 5 public ones: the ENS key directory and the website release log
  - 2 for anonymous writes

## Private: folders

- **In the clear:** folder addresses, file IDs, versions, epochs, week buckets, and the Swarm reference of the padded
  ciphertext.
- **Sealed:** every other value, with AES-256-GCM, bound to the entity it lives in.

| Schema | Written by (`$creator`) | Indexed | Stored | Expires | Counts only if the creator had, at creation |
|---|---|---|---|---|---|
| `haven.file` | the writer: drive key, room key or an editor's stealth address | `folder`, `fileId`, `version`, `epoch` | `swarmRef`, sealed `meta` (name, type, size, file key) | max, renewed by managers | WRITE, plus the read rules below |
| `haven.welcome` | the sharer | `folder`, `bucket` (week) | `ephemeralPub`, sealed member key | the member's end (or max) | SHARE |
| `haven.keycopy` | the sharer | `folder`, `recipient`, `version` | sealed epoch key or folder secret | the member's end (or max) | SHARE |
| `haven.roster` | a manager | `folder`, `version` | sealed managers, sealed members | max, renewed | SHARE |
| `haven.rotation` | a manager | `folder`, `version` | `t0`, `epochLength`, sealed folder name | max, renewed | SHARE |
| `haven.refresh` | a group manager | `folder` | `group`, sealed reason | 30 days | SHARE on the group, which is a member |
| `haven.link` | the sharer | `link` (namehash) | sealed bundle (one file's key and pointer) | the link's end | SHARE |
| `haven.tomb` | the writer | `folder`, `fileId` | – | max, renewed | WRITE |

**Ownership**
- Every entity is created **read-only**, so its attributes are exactly what its creator wrote at `$createdAt`.
- Validity goes by `$creator`, never `$owner`, because an owner can hand an entity to someone else.

**Read rules for files** ([`validator.ts`](../packages/core/src/validator.ts)). A file entry counts only if:
- the writer held WRITE at creation (`DriveRegistry.wasAllowedMany`, one view call per batch);
- the key version was the latest at creation;
- the epoch is within one epoch of creation, so nothing is back-dated;
- no refresh request was open, unless the writer is a manager.

`$createdAt` is a block number, so `BlockClock` converts it to a time.

**Queries the app runs**
- Files, rotations, refreshes and tombs: by `folder`
- Key copies: by `folder` + `recipient`
- Welcome notes: by `bucket`; the recipient tries each one on the device
- Links: by `link`

## Public: key directory and releases

- **No secrets.** Meant to be read by anyone, from any app.
- **Signed.** Each entry carries an EIP-712 signature (domain `{name: "Haven", version: "1", chainId: 11155111}`).
- **Validity goes by the signature,** never `$creator` or `$owner`:
  - any account can relay an entry (our API's `POST /keylog` does, so users need no tGLM);
  - an entry signed by anyone else is listed as forged.

| Schema | Signed by | Indexed | Stored | Expires |
|---|---|---|---|---|
| `haven.keylog` | the name's controller: the drive key for `<label>.haven.eth`, the token owner for any other ENSv2 name | `ensName`, `seq`, `kind` (`publish`, `rotate`, `revoke-device`) | `spendingPublicKey` (compressed), `devicePublicKey`, `prevEntryKey`, `sig` | max, renewable by anyone |
| `haven.device` | the name's controller | `ensName`, `deviceId` | `devicePublicKey`, `label` (sealed to the user), `sig` | 90 days; the device renews it while used |
| `haven.release` | the release key R | `version`, `rootHash` | `gitCommit`, `manifestSwarmRef`, `siteSwarmRef`, `sig` | max, renewable |
| `haven.unrelease` | the release key R | `rootHash` | `sig` | max, renewable |
| `haven.rebuild` | (none: one per `$creator`, counted by distinct creators other than the release key) | `rootHash` | `matched` (0/1) | max, renewable |

**Key log rules** ([`keydir.ts`](../packages/core/src/keydir.ts)). A name's history is its signed entries ordered by
`seq`, and is valid only if:
- `seq` runs 0, 1, 2… with no gap or duplicate;
- each `prevEntryKey` is the previous entry's Arkiv key;
- seq 0 is a `publish`.

The current key is the last `publish` or `rotate`. It must equal the name's `haven.key` text record when there is one.
Empty values are written as `NONE` ("none").

## Anonymous writes

- **Relayed by our API** (`POST /zk/join`, `POST /zk/file`), so `$creator` is our relayer and identifies nobody.
- **Valid by** a signature (joins) or a zero-knowledge proof (files); see [`zk.ts`](../packages/core/src/zk.ts).

| Schema | Valid because | Indexed | Stored | Expires |
|---|---|---|---|---|
| `haven.zkjoin` | EIP-712 signed by `member` (same domain as above), who held WRITE in `folder` at creation; a member's first valid join counts | `folder`, `member` | `commitment` (Semaphore identity commitment, decimal), `sig` | max, renewable by anyone |
| `haven.zkfile` | a Semaphore proof over the entry's own fields, against the folder's writer group at creation; then the file read rules, as for a non-manager | `folder`, `fileId`, `version`, `epoch` | `swarmRef`, sealed `meta` (as `haven.file`), `proof` (353 bytes: depth, root, nullifier, scope, 8 points) | max, renewable by anyone |

**The writer group** of a folder at time t:
- the commitments of valid joins created at or before the entry's block, whose member held WRITE at t;
- in join order, as Semaphore's LeanIMT;
- rebuilt by every reader from these entries and `DriveRegistry.wasAllowedMany`, so a removal or an end date drops a
  writer with no new entity;
- proven at depth 5 (up to 32 writers), with a fresh random scope each time, so nullifiers link nothing.

**Queries the app runs:** joins and anonymous files by `folder`.
