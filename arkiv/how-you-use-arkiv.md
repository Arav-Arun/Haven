# How we use Arkiv

## Filters

Every screen is one indexed query. Nothing secret is indexed: only addresses, random IDs, numbers and a namehash.

| Screen | Query |
|---|---|
| Folder view | `haven.file` where `folder` = the folder's registry address |
| Opening a folder you were given | `haven.keycopy` where `folder` and `recipient` = your stealth address |
| Shared with me | `haven.welcome` where `bucket` is one of the last 8 weeks; each note is tried on the device |
| Members panel | `haven.roster` where `folder` |
| A share link | `haven.link` where `link` = the link's namehash |
| Profile page | `haven.keylog` where `ensName`, ordered by `seq` |

## Who can edit each entity

- **Anyone can write an entity that matches our queries,** so Arkiv ownership alone doesn't decide what's valid.
- **Every entity is created read-only.** Its attributes are exactly what its creator wrote.
- **Validity goes by `$creator`, checked against Sepolia.** The client calls `DriveRegistry.wasAllowedMany` to see
  whether the creator held the right role at `$createdAt`.
- **Users see the result.** Planted entries never show up, and the Public view counts them: "3 records were written
  here by addresses without access. Haven ignores them."
- **Renewal without edit rights.** Entities that managers keep alive use permissionless extension, so a manager can
  extend an editor's entry but can't change it.
- **Public records go by signature, not creator.** Key logs, devices and anonymous-writer joins carry an EIP-712
  signature, so our API can relay them and users need no tGLM.

## When each entity expires

| Entity | Expires | What the user sees |
|---|---|---|
| `haven.keycopy` | The member's end date | A new device can't fetch the key after access ends |
| `haven.welcome` | The member's end date | "Shared with me" scans only live notes, which keeps it fast on phones |
| `haven.link` | The link's end date | The link stops opening |
| `haven.device` | 90 days, renewed while used | A lost laptop drops off the account on its own |
| `haven.refresh` | 30 days | An unanswered key-refresh request clears itself |
| Everything else | Arkiv's maximum (about 182 days) | Managers' clients renew folder records |

## Arkiv features and where they show up

- **Indexed queries:** the folder view, "Shared with me", the members panel and the profile page.
- **`$creator` and `$createdAt`:** ignored writes in the Public view.
- **Expiry:** access that ends, links that stop, devices that drop off.
- **Permissionless extension:** folders that stay readable while managers renew them.
- **Explorer links:** every record in the Public view and every Arkiv transaction in the receipts panel.
- **Release log (`haven.release`):** the release tooling signs each build's file hashes with the release key and
  writes them to Arkiv. No screen in the web app reads them; they're a public record to check a build against.

## Live numbers (2026-11-07)

| Entity | Live | Distinct `$creator`s | Expiry observed |
|---|---|---|---|
| `haven.keylog` | 20 | 1 (relayed) | 7,884,000 blocks (about 182 days) |
| `haven.device` | 55 | 1 (relayed) | 3,888,000 blocks (90 days) |
| `haven.roster` | 25 | 15 | maximum |
| `haven.rotation` | 16 | 15 | maximum |
| `haven.keycopy` | 19 | 15 | member's end, or maximum |
| `haven.file` | 14 | 8 | maximum |
| `haven.zkjoin` | 11 | 1 (relayed) | maximum |
| `haven.release` | 12 | 1 (release key `0xBFc132fd…B50e`) | maximum |
| `haven.welcome` | 3 | 2 | member's end |

- Example entity: [`haven.file 0x9277d0e0…f121de`](https://rabdi.explorer.arkiv.network/entity/0x9277d0e012d0596341591326baaea3e2c583f43b374a3baada6553daaff121de)
  - Read-only with permissionless extension (`creationFlags.raw = 3`)
  - `folder` and `swarmRef` in the clear, `meta` sealed
- The README's curl command and SDK script return it.
