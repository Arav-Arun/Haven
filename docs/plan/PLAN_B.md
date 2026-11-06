# Plan B: apps and infra (website, phone, extension, Bee node)

**Person B owns:** `packages/platform/`, `packages/mock/`, `packages/ui/`, `apps/web/`, `apps/extension/`,
`infra/bee/`, `README.md`, `AI_USAGE.md`, `docs/checks-b.md`. Branch: `plan-b`.

## Starter prompt (paste into your Claude agent)

> You are building Plan B of Hushdrive in this repo. Read `CLAUDE.md`, `docs/plan/HUSHDRIVE_PLAN.md`,
> `docs/plan/PLAN_SHARED.md` and `docs/plan/PLAN_B.md`, in that order.
> - Edit only the folders Plan B owns.
> - Use only the frozen interface in `packages/types/src/index.ts`; never edit it.
> - Until the checkpoint merge, build everything against your own mock client (`@hush/mock`).
> - Work through the steps of `PLAN_B.md` in order. After each step, run its "Done when" check, write the result in
>   `docs/checks-b.md`, commit and push.
> - Load the `frontend-design` skill and ethskills `frontend-ux` before building screens.
> - No third-party scripts, trackers or analytics, ever.
> - Ask me before any step that needs a human: accounts, funding, store submissions, phones.

**Human-only tasks for Person B:**
- Fly.io account.
- Funding the Bee node (xDAI + xBZZ on Gnosis), or getting a postage batch from the Swarm team.
- Reown (WalletConnect) project ID.
- Chrome Web Store developer account (one-time fee).
- Testing on a real Android phone and iPhone.
- Recording the video.

---

## B0 · Start (H0–H0.5)
After A pushes Step 0: clone, `git checkout -b plan-b`, `pnpm install`.
**Done when:** the repo builds and the frozen interface compiles.

## B1 · First-hour checks (H0.5–H3)
Run checks 6, 7 and 10 from `HUSHDRIVE_PLAN.md` section 17:
- **Bee node** (`infra/bee/`): `ethersphere/bee` on Fly.io with a persistent volume and a Gnosis RPC. The human funds
  it or gets a batch from the Swarm team. Buy or obtain a postage batch, then upload and download a test file.
- **Anon-RPC:** a bare static test page with `@anon-rpc/browser-harness` 0.4.0. For Nym, Nox and Tor, measure:
  - start-up time;
  - JSON-RPC to Sepolia and to Arkiv (`eth_blockNumber`, `eth_call`, `eth_getLogs`, `eth_sendRawTransaction` of a
    zero-value tx);
  - **whether any HTTPS request works** (`GET <bee>/health`, `GET <api>/health`);
  - whether `anonOptions.isolationKey` is accepted.

  Repeat inside a bare WXT extension with `@anon-rpc/browser-extension-harness`.
- **Accounts:** faucets, WalletConnect project ID, Chrome Web Store developer account.

**Done when:** `docs/checks-b.md` has the numbers. A has the default network and `supportsAnyHttps` (H3), plus
`BEE_URL` and `POSTAGE_BATCH_ID` by private message (H4).
**If any-HTTPS doesn't work:** ask the EF team at their booth for a worker setting that allows our Bee and API hosts,
and record their answer.

## B2 · `@hush/platform` (H3–H5)
- **`createAnonFetch({ platform: "web" | "extension", network, bootstrapRpcUrl })`** returns `AnonFetch`:
  - web uses `AnonRpcWorker`, with the bootstrap page served by us (`iframeUrl: "/anon-rpc-iframe.html"`) for strict
    CSP;
  - the extension uses the extension harness (offscreen document);
  - `isolated(key)` passes `anonOptions.isolationKey`;
  - `supportsAnyHttps` comes from B1's result (a constant per network);
  - `"off"` returns plain `fetch` with state `"off"`.
- **`createWebStorage()`:** IndexedDB, with values wrapped by a non-extractable WebCrypto key.
- **`createExtensionStorage({ persist })`:** `chrome.storage.session` by default; `local` when "keep me signed in".

**Done when:** a test page shows Sepolia and Arkiv block numbers through Nym (or the chosen default), with status
going `connecting` → `ready`; storage round-trips.

## B3 · `@hush/mock` (H3–H6)
`createMockDriveClient(config)` implements **every** `DriveClient` method in memory (persisted to IndexedDB), with
realistic delays and fake receipts (random hashes, route steps).
- **Seeded demo data:**
  - Acme's unlinked room "Series A", containing the deck, financials and a "Legal" subfolder;
  - members: an investor (private, ending in 2 minutes), an editor and a manager;
  - a group;
  - an expiring link.
- **It must behave like the real thing where the UI depends on it:**
  - 1-minute epochs, so files uploaded after a member's end show `readable: false` for that member;
  - `refreshPending` blocks editor uploads with `REFRESH_PENDING`;
  - the two-signature rule and `WALLET_NOT_SUPPORTED`;
  - `publicView` with the summary sentence and `directCalls`;
  - `maintain()` returning top-up receipts.

**Done when:** a test calls every method and checks those behaviours.

## B4 · `@hush/ui` (H5–H9)
Mobile-first React + Tailwind v4 components (Radix for dialogs, lucide icons, pdf.js for PDF preview). Load the
`frontend-design` skill first and choose a calm, trustworthy, distinctive look.
- **Shell and onboarding:**
  - **AppShell:** sidebar on desktop, bottom tabs on phones.
  - **Onboarding:**
    - wallet sign-in: explain why there are two signatures; refuse smart wallets with a passkey suggestion;
    - name claim with live progress;
    - "Try it".
- **Browsing files:**
  - **FolderList / FileList:** name, size and uploader. Locked files show as "Added after your access ended". Includes
    "Download folder".
  - **UploadDropzone** with per-file progress, and a "Padded to 1 MB" hint.
  - **FilePreview:** image, PDF, video, text.
  - **NewFolderDialog:** "In my drive" vs "Unlinked room (recommended for data rooms)", and "Subfolder: same access /
    separate access".
- **Sharing:**
  - **ShareDialog:**
    - live ENS lookup (with an error when the recipient has no `hush.key`);
    - role;
    - "access until" presets (1 hour, 1 day, 1 week, end of month, custom, never);
    - "hide from other members";
    - the line: "New files will be locked for them after this date. What they already opened, they keep."
  - **MembersPanel:**
    - countdowns, "via group" badges, "needs gas" warnings;
    - Remove, with the line: "Keys for this folder and its subfolders will be refreshed now."
  - **RefreshPendingBanner:** "Waiting for the owner to refresh access."
- **Transparency:**
  - **PublicViewPanel:**
    - side-by-side: what anyone sees (random addresses, end dates, ciphertext, Etherscan and Arkiv explorer links)
      vs what you see;
    - the summary sentence;
    - the hidden-writes count;
    - the direct-calls list.
  - **ReceiptsDrawer:** every step, with explorer links and each route marked "Private (Nym)" or "Direct".
  - **NetworkBadge:** a green "Private: Nym" (with status), or a red "Not private" banner when off or failed.
- **Settings:** network picker, devices, connect extension, sign out.

**Copy rules:** never say "they lose access to the files" or "access disappears". Say "new files are locked for
them".

**Done when:** every component renders against the mock at phone and desktop widths, and passes a quick keyboard and
screen-reader check.

## B5 · `apps/web` (H8–H14)
- **App:** Next.js 16, `output: 'export'`; `transpilePackages` for the workspace packages.
- **Providers:**
  - wagmi (injected + WalletConnect);
  - the client from `NEXT_PUBLIC_DRIVE_MODE` (`createMockDriveClient` now, `createDriveClient` after M1);
  - `createAnonFetch` + `createWebStorage`.
- **Routes:**

  | Route | What |
  |---|---|
  | `/` | Landing + sign-in |
  | `/onboarding` | Sign-in and name claim |
  | `/drive/[...path]` | Your drive |
  | `/rooms` | Unlinked rooms |
  | `/shared` | Shared with me |
  | `/groups` | Groups |
  | `/links` | Your links |
  | `/l/[name]` | Opens a link, no wallet; reads the `#fragment` only on the client |
  | `/settings` | Settings |
  | `/try` | "Try it" |
  | `/public/[folder]` | Public view |
- **Headers (`vercel.json`):** strict CSP, no third-party origins except our API, Bee and RPCs. Serve
  `/anon-rpc-iframe.html` and its script ourselves.
- **Deploy:** Vercel, in mock mode, from the first day.

**Done when (B's M1 deliverable):** every Must screen works on the mock on desktop and phone widths, and the Vercel
preview URL is live.

## — M1 at H14 (`PLAN_SHARED.md` section 9): switch the website to `DRIVE_MODE=real` —

## B6 · Phone (PWA) (H15–H18)
- Serwist (`@serwist/next` 9.5): manifest, icons, standalone display, offline app shell.
- `share_target` for Android: the service worker stores shared files in IndexedDB, then opens the upload dialog.
- Install prompt; "Add to Home Screen" hint on iOS; camera upload (`capture`).
- "Connecting privately…" screen while the worker starts.
- No push notifications (a push server would learn who waits for what): check on open.

**Done when:** installed and used on a real Android phone and a real iPhone, with "Share to Hushdrive" working from the
Android gallery.

## B7 · Extension (H17–H24)
`apps/extension` with WXT 0.21 + React + `@hush/ui`, MV3.
- **Permissions:** `storage`, `contextMenus`, `alarms`, `notifications`, `offscreen`, `sidePanel`. Host permissions
  only for our API, Bee and RPCs.
- **Pairing:**
  - the website's Settings → "Connect extension" → `chrome.runtime.sendMessage(EXT_ID, seed)`, after the user
    confirms;
  - the manifest's `externally_connectable` allows only our origins;
  - the extension calls `signIn({ kind: "seed" })`.
- **Popup:** recent files, Shared with me, drag to upload (choose a folder).
- **Right-click:** "Save to Hushdrive" on images, links and the page (Should: the page as MHTML).
- **Background:** a `chrome.alarms` check every 15 minutes that runs:
  - `sharedWithMe({ since })` → badge and notification;
  - for owners and managers, `maintain()` (gas top-ups, open refreshes, renewals) → a notification of what it did.
- **Side panel** (Should): the full drive.
- **Release:**
  - build the zip and attach it to a GitHub release;
  - the human submits it unlisted to the Chrome Web Store **by H20** (review may not finish).
  - Firefox signed XPI is a Stretch.

**Done when:** a fresh Chrome profile loads the unpacked zip, pairs with the website, gets a badge for a new share, and
saves an image privately.

## B8 · "Try it" (H22–H25)
- `/try`: two fresh identities from random seeds (Founder, Investor), with no wallet.
- Claims their names, creates a room with sample files, shares it, and shows a switcher.
- Demo-mode banner: "Test network, 1-minute access windows."

**Done when:** a judge with no wallet can run the whole demo story in one tab.

## B9 · Real-mode polish (H24–H28)
- **Slow private network:** skeletons, optimistic updates with receipts confirming.
- **Errors mapped from `DriveErrorCode`:**
  - `REFRESH_PENDING` → "Waiting for the owner to refresh access";
  - `WALLET_NOT_SUPPORTED` → passkey suggestion;
  - `KEY_MISMATCH` → "This sign-in gives different keys; your files are safe";
  - `NO_HUSH_KEY` → "This name hasn't set up Hushdrive yet".
- Empty states.
- **Should:**
  - passkey sign-in (WebAuthn PRF) → `signIn({ kind: "passkey" })`;
  - local search over decrypted names (MiniSearch).

## B10 · App copy on Swarm (H27–H29)
- Static export → upload to our Bee with swarm-cli (`--index-document index.html`).
- Check that absolute asset paths load: use a subdomain gateway such as bzz.link, or set Next's `basePath`.
- Send the reference to A (H28) for `hushdrive.eth`'s contenthash.

**Done when:** the app loads from the Swarm URL with Vercel switched off.

## B11 · README, CROPS, AI usage (H28–H30)
- **`README.md`:**
  - pitch and tagline (section 1 wording);
  - how to try it (website, phone, extension, "Try it");
  - architecture diagram and screenshots;
  - link to `docs/protocol.md`, plus the sections A owns (merged at M2).
- **`CROPS` section:** C / O / P / S lines from the CROPS gate in `HUSHDRIVE_PLAN.md` section 21, including:
  - the "who can link what" table;
  - routed vs direct traffic.
- **`AI_USAGE.md`:** how Claude agents built it, per person.

## — M2 at H30 —

## B12 · After M2 (H30–H36)
- Integration checklist with A (`PLAN_SHARED.md` section 9).
- **Video (3 minutes or less)** following `HUSHDRIVE_PLAN.md` section 18:
  - record on the real website, phone and extension;
  - note the timestamp where Swarm is used, for `arkiv/swarm.md`.
- Final Vercel deploy; extension release; run `ethskills:qa`.

---

## If you fall behind
- **Cut, in this order:** Firefox → Gmail button → search → passkey → side panel → save page as MHTML.
- **Never cut:**
  - the onboarding checks;
  - the share dialog wording;
  - the Public view with its summary sentence;
  - the receipts with routes;
  - the network badge;
  - the locked-file state;
  - the PWA install;
  - the extension popup and badge;
  - "Try it".
