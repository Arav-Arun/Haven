# Plan B checks

Results of the first-hour checks and each step's "Done when" (see docs/plan/PLAN_B.md). Only what was actually run is
marked done.

## B1 · First-hour checks

| Check | Status | Notes |
|---|---|---|
| 6 · Bee node on Fly.io + postage batch | Not started | Needs a human: Fly.io account and xDAI + xBZZ on Gnosis (or a batch from the Swarm team) |
| 7 · Anon-RPC in a real browser (Nym / Nox / Tor) | Partly | The website boots the harness (`/anon-rpc-iframe.html` and `.js` are served from our origin). Not yet confirmed connecting: the Claude desktop preview browser blocks sub-frames (`ERR_BLOCKED_BY_CLIENT`), so run `pnpm --filter @haven/web dev` in Chrome and watch the header badge go from "Connecting privately" to "Private: Nym". Then record start-up time, JSON-RPC success, the live `supportsAnyHttps` probe result and `isolationKey` support here |
| 10 · Faucets | Done (human) | Deployer and relayer have 0.05 Sepolia ETH each (throwaway testnet wallets); tGLM requested for the relayer. Top the relayer up toward ~1 Sepolia ETH later |
| WalletConnect project ID | Done (human) | From dashboard.reown.com. Goes in apps/web/.env.local as NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID |
| Chrome Web Store developer account | Done (human) | Already registered |
| Arkiv access key | Done (human) | Created at hub.arkiv.network/access-keys; given to Person A for apps/api/.env only (Arkiv's guidance: never in a browser bundle) |

## B2 · `@haven/platform`

Done. `pnpm --filter @haven/platform test`: 10 tests pass.
- Routing through the worker; isolation keys only on isolated fetches.
- Failure is reported, never silently replaced by plain fetch.
- Missing bootstrap RPC or Tor gateways fail loudly instead of using built-in defaults.
- `supportsAnyHttps` is measured with a real request through the worker (`probeUrl`), not assumed.
- Storage: IndexedDB values are encrypted at rest under a non-extractable key.

## B3 · Parts that need no core

In progress. Done so far:
- Next.js 16 static export builds (`pnpm --filter @haven/web build`), hydrates, and renders in the browser.
- Settings come only from env; missing ones are listed on screen.
- Wallet connection (injected wallets). The connected address is checked for contract code on Sepolia through the
  Anon-RPC transport, and smart-contract wallets are pointed to passkey sign-in.
- Live private-network badge (connecting / private / not private).

- WalletConnect for phone wallets: the QR code is drawn locally (Reown's hosted modal never loads) and WalletConnect
  telemetry is off. The WalletConnect relay is still used, as the protocol requires.
- Settings page: pick Nox, Nym, Tor or Off. Networks the deployment can't support are disabled with the missing
  setting named. Shows live status and whether file and API traffic is routed (from the real probe). Checked in the
  browser: switching to Off shows the red "Not private" badge, and switching back to Nox restores it.
- Fixed: the bootstrap copy script now creates `public/`, which fresh clones (and Vercel) don't have.

- Signature collection is built (`/onboarding`): connect, contract-wallet check, one or two signatures as
  `needsSecondSignature` says, a mismatch check, the domain warning, then `signIn`. It runs as soon as
  `createDriveClient` is on `main`.
- WalletConnect checked with the real project ID: the QR code is drawn on the page and no Reown modal loads.

## B4 · `@haven/ui`

Done (typechecks against the frozen interface; 7 tests pass: formatting, error wording, the zip writer checked with
the system `unzip`).
- Look: cool paper, spruce ink, and one bold element, the **access ticket**: a coat-check stub whose serial number is
  the real random address the chain shows for that member. Hanken Grotesk for text, Big Shoulders for the wordmark and
  ticket numbers, both self-hosted at build time.
- Components: AppShell (sidebar on desktop, bottom tabs on phones), NetworkBadge, Ticket, FolderRows / FileRows (locked
  files say "Added after your access ended"), UploadDropzone (per-file progress, camera on phones, the padded size read
  from the upload's Swarm receipt step), FilePreview (image, video, audio, PDF, text; the preview re-types the bytes so
  a file labelled PDF can never render as a page), NewFolderDialog, ShareDialog (live ENS lookup, roles, "access until"
  presets, "hide from other members", the locked-files line), MembersPanel (tickets, countdowns, via group, needs gas,
  remove with the key-refresh line), RefreshPendingBanner, PublicViewPanel, ReceiptsDrawer (each route marked
  "Private (Nox)" or "Direct"), and a ZIP writer for "Download folder".
- Dialogs use the browser's own `<dialog>` instead of Radix (focus trap, Escape and backdrop built in, one less
  dependency). PDFs use the browser's own viewer instead of pdf.js.

## B5 · `apps/web`

Built and wired to the real client; waiting on `createDriveClient` (since done).
- Routes: `/`, `/onboarding`, `/drive`, `/rooms`, `/shared`, `/groups`, `/public`, `/settings`, `/l`, `/try`.
  Folders are `?f=<registry>` instead of `/drive/[...path]`, because Swarm can't rewrite paths for a static export.
  `/links` is left out: the frozen interface has `createLink` but no way to list links, so links are made from a
  file's row and shown once.
- With no client, every data screen says why (missing settings, or the client not in this build), never sample data.
- `pnpm --filter @haven/web build`: all 11 routes prerender as static pages. Checked in the browser at phone and
  desktop widths.
- Still to do: the strict CSP in `vercel.json`, after the Nox test in Chrome shows which origins the Anon-RPC worker
  needs; the Vercel deploy.

## B6 · Phone (PWA)

Built; the "Done when" needs a real Android phone and iPhone (human).
- `public/manifest.webmanifest`: standalone, start at `/drive/`, icons (SVG, 192, 512, maskable 512, Apple touch),
  and an Android `share_target` (POST, multipart, any file type).
- Icons are drawn by `scripts/make-icons.py` (Pillow) from `public/haven-mark.webp`: the shield mark on the blue tile.
- `public/sw.js`: caches the app's pages and hashed assets so it starts offline; never touches cross-origin traffic
  (RPCs, Bee, API). Shared files are parked in IndexedDB and the drive opens a "Save shared files" dialog to pick a
  folder; each is then encrypted and uploaded like any other file. Registered only in production builds.
- Settings → "Phone app": Chrome's install prompt, or iOS's "Add to Home Screen" steps. Camera upload on phones.
- No push notifications (a push server would learn who waits for what): the app checks on open.
- Pages export as `route/index.html` (`trailingSlash`), which Swarm can serve without rewrites (B10).
- Checked: the static build serves the manifest (`application/manifest+json`) and self-hosted fonts. The service
  worker could not be checked here: the Claude preview browser blocks service workers, as it blocks the Anon-RPC
  iframe. To check: `pnpm --filter @haven/web build`, serve `apps/web/out`, open it in Chrome, then DevTools →
  Application → Service workers / Manifest.

## Plan A steps A5 and A6, done on plan-b

At the owner's request, after merging `plan-a` (A1–A4), Plan A's API and client were written here.
- `packages/core/src/client.ts`: `createDriveClient`, every `DriveClient` method, built on A's library and following
  the A4 live run. `api.ts`: the signed claim request and the room proof-of-work. Tests: 2 new (claim signatures,
  proof-of-work); core's 43 non-chain tests pass. The two anvil test files need `forge build` (the ENS submodule).
- `apps/api` (Hono): `/claim`, `/room`, `/drip`, `/arkiv-rpc`, `/upload`, `/bytes/:ref`, `/config`, `/health`.
  7 tests: refusals before any network call (unsigned claims, no proof-of-work, disallowed Arkiv methods, unsigned
  uploads, bad references), config, CORS.
- `scripts/bootstrap.ts` (implementation, `haven.eth`, `rooms.haven.eth`, relayer registrar) and
  `scripts/e2e.ts` (the demo story with three random identities; writes `docs/evidence.md`).
- Both apps now use the real client. The website builds with it.
- **Not run live yet:** needs funded keys, the Arkiv access key, a Bee node or batch, and the deployed API. The order:
  `bootstrap` → start the API → `e2e`. Until then nothing has been checked against Sepolia, Arkiv or Swarm.

## Add-ons F3 (verified frontend) and the add-on UI

- **Reproducible build (check):** `generateBuildId` = git commit, `SOURCE_DATE_EPOCH` = the commit's time. Two clean
  builds (`rm -rf out .next && pnpm build`) of the same tree: every `.html`, `.js` and `.css` identical (`shasum`
  diff: 0 lines; 123 files). `pnpm --filter @haven/core release manifest` prints the root hash.
- **Add-on UI:** profile page `/u/?n=<name>` (fingerprint, "Verify in person", key history, forged entries, own
  devices); share dialog (fingerprint, a warning with "The words match: trust the new key", a Team tab with "N members
  found (M have no Haven key)"); members panel ("Via acme.eth", Exclude, last synced, Sync now, Stop sharing);
  Settings (your key, devices, link another ENS name with the wallet's `signTypedData`); folder view "Live" or
  "Checking every 30 s".
- **Not checked in a browser yet:** none of the add-on screens has been exercised against live data (no deployment
  yet). The web build passes.
