# Person A: checks and "Done when" results

Each Plan A step's "Done when" result, starting with the A1 first-hour checks (1, 2, 3, 4, 5, 8 and 9 from
`docs/plan/CLOAKROOM_PLAN.md` section 17). A2 is at the end. ENSv2 source:
`ensdomains/contracts-v2@48b3e2d39513b9dd32ef1850877a29009bc807b9` ("Post Audit Changes (#301)", 2026-07-03), vendored
as the submodule `contracts/lib/contracts-v2`. Toolchain: Foundry 1.8.7, solc 0.8.28, EVM `cancun`, Node 22.23.4.

| # | Check | Result |
|---|---|---|
| 1 | Register `cloakroom.eth` and `rooms.cloakroom.eth` | Pending (deployer not funded yet) |
| 2 | `DriveRegistry` at `48b3e2d` | **Pass, with one fallback** (2c, below) |
| 3 | PermissionedResolver sets `cloak.key`, deployer keeps no roles | Pending (needs Sepolia funds) |
| 4 | Namespace aliasing; expired subname stops resolving | Pending (needs Sepolia funds) |
| 5 | Arkiv: `$createdAt`, custom transport, expiry, tGLM transfer | Pending (needs Arkiv access key) |
| 8 | Fluidkey kit: keys, S from P, recipient recovers S's key | **Pass** (below) |
| 9 | Wallets sign the fixed message identically | Pending. Only MetaMask is available; Rabby and Ledger will be reported as untested |

Keys (in the gitignored repo-root `.env`, never committed): deployer `0xBFfd32f336D5201c0388C71Fd9e9754eC0692a54`,
relayer `0xaF3a34364A03119637c9517fdD914F7194F319F7`. Decision: the deployer registers `cloakroom.eth`; the name moves
to a team Safe later.

---

## Check 2: `DriveRegistry` hooks, bits, upgrade freeze, initializer

Evidence: `contracts/test/checks/Check2.t.sol` (6 tests, all pass; the fuzz test runs 1,024 cases). Run it with
`cd contracts && forge test --match-path test/checks/Check2.t.sol`. `SpikeDriveRegistry` in that file is a throwaway
prototype; step A2 replaces it.

| Part | Result | How it was shown |
|---|---|---|
| 2a. A registry derived from `UserRegistry` compiles | Pass | `forge build`: 77 files, solc 0.8.28 |
| 2b. Bits 40/44/48 and their admin bits are free and valid | Pass | No overlap with any `RegistryRolesLib` role (bits 0–36, 120, 124 and their admin bits); all are one-per-nybble bits inside `EACBaseRolesLib.ALL_ROLES`; a live grant of all three works and adds no registry role (`test_driveBitsAreFreeAndValid`) |
| 2c. `_onRolesGranted` / `_onRolesRevoked` usable for the access history | **Fail → fallback chosen** | See below |
| 2d. Stripping `ROLE_UPGRADE` in `_getRoles` blocks `upgradeToAndCall` | Pass | Reverts with `EACUnauthorizedAccountRoles(0, ROLE_UPGRADE, caller)` even when the caller holds every role in storage, upgrade included (fixed caller, plus a fuzz over 1,024 holders). Control: the same setup on a stock `UserRegistry` *does* upgrade. Mutation: with the strip removed, both freeze tests fail. The holder also can't grant `ROLE_UPGRADE` to anyone, because its admin bit is stripped too |
| 2e. Our own initializer works through `VerifiableFactory` | Pass | `deployProxy(impl, salt, initializeSpike(...))` runs atomically; `verifyContract(proxy) == impl`; neither initializer can run a second time (`test_initializerWorksThroughVerifiableFactory`) |

### 2c: why the hooks fail, and the fallback
- **Why:** `PermissionedRegistry` overrides both hooks as `internal override` **without `virtual`**
  (`PermissionedRegistry.sol:501` and `:515`; they call `_regenerate`). So `DriveRegistry` can't override them.
  Compiler output for an attempt: `Error (4334): Trying to override non-virtual function. Did you forget to add
  "virtual"?`
- **They would also have been incomplete:** the hooks only run when `executeCallbacks` is true. Both
  `UserRegistry.initialize` (`_grantRoles(ROOT_RESOURCE, …, false)`) and name registration
  (`PermissionedRegistry._register` → `_grantRoles(resource, …, false)`) skip them.
- **Fallback (used in A2):** record the history by overriding `EnhancedAccessControl._grantRoles` and `_revokeRoles`.
  Both are `internal virtual`, and neither `PermissionedRegistry` nor `UserRegistry` overrides them. Every grant and
  revoke goes through them, and they return whether anything changed. Tested: the initializer grant, `grantRootRoles`,
  `register` and `revokeRootRoles` all reach the override, and a repeated (no-op) grant isn't counted
  (`test_allGrantAndRevokePathsReachOverride`).
- **Impact on Person B:** none. This is internal to the contract; the `DriveClient` interface doesn't change.

### Notes for A2, from reading the `48b3e2d` source
- **The upgrade path is a single chain:** proxy `upgradeToAndCall` (`UUPSProxyLogic`) → `canUpgradeFrom` on the new
  implementation → the current implementation's OZ `upgradeToAndCall` → `_authorizeUpgrade` →
  `onlyRootRoles(ROLE_UPGRADE)` → `_checkRoles` → `hasRoles` → `_effectiveRoles` → `_getRoles`. `_authorizeUpgrade`
  is not `virtual` in `UserRegistry`, so the strip in `_getRoles` is the lever, as planned. A2 can additionally
  override OZ `upgradeToAndCall` (`public payable virtual`) to revert unconditionally.
- **Slot cap uses raw storage:** the 15-holder cap (`_roleCount`) counts raw storage, not `_getRoles`. An expired
  grant keeps its slot until `sweep` revokes it, which confirms that `sweep` is needed.
- **Operator approvals:** `PermissionedRegistry._getRoles` merges the token owner's roles into an operator approved
  with `setApprovalForAll`, but only for non-root resources. Drive bits live on the root resource, so this doesn't
  apply, as long as drive grants stay on root.
- **`UserRegistry.initialize` stays public on our implementation.** It's harmless, because proxies are always
  initialized atomically by `VerifiableFactory.deployProxy`, and the implementation's constructor disables
  initializers.
- **`ApprovedUpgradeGate.sol`** is a standalone owner-controlled allowlist. `UserRegistry` doesn't use it.

---

## Check 8: Fluidkey stealth-account-kit 1.1.1

Evidence: `packages/core/scripts/check8-fluidkey.ts`. Run it with `pnpm --filter @cloakroom/core check8`. It uses local
throwaway keys only and makes no network calls.

| Part | Result |
|---|---|
| A local wallet signs the fixed section 5 message twice → identical signatures; same signature → same keys | Pass |
| A different wallet's signature → different keys | Pass |
| Sharer: `generateStealthAddresses({ spendingPublicKeys: [P], ephemeralPrivateKey: e })` → S; recipient: `generateStealthPrivateKey({ spendingPrivateKey, ephemeralPublicKey: e·G })` → the key for S | Pass, 200 random rounds |
| A wrong spending key never recovers S | Pass, 200 rounds |
| Two shares to the same P give different S (unlinkable on chain) | Pass, plus no repeat across 200 rounds |
| Recovery cost per welcome note ("Shared with me" scan) | 1.83 ms in Node on this laptop; phones will be slower |

### Notes for A3 (`keys.ts`, `stealth.ts`), from reading the kit's source
- **What it derives:** `generateKeysFromSignature` sets the spending key to `keccak256(r)` and the viewing key to
  `keccak256(s)`, ignoring `v`. It only accepts a 65-byte signature (132 hex characters), so compact (EIP-2098) or
  contract-wallet signatures are rejected, which is consistent with refusing smart wallets.
- **Why check 9 matters:** a wallet that signs the same message differently gives different keys. Two different
  signatures from one address must be refused, as planned.
- **The scheme is multiplicative (Umbra-style):** `S_pub = P · keccak(ECDH(e, P))` and
  `S_priv = s · keccak(ECDH(s, e·G)) mod n`.
  - The recipient scans with the **spending** private key; the kit's viewing key isn't used in our flow.
  - The welcome-note seal (`HKDF(ECDH(e, P))`) reuses the same shared secret, kept separate from the kit's keccak by
    HKDF with its own info string.
- **`P` format:** uncompressed, 65 bytes (`0x04…`), as published in `cloak.key`. The kit also accepts compressed keys,
  but that wasn't tested here.
- **Dependencies:** the kit pins its own `viem` 2.7.9 and `@noble/secp256k1` 1.7.1 internally. Core itself uses
  `viem` 2.57.16.

---

## A2: `DriveRegistry`, part 1

Code: `contracts/src/DriveRegistry.sol`. Tests: `contracts/test/DriveRegistry.t.sol` (unit and fuzz),
`DriveRegistry.invariant.t.sol` and `DriveRegistry.fork.t.sol`. Run with `cd contracts && forge test`. The ABI and
addresses go to `packages/core/src/generated.ts` via `pnpm --filter @cloakroom/core gen`. Addresses are kept only in
`contracts/deployments/sepolia.json`, which was extracted from the plan's section 6 table.

| Done when | Status |
|---|---|
| `forge test` passes, including invariants and the fork test | **Partly.** 33 pass: 26 unit/fuzz (1,024 fuzz runs each), the invariant suite (256 runs × 64 calls, 0 unexpected reverts), and the 6 check-2 tests. The **2 fork tests are skipped**: they need `SEPOLIA_RPC_URL` and a pinned `SEPOLIA_FORK_BLOCK` |
| Implementation verified on Etherscan | Pending: needs Sepolia ETH on the deployer and `ETHERSCAN_API_KEY`. The script is ready: `script/DeployDriveRegistry.s.sol` |
| Demo proxy on Sepolia: grant → `wasAllowed` true → time passes → false, with the interval still readable | Pending deployment. Shown locally by `test_viewerAccessEndsExactlyAtUntil_andHistoryStaysReadable` and by the fork lifecycle test |
| `upgradeToAndCall` reverts when called by K | Shown in tests (`test_upgradeReverts_forOwnerAndWallet_withAnyTarget`, a fuzz over any caller, and invariants); onchain demo pending |

### What the contract does beyond the plan, and why
- **History lives in `_grantRoles` / `_revokeRoles`**, not in the hooks (check 2c).
- **Managers use ENSv2's own admin bits.** A manager is the three drive roles plus their admin bits, so stock checks
  decide who may grant.
- **Owner protection (a plan gap).** In stock ENSv2, an admin of a role can revoke it from *anyone*, so a stealth
  manager could have locked the owner out of their folder. Now only the owner can revoke or time-limit the owner's
  drive roles.
- **A grant never outlives the grantor,** so a manager can't extend its own access or hand out access longer than
  its own.
- **Expired roles never revive.** Re-granting an expired account clears its stale roles first; otherwise an old
  WRITE bit would come back with a new viewer grant.
- **All drive roles carry an end date.** They go only through `grantRolesUntil`; stock `grantRootRoles` refuses
  them, and they're refused on token resources.
- **The freeze has three layers:** the plan's strip in `_getRoles`, an `upgradeToAndCall` that always reverts, and
  `canUpgradeFrom → false`, so no existing proxy can be upgraded into a DriveRegistry.
- **History is a ring of 8 intervals per account.** Older intervals are overwritten (the events keep everything),
  and `wasAllowed` fails closed for those times. Each share uses a fresh stealth address, so real accounts stay well
  under 8.
- **`wasAllowedMany`** is a batch view for the validator, so one Anon-RPC round trip checks many entries.
- **Interface change:** `grantRolesUntil(roleBitmap, account, until)` and `sweep(account)` drop the plan's `resource`
  argument, because drive roles exist only on the root resource.

### Evidence the tests can fail
- **Mutation check:** `contracts/test/mutation/mutate.sh` applies 19 mutants, each breaking one rule (the upgrade
  strip, expiry, stale-role clearing, owner protection, the grantor bound, caller checks, end-boundary
  off-by-ones, early-end handling, history recording, packing, and so on). The full suite **kills all 19**. The
  invariant suite alone kills 12, including every history and expiry mutant. Its survivors are either
  defence-in-depth layers (removing one freeze layer leaves the other two holding) or paths the honest handler never
  takes; the unit tests cover each of those.
- **Independent invariant oracle:** after every handler step, the live permission check is recorded. At the end of
  each run, `wasAllowed` must agree with every past observation. The handler also asserts that a grant or revoke
  changes live roles by exactly the named roles, and it runs attack moves (a manager on the owner, a grant past the
  grantor's end, outsider and editor grants) that must all revert.

### Static analysis and size
- **Slither** (`uvx --python 3.12 --from slither-analyzer slither . --filter-paths "lib/|test/|script/"
  --exclude-informational --exclude-optimization`): no high or medium findings. There are 5 low results, all the
  `timestamp` detector. That's expected: access ends by time, and validators can shift timestamps by seconds while
  access windows are minutes to days.
- **Runtime size:** 19,847 bytes, a 4,729-byte margin under EIP-170. A7 (inheritance) and A9 (groups) add code, so
  watch it.

---

## A3: core foundations

Code: `packages/core/src/` — `crypto.ts`, `keys.ts`, `epochs.ts`, `padding.ts`, `stealth.ts`, `keycopies.ts`,
`transport.ts`. Tests: `packages/core/test/` (vitest + fast-check). Run with `pnpm --filter @cloakroom/core test`.

| Done when | Status |
|---|---|
| Same signature → same keys | **Pass.** Property test over 25 random wallets. The keys also equal the Fluidkey kit's own output, and v encoded as 0/1 or 27/28 gives the same keys |
| Different signatures → `WALLET_NOT_SUPPORTED` | **Pass.** A second valid signature made with a randomised nonce is refused. So are smart-contract wallets (but not EIP-7702 delegated EOAs), signatures from another address, and non-65-byte (e.g. ERC-6492) signatures |
| A holder of `E[j]` derives `E[i]` for every i ≤ j and never `E[j+1]` | **Pass.** Property test (40 random secrets and epochs). The reference chain is built from the spec (`E[i-1] = SHA-256(E[i])`); the API refuses `j+1` with `NOT_AUTHORIZED`; `E[j+1]` is a SHA-256 preimage of `E[j]`, and nothing the holder can compute equals it |
| Welcome round-trip; a wrong key doesn't match | **Pass.** The recipient opens MK_S and gets the private key of exactly the granted address S. A stranger's key, another folder, a tampered note or a malformed `e·G` all return no match. Scanning 10 notes for 5 people finds exactly each person's own |

**34 tests pass in about 2 s.** An 11-mutant check on the claims above kills all 11: going up the chain, the until
rounding, the back-dating window, accepting differing or foreign signatures, smart wallets, including `v` in K,
skipping the `cloak.key` comparison, unbinding welcomes from their folder, padding without the AES overhead, and the
`randomBytes` chunking.

### Decisions and findings
- **The sign-in statement is one line (a change from the plan's text).** ERC-4361 says the statement must not contain
  `\n`. A strict SIWE parser would reject the plan's two-line version, and the wallet's domain warning (the phishing
  defence) wouldn't fire. Check 9 will confirm MetaMask's warning.
- **The message names the canonical origin** (`config.appOrigin`), never the page's origin. The Swarm copy then gives
  the same keys, and wallets warn there by design.
- **K and K_room come from `r ‖ s`, not the full signature.** Wallets encode `v` differently, and including it would
  give one person different drive keys on different devices. The Fluidkey kit ignores `v` for the same reason.
- **Exact-size padding:** an encrypted file is exactly 64 KiB, 256 KiB, 1 MiB, 4 MiB, 16 MiB or 32 MiB, because the
  AES-GCM nonce and tag count inside the bucket. The cap is 25 MiB.
- **Bug found by the tests:** WebCrypto's `getRandomValues` refuses more than 64 KiB per call, so `randomBytes` now
  fills in chunks.
- **Binding and portability:**
  - Welcome notes and key copies are bound to their folder (AES-GCM associated data), and key copies to their
    version, so neither can be replayed elsewhere.
  - HKDF and SHA-256 use `@noble/hashes` (synchronous, the same on every platform); AES-GCM and randomness use
    WebCrypto.
  - Imports are extensionless, so Next.js can compile core without extra configuration.
- **For A6, epoch-key cost:** deriving E[0] from E[N] takes 8,760 SHA-256 calls, a few ms in Node. Readers should
  cache derived keys per folder version.

---

## A4: ENS, Arkiv, validator, Swarm client

Code: `packages/core/src/` — `ens.ts`, `arkiv.ts`, `validator.ts`, `swarm.ts`, plus `records.ts` (the sealed contents
of each entity), `receipts.ts`, `errors.ts` and `addresses.ts` (the single place addresses come from, generated from
`contracts/deployments/sepolia.json`). Tests: `packages/core/test/`. Live check: `packages/core/scripts/a4-live.ts`
(`pnpm --filter @cloakroom/core a4`).

| Done when | Status |
|---|---|
| A script on Sepolia + Arkiv + Bee creates a room | **Script ready, not run yet.** Blocked on: `SEPOLIA_RPC_URL`; Sepolia ETH for the deployer and relayer; the `DriveRegistry` implementation deployed (A2); `cloakroom.eth` and `rooms.cloakroom.eth` registered with the relayer as registrar (check 1); tGLM for the relayer; `BEE_URL` and `POSTAGE_BATCH_ID` from B |
| …writes and reads each schema | Script ready. It writes all eight schemas (rotation, roster, welcome, two key copies, three files, a tomb, a refresh request, a link) from the room key, the stealth editor and an attacker, reads each back, and decrypts them |
| …shows the validator hiding a planted write from an address without WRITE | Script ready. Locally: **pass** against a real `DriveRegistry` (below) |

**Local evidence (no network needed): 48 tests pass in about 2 s.** The ENS and validator tests start `anvil` and
deploy the compiled `ContractNamer`, `LabelStore`, `VerifiableFactory` and `DriveRegistry` from `contracts/out`, so
every role question is answered by the real contract's history. Run `forge build` in `contracts/` first.
- **`ens.ts` (5 tests):**
  - deploys a drive and a child folder through the factory;
  - lists children from `LabelRegistered` logs (forcing 2-block ranges to exercise the provider-limit fallback);
  - link names and mounts;
  - grants with an end, and access/history/`wasAllowed` before, during and after it;
  - sweeping an expired grant;
  - removal closing the interval at the removal time;
  - a manager can't share beyond its own end; an editor can't share;
  - reverts come back named: `NAME_TAKEN`, `NOT_AUTHORIZED`, `EXPIRED`.
- **`validator.ts` (2 tests):** one folder with a planted write for every rule — hidden as `no-role` (outsider,
  viewer, editor after removal), `not-readonly`, `back-dated`, `unknown-version`, `stale-version` and
  `refresh-open` — plus:
  - refresh requests from a non-member group or a group viewer;
  - an outsider's tomb;
  - rotations from an outsider or with a bad schedule;
  - planted key copies;
  - a manager may still write during an open refresh;
  - a re-upload after a tomb shows.
- **Mutation check on the validator: 17/17 killed.** Each rule was broken in turn (skip read-only, ignore group
  membership, answer every role question yes, drop stale/unknown version, drop back-dating, block managers too, never
  close a refresh, let a later duplicate rotation win, let a tomb delete later files, accept any schedule, ignore
  block order, let viewers write, let a group viewer open a refresh, stop counting malformed entities, accept key
  copies from editors), and a test failed every time. The first run left 3 survivors; one was an equivalent mutant
  and two exposed missing test cases, which were added.
- **`records.ts` and `swarm.ts` (7 tests):**
  - file meta opens only with its epoch key at its exact folder, file id, version, epoch and Swarm reference
    (property test);
  - roster halves can't be swapped; link bundles are bound to their name;
  - a signed upload verifies only the exact body, signer, folder and a fresh time;
  - uploads and downloads go through a local HTTP server standing in for the API and Bee, and the receipt marks a
    call `direct` when the private network can't carry HTTPS;
  - unpadded uploads and odd-sized downloads are refused.

### Decisions and findings
- **Arkiv's `$createdAt` is a block number, not a time** (SDK 1.0.1 types: "Block the entity was created at"). It can
  be selected but not filtered or sorted on. The validator therefore reads each block's timestamp once (`BlockClock`)
  and asks `wasAllowed` at that time. Ordering between Arkiv entities (which rotation was latest when a file was
  written, whether a refresh was open) uses block numbers, which are exact. The live script also checks that
  `$createdAt` equals the creating transaction's block (check 5).
- **Every entity is created read-only, and validity goes by `$creator`.** Arkiv lets an owner patch an entity or hand
  it to another address, so a writer could otherwise change an entry after losing access, or launder it through a new
  owner. Entities without the read-only flag are hidden. Entries that managers renew (files, key copies, rosters,
  rotations, tombs) also allow permissionless extension, so a manager can renew an editor's entry without being able to
  change it.
- **Three schema additions beyond the plan's table:**
  - `cloak.rotation.name`: the folder's display name, sealed with `E_v[0]` so every reader of version v can open it;
    the plan didn't say where display names live;
  - `cloak.refresh.group`: the validator needs to know which group's managers may open the request;
  - `cloak.link.folder`: which folder's managers may write the link.
- **Welcome notes store `e·G` compressed (33 bytes).** Uncompressed it's 132 hex characters, over Arkiv's 128-byte
  string limit.
- **Refresh requests count only from a group that is itself a member of the folder.** Otherwise any group manager
  anywhere could block a folder's editors.
- **Sealed contents are bound to their place.** File meta uses folder, file id, version, epoch and Swarm reference as
  associated data, so a valid blob can't be copied into another entry. The two roster halves and link bundles are
  bound the same way.
- **Uploads are signed per body.** The writer signs an EIP-191 message naming the folder, its own address, the
  body's SHA-256 and the time. The API (A5) verifies it with the same `verifyUpload`, then checks `wasAllowed(WRITE)`
  now. Only padding-bucket sizes are accepted, both ways.
- **Writes are simulated before sending,** so a revert comes back as a named error (`NAME_TAKEN`, `NOT_AUTHORIZED`,
  `EXPIRED`, `RATE_LIMITED` for the 15-holder cap) rather than a bare failure.
- **Folder tokens are registered with no token roles.** The registry's root roles (K everyday, W dangerous) already
  govern the name, so the hot key gains nothing on the token.
- **Child folders are listed from logs (`eth_getLogs`).** This is the plan's "(check)" item. The scan starts at the
  registry's creation block and halves the range when a provider refuses one. Whether the chosen RPC accepts it is
  part of the live run; the fallback (a sealed `cloak.index` entity per owner) stays available.

## Add-ons F1, F2, F4 (core and API), done on plan-b

Spec: the add-ons build spec (F1 key log, F2 subtree sharing, F3 verified frontend, F4 doorbells). Names follow the
repo (`cloak.*`, `cloakroom.eth`) rather than the spec's older `hush.*`, `hushdrive.eth`.

- **Interface:** `packages/types` is frozen on branches, so the new members live in `packages/core/src/extras.ts`
  (`CloakroomClient extends DriveClient`); `docs/requests-b.md` asks for them on `main`.
- **F1 check, the signer.** The spec says "the signer is the name's current drive-root K". That holds for
  `<label>.cloakroom.eth` (`driveOwner(findExactRegistry(name))`). Other names (needed for F2: `priya.acme.eth`) have no
  drive root, so their controller is the token owner in the parent registry (`getStatus`, `getExpiry`, `getTokenId`,
  `ownerOf`). Validity goes by the EIP-712 signature, not `$creator`, so the API relays entries (`POST /keylog`) and
  users need no tGLM; a forged entry is ignored and listed.
- **F1 deviation:** the fingerprint uses the first 8 bytes of `keccak256(compressed key)`, one word per byte from a
  frozen 256-word list (64 bits), instead of 4 bytes as 8 words (which would be 4 bits per word).
- **F1 deviation:** `spendingPublicKey` is stored compressed (0x + 66 hex): uncompressed is over Arkiv's 128-byte str
  limit. Empty values are written as `"none"` (Arkiv attributes are set or absent).
- **F2 check: listing subnames.** `LabelRegistered(tokenId, labelHash, label, owner, expiry, sender)` carries the label
  string, so no `LabelStore` read is needed; it's the same event our own `listChildren` already uses (DriveRegistry
  inherits it from `PermissionedRegistry`). The scan of someone else's registry starts at its creation block, found by
  binary search over `eth_getCode` (needs an RPC that serves past state). **Not yet run against a live third-party
  registry.**
- **F2:** the "until the sync runs" refresh-request case can't arise as written: only managers can read the rule
  (it's in the sealed roster), and a manager's app always holds the folder secret, so it refreshes directly.
- **F4 check: GSOC with bee-js 13.2.0 and our node.** Implemented against Bee's HTTP API directly (no bee-js
  dependency): SOC upload `POST /soc/{owner}/{id}?sig=`, subscription `GET /gsoc/subscribe/{address}` (WebSocket,
  proxied by the API, which keeps Bee private), BMT chunk address (tested against Swarm's known empty-chunk address
  `b34ca8c2…`), EIP-191 SOC signature. **Not verified live:** whether a Bee *light* node (`infra/bee`) delivers GSOC
  messages; GSOC is documented for nodes in the chunk's neighbourhood. **Fallback, already built:** with no doorbell
  config (`DOORBELL_PROXIMITY` empty) or a dropped socket, the client re-reads Arkiv every 30 s. Spec's feed fallback
  was replaced by this, since it works without a postage write per poll.
- **F4:** the personal inbox doorbell was not built: as the spec notes, the first share is still found by the Arkiv
  scan, and every later event comes through the room doorbell.
- **Tests:** `packages/core/test/addons.test.ts`, 18 tests (key chains: valid, gap, broken link, tampered, forged,
  wrong signer; agreement; trust on first use; fingerprints; expired and revoked devices; subtree add, revoke, exclude,
  transfer, cap, and that the sealed roster contains neither `acme` nor its namehash; doorbell 256-byte payloads,
  wrong-topic and forged rings, topic per epoch, mining; release manifests). Core: 68 tests pass. API: 9 (adds
  `/keylog` and `/doorbell` refusals).
