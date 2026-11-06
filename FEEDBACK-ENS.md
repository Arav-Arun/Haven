# Feedback on building with ENSv2

From building `DriveRegistry` on `ensdomains/contracts-v2` and running it against the Sepolia ENSv2 deployment.
Evidence for each point is in [`docs/checks-a.md`](docs/checks-a.md) and the tests under `contracts/test/`.

1. **`_onRolesGranted` / `_onRolesRevoked` can't be overridden.**
   `PermissionedRegistry` overrides both as `internal override` without `virtual` (at `48b3e2d`,
   `PermissionedRegistry.sol:501` and `:515`). A registry that wants to react to role changes (we record an access
   history) gets `Error (4334): Trying to override non-virtual function`. They also only run when `executeCallbacks`
   is true, which `UserRegistry.initialize` and `_register` skip. We hooked `EnhancedAccessControl._grantRoles` /
   `_revokeRoles` instead, which are `internal virtual` and see every path. Suggestion: mark the hooks `virtual`, and
   document which paths call them.

2. **The Sepolia deployment is 65 commits ahead of `main`.**
   The live contracts are branch `audit-results-19102026` (`6aac7c6`). Differences that broke our first integration:
   the registry walk (`findExactRegistry…`) moved to `UniversalHelper`; `UserRegistry` and `PermissionedResolver` take
   `Grant[]` at initialisation; the resolver keys records by DNS-encoded name (`setText(bytes,…)`). Suggestion: tag the
   deployed commit and link it from docs.ens.domains/learn/deployments.

3. **Upgrade freeze needs a workaround.**
   `_authorizeUpgrade` in `UserRegistry` isn't `virtual`, so a registry that should never be upgradeable has to strip
   `ROLE_UPGRADE` in `_getRoles`. It works (fuzzed over every caller), but an explicit "non-upgradeable" option would
   be clearer for apps whose users must trust the registry won't change under them.

4. **Expiring grants would be a great primitive.**
   Our `grantRolesUntil(roles, account, until)` plus `wasAllowed(account, roles, t)` turned out to be the core of the
   product: access that ends on its own, and a history any app can query as a view call (no archive node, no log
   scanning). Many apps want "editor until Friday". It might belong in Enhanced Access Control itself.

5. **The 15-holder cap counts raw storage.**
   An expired grant keeps its slot until someone revokes it, so we added a permissionless `sweep`. Worth documenting
   for anyone building roles that end.

6. **What worked well:** `VerifiableFactory.deployProxy` with an atomic initializer; per-resource roles with admin bits
   (our managers are just the drive roles plus their admin bits, so stock checks decide who may grant); and
   `PermissionedResolver` with records set during initialisation, so the relayer that deploys a user's resolver keeps
   no role on it.
