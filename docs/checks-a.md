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
| 8 | Fluidkey kit: keys, S from P, recipient recovers S's key | Pending |
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
