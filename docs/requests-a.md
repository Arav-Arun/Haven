# Person A → Person B: requests and notes

Results and evidence are in `docs/checks-a.md`.

## What A needs from B

| # | What | Why | Due (PLAN_SHARED.md section 8) |
|---|---|---|---|
| 1 | `BEE_URL` and `POSTAGE_BATCH_ID`, sent privately, not committed | A4's live run, and the API's `/upload` | H4 |
| 2 | The Anon-RPC result: the default network, and whether `supportsAnyHttps` is true | Whether Swarm and API calls are routed or marked `direct` | H3 |
| 3 | That the Bee node accepts `POST /bytes` from the API's Fly machine (region `bom`), and from nowhere else if you lock it down | The API streams uploads to it | With 1 |
| 4 | The Swarm reference of the web build | A sets `cloakroom.eth`'s contenthash | H28 |

## Notes for B (no action unless stated)

1. **No change to `DriveClient` from A1–A5.** `packages/types` is untouched.
2. **Check 2 fallback:** the access history is recorded by overriding `_grantRoles` / `_revokeRoles`, because ENSv2's
   role hooks aren't virtual. This is internal to the contract.
3. **Contract calls are internal to core,** and they differ from the plan's text: `grantRolesUntil(roleBitmap, account,
   until)` and `sweep(account)` take no `resource`, since drive roles only exist at the registry's root.
4. **Sign-in:**
   - The message is one SIWE (ERC-4361) text naming the canonical origin. Its statement is one line, because ERC-4361
     forbids line breaks there.
   - `NEXT_PUBLIC_APP_ORIGIN` must be that canonical origin, the same in the Vercel build and the Swarm copy, or users
     get different keys.
   - A first device collects **two** signatures (`needsSecondSignature`); later devices collect one.
5. **The live Sepolia ENSv2 is newer than the plan's pinned source** (details in `docs/checks-a.md`).
   - Core handles it: the registry walk moved to a `UniversalHelper` contract, and resolvers and registries have new
     initializers.
   - If you use viem's ENS helpers directly anywhere, pass `universalResolverAddress` =
     `0x24e1d8e068620b647ca097f961a61055f4f42d72`, as the plan already says.
6. **The API (A5),** deployed on Fly once funded:
   - Its URL comes with the H12 handoff.
   - The client never calls it directly: `DriveClient` does (A6), with the request formats in `packages/core/src/api.ts`.
   - Allow-list its origin and the Bee URL in the web app's CSP `connect-src`.
7. **Arkiv:**
   - The access key is public by design: it ships with the app as `NEXT_PUBLIC_ARKIV_ACCESS_KEY`. Restrict it to our
     origins in the Arkiv hub if you can.
   - Writes need tGLM. Stealth editors are funded by the sharer in the same action; nobody funds a viewer.
8. **The repo is private.** It must be public for judging. The repo owner (B) flips it before submission.
