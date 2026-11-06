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
