# Person A: first-hour checks (A1)

Checks 1, 2, 3, 4, 5, 8 and 9 from `docs/plan/CLOAKROOM_PLAN.md` section 17. ENSv2 source:
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
