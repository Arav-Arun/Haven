# Add-ons F1–F4: what's on `addon` and what's left to wire

Branch `addon` merges `plan-a` and `plan-b` and adds four features. Each one has its logic in `@cloakroom/core` (tested
offline) and its screens in `@cloakroom/ui` / `apps/web` / `apps/extension`. The screens only show up once the client
has the matching methods, so nothing is faked until then.

| Feature | Core | Apps | Tests |
|---|---|---|---|
| F1 Public key directory + transparency log | `keydir.ts`, `cloak.keylog` / `cloak.device` in `arkiv.ts` | profile page `/u?n=`, fingerprint and key check in the share dialog, Settings → Devices | `keydir.test.ts` (17), live: `pnpm --filter @cloakroom/core f1` |
| F2 Share with an ENS subtree | `subtree.ts`, rules in the sealed roster (`records.ts`), `registeredLabels` / `labelState` / `creationBlock` in `ens.ts` | Team tab in the share dialog, "Shared with teams" panel, "Via acme.eth" badges | `subtree.test.ts` (18, incl. a 300-run property test), `subtree.local.test.ts` (needs anvil) |
| F3 Verified frontend | `release.ts`, `cloak.release` / `cloak.rebuild` / `cloak.release-revoke`, `storeSiteOnBee`, `downloadPublic` | extension checks every page, red overlay, keys only to verified pages; "Sign in with the extension" | `release.test.ts` (14), `release.site.test.ts` (against the real `apps/web/out`) |
| F4 Swarm doorbells | `doorbell.ts` (topics, 256-byte payloads, BMT/SOC, GSOC key mining, `subscribeRoom`) | folders and Shared reload on a ring, 30 s fallback, extension notifications | `doorbell.test.ts` (14), live: `pnpm --filter @cloakroom/core f4` |

## Person A: `createDriveClient` (A6) and the API (A5)

**F1** — expose, wrapping `keydir.ts`:
- `lookupKey(ensName)` → `lookupKey(readers, ensName)`; `confirmKeyChange(ensName)`;
  `listDevices()` → `myDevices(...)`; `revokeDevice(deviceId)`.
- `claimName`: after the name is registered, `ensureKeyPublished(writer, reader, ensName, spendingPublicKey)`.
- `signIn` on a device: `ensureKeyPublished` (no-op if current) and `registerDevice(writer, storage, ensName, label)`.
- `share` to a name: `assertCanShare(await lookupKey(...))` before anything is sent, then `rememberKey(...)`.

**F2** — expose `previewSubtree(parent)`, `shareWithSubtree(folder, parent, opts)`, `listSubtreeRules(folder)`,
`excludeFromSubtree(folder, parent, member)`, `removeSubtreeRule(folder, parent)`:
- create with `newSubtreeRule`, check with `previewSubtree` + `assertFits(withKey, SUBTREE_CAP - otherMembers)`;
- store rules in `Roster.subtrees` (already round-trips through `sealRoster` / `openRoster`; keep it when rewriting);
- `maintain()`: for each rule, `syncSubtree(rule, { listHolders: (r) => listSubtreeHolders(...), share, removeMember,
  requestRefresh, capacity, now })`, then write the returned rule back;
- `ruleView(rule)` is what the screens take.

**F3** — nothing in the client. API: none. Release key R: see "Releasing" below.

**F4** — expose `subscribe(folders, listener, onStatus?)` built on `subscribeRoom` (one per folder, with the held
epoch key and schedule; `onFallback` → `onStatus("polling")`). After each Arkiv write in `upload`, `share`,
`removeMember` and refresh: `ringViaApi(apiUrl, fetch, await makeDoorbellChunk(topic, target, await sealDoorbell(...)))`.
Mark the WebSocket as a `direct` route in receipts unless Anon-RPC carries it. API:
- `POST /doorbell` → `stampDoorbell(BEE_URL, POSTAGE_BATCH_ID, body)` (rate-limit it like `/upload`);
- `GET /doorbell/target` → `beeTarget(BEE_URL)` (clients mine their keys against it; cache it).

**Also changed in core:** `arkivReader` / `arkivWriter` now accept an empty access key when `rpcUrl` is the API's
`/arkiv-rpc` pass-through (browsers never hold the key, as `apps/web` already assumes).

**Types:** the proposed `@cloakroom/types` additions live as local types for now (`KeyInfo`, `SubtreeRule`,
`LiveEvent`, the optional `DriveClient` methods above). Agree them and add them to `main` together.

## Person B: apps and infra

- **Bee node (`infra/bee`):** allow `GET /gsoc/subscribe/<address>` WebSocket upgrades through the gateway, and
  `/bzz/<ref>/` for the verified copy.
- **Extension env:** `WXT_RELEASE_SIGNER` = R's address (added to `apps/extension/.env.example`). Without it every
  page is "unknown" and keys are never handed to a page.
- **Releasing (F3), from a clean checkout of the deployed commit:**
  ```
  CLOAKROOM_BUILD_ID=$(git rev-parse HEAD) SOURCE_DATE_EPOCH=0 pnpm --filter @cloakroom/web build
  pnpm --filter @cloakroom/core release publish     # needs BEE_URL, POSTAGE_BATCH_ID, RELEASE_PRIVATE_KEY, ARKIV_*
  ```
  Then the multisig sets `cloakroom.eth`'s contenthash to the printed `bzz://` reference. Anyone can attest a rebuild
  with `release rebuild <rootHash>`; R withdraws a release with `release revoke <rootHash>`.
- **README notes to add:** F3 catches files swapped for everyone, not a host that serves bad code only to one visitor
  (the Swarm copy covers that); MV3 re-downloads files to hash them. F4: our Bee node sees which topic addresses a
  connection subscribes to and when, and the IP unless routed; topics rotate every epoch and can't be linked to a
  room without its keys.
- **Fixed on the way:** `scripts/copy-anon-assets.mjs` failed on Windows (backslash paths); `wxt.config.ts` now keeps
  WXT's auto-imports out of workspace packages (it was injecting `wxt/utils/storage` into core).

## Checks still to run (need funds, keys or a node)

| Check | Command | Needs |
|---|---|---|
| F1 live: claim, publish, forged entry ignored, devices, rotate caught | `pnpm --filter @cloakroom/core f1` | Sepolia + Arkiv funds, `appRegistry` deployed |
| F2 subnames and a sync on a real chain | `vitest run test/subtree.local.test.ts` in `packages/core` | Foundry (`anvil`), `forge build` |
| F3 publish a release, extension shows "Verified" | `release publish`, load the deployed site | Bee + batch, R funded with tGLM |
| F4 chunk encoding vs Bee, a ring reaches a subscriber | `pnpm --filter @cloakroom/core f4` | Bee + batch |

If F4's ring doesn't arrive, the apps already fall back to a 30-second refresh; record the result in
`docs/checks-a.md`.

## Design choices that differ from the add-on spec

- **F1 fingerprint:** 88 bits (8 BIP-39 words), not the first 4 bytes: 32 bits can be matched by brute force.
- **F2:** a team member whose key changed is re-shared automatically (the parent name already controls their
  subname); the old share is removed first. Excluded names are never re-added.
- **F3:** a page may match any of the newest 3 non-revoked releases (a deploy rolling out). Keys go to the page over
  `window.postMessage` from the content script, as pairing already does, instead of `externally_connectable`.
- **F4:** the inbox doorbell is `HKDF(MK_S, "inbox")` rather than the sharer's ephemeral ECDH secret, which only the
  original sharer ever holds; this way any manager can ring it.
