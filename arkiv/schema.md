# Arkiv schema

Thirteen entity types: eight private ones for folders, and five public ones (add-ons F1 and F3). All are defined in [`packages/core/src/arkiv.ts`](../packages/core/src/arkiv.ts) with the SDK's `defineSchema`.

## Private: folders

Only folder addresses, file ids, versions, epochs, week buckets and the Swarm reference of padded
ciphertext are in the clear; every other value is sealed (AES-256-GCM, bound to where it lives).

| Schema | Written by (`$creator`) | Indexed | Stored | Expires | Counts only if the creator had, at creation |
|---|---|---|---|---|---|
| `cloak.file` | the writer (K, K_room or a stealth editor) | `folder`, `fileId`, `version`, `epoch` | `swarmRef`, sealed `meta` (name, type, size, file key) | max, renewed by managers | WRITE, plus the read rules below |
| `cloak.welcome` | the sharer | `folder`, `bucket` (week) | `ephemeralPub`, sealed member key | the member's end (or max) | SHARE |
| `cloak.keycopy` | the sharer | `folder`, `recipient`, `version` | sealed epoch key or folder secret | the member's end (or max) | SHARE |
| `cloak.roster` | a manager | `folder`, `version` | sealed managers, sealed members | max, renewed | SHARE |
| `cloak.rotation` | a manager | `folder`, `version` | `t0`, `epochLength`, sealed folder name | max, renewed | SHARE |
| `cloak.refresh` | a group manager | `folder` | `group`, sealed reason | 30 days | SHARE on the group, which is a member |
| `cloak.link` | the sharer | `link` (namehash) | sealed bundle (one file's key and pointer) | the link's end | SHARE |
| `cloak.tomb` | the writer | `folder`, `fileId` | – | max, renewed | WRITE |

Every entity is created **read-only**, so its attributes are exactly what its creator wrote at `$createdAt`. Validity
goes by `$creator`, never `$owner` (an owner can hand an entity to someone else).

**Read rules for files** ([`validator.ts`](../packages/core/src/validator.ts)): the writer held WRITE at creation
(`DriveRegistry.wasAllowedMany`, one view call per batch); the key version was the latest at creation; the epoch is
within one epoch of creation (no back-dating); and no refresh request was open unless the writer is a manager.
`$createdAt` is a block number, so `BlockClock` turns it into a time.

**Queries the app runs:** files, rotations, refreshes and tombs by `folder`; key copies by `folder` + `recipient`;
welcome notes by `bucket` (the recipient tries each one on the device); links by `link`.

## Public: key directory and releases (add-ons F1, F3)

These hold no secrets and are meant to be read by anyone, from any app. Each carries an **EIP-712 signature**
(domain `{name: "Cloakroom", version: "1", chainId: 11155111}`), and readers go by that signature, never by `$creator`
or `$owner`. So any account may relay an entry (our API's `POST /keylog` does, so users need no tGLM) and an entry
signed by anyone else is simply listed as forged.

| Schema | Signed by | Indexed | Stored | Expires |
|---|---|---|---|---|
| `cloak.keylog` | the name's controller: K of the drive root for `<label>.cloakroom.eth`, the token owner for any other ENSv2 name | `ensName`, `seq`, `kind` (`publish`, `rotate`, `revoke-device`) | `spendingPublicKey` (compressed), `devicePublicKey`, `prevEntryKey`, `sig` | max, renewable by anyone |
| `cloak.device` | the name's controller | `ensName`, `deviceId` | `devicePublicKey`, `label` (sealed to the user), `sig` | 90 days; the device renews it while used |
| `cloak.release` | the release key R | `version`, `rootHash` | `gitCommit`, `manifestSwarmRef`, `siteSwarmRef`, `sig` | max, renewable |
| `cloak.unrelease` | R | `rootHash` | `sig` | max, renewable |
| `cloak.rebuild` | (none: one per `$creator`, counted by distinct creators other than R) | `rootHash` | `matched` (0/1) | max, renewable |

**Key log rules** ([`keydir.ts`](../packages/core/src/keydir.ts)): a name's history is its signed entries ordered by
`seq`; it is valid only if `seq` runs 0, 1, 2… with no gap or duplicate, each `prevEntryKey` is the previous entry's
Arkiv key, and seq 0 is a `publish`. The current key is the last `publish` or `rotate`; it must equal the name's
`cloak.key` text record when there is one. Writes use `NONE` ("none") instead of an empty string.
