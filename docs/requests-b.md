# Requests from Person B to Person A

Resolved. Plan A's API (step A5) and `createDriveClient` (step A6) were written on `plan-b` after merging `plan-a`,
at the owner's request. Both apps now use the real client.

- Link URLs use the static page: `${appOrigin}/l/?n=<link name>#<key>` (the site is a static export served from Vercel
  and Swarm, which can't rewrite paths).
- "Try it" keeps two clients in one page, each with its own storage; the client keeps no module-level state.

## Open: add-on interface for @cloakroom/types (both people, on `main`)

The four add-ons (F1 key log, F2 subtree sharing, F3 verified frontend, F4 live updates) need new optional members on
`DriveClient`. `packages/types/src/index.ts` is frozen on our branches, so for now they live in
`packages/core/src/extras.ts` as `CloakroomClient extends DriveClient` (and `VerificationResult` in
`packages/core/src/release.ts`). Please copy into `@cloakroom/types` on `main`, as optional members, once you agree:

- `KeyLogEntry`, `KeyInfo` (with the added `ensRecord`, `ignored`, `problem`, `controller`), `DeviceInfo`,
  `SignTypedData`; `lookupKey?`, `confirmKeyChange?`, `listDevices?`, `revokeDevice?`, `linkName?`.
- `SubtreeRule`, `SubtreePreview`; `previewSubtree?`, `shareWithSubtree?`, `listSubtreeRules?`, `excludeFromSubtree?`,
  `removeSubtreeRule?`, `syncSubtrees?`.
- `LiveEvent`, `LiveStatus`; `subscribe?(folders, listener, onStatus?)`.
- `VerificationResult`.
