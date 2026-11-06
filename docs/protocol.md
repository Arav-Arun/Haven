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
