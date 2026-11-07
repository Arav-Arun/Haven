# Why Arkiv

Haven shares sensitive files without a central list of who got what. Arkiv is where that state lives instead of a
database we run.

## What users would lose with Postgres

- **Expiry enforced by the database, not by us.**
  - A guest's key copy and welcome note are written with an expiry equal to the end of their access.
  - Arkiv drops them at that block. With Postgres, users would have to trust our cleanup job.
- **No server watching reads.**
  - With Postgres, our server would log who opened which folder, when and how often.
  - With Arkiv, clients read a public database through Anon-RPC, with a separate isolation key per room and per share.
  - There is no Haven database to breach, subpoena or switch off.
- **Writes we can't forge or hide.**
  - Each file entry is created and paid for by the key that wrote it (an editor's stealth address, a room key).
  - We can't add, change or hide a file. Every client checks every entity's `$creator` against the folder's roles on
    Sepolia.
- **Auditable storage.**
  - The Public view lists every record stored for a folder, each linked to the Arkiv explorer.
  - With Postgres, users would have to take our word for what we keep.

## What we keep off Arkiv

| Data | Where | Why |
|---|---|---|
| File contents | Swarm | Entities hold up to 128 KiB; files go up to 25 MB. Arkiv holds the pointer and sealed metadata |
| Roles and role history | ENSv2 on Sepolia (`DriveRegistry`) | Permissions belong to the folder's ENS name; any app can call `wasAllowed(account, role, t)` |
| Private keys | The user's device | Derived in the browser from one wallet signature, never sent anywhere |
| Arkiv access key | Our API (`/arkiv-rpc`) | Arkiv's guidance is not to ship it in a browser bundle |

## Verify it

- Arkiv's public endpoint returns our entities with no access key. The README has a curl command and an SDK script.
- Example file entry:
  [`0x9277d0e0…f121de`](https://rabdi.explorer.arkiv.network/entity/0x9277d0e012d0596341591326baaea3e2c583f43b374a3baada6553daaff121de)
  shows its creator, expiry and sealed `meta`.
