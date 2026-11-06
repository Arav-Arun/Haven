# Plan B checks

Results of the first-hour checks and each step's "Done when" (see docs/plan/PLAN_B.md). Only what was actually run is
marked done.

## B1 · First-hour checks

| Check | Status | Notes |
|---|---|---|
| 6 · Bee node on Fly.io + postage batch | Not started | Needs a human: Fly.io account and xDAI + xBZZ on Gnosis (or a batch from the Swarm team) |
| 7 · Anon-RPC in a real browser (Nym / Nox / Tor) | Partly | The website boots the harness (`/anon-rpc-iframe.html` and `.js` are served from our origin). Not yet confirmed connecting: the Claude desktop preview browser blocks sub-frames (`ERR_BLOCKED_BY_CLIENT`), so run `pnpm --filter @cloakroom/web dev` in Chrome and watch the header badge go from "Connecting privately" to "Private: Nym". Then record start-up time, JSON-RPC success, the live `supportsAnyHttps` probe result and `isolationKey` support here |
| 10 · Faucets | Done (human) | Deployer and relayer have 0.05 Sepolia ETH each (throwaway testnet wallets); tGLM requested for the relayer. Top the relayer up toward ~1 Sepolia ETH later |
| WalletConnect project ID | Done (human) | From dashboard.reown.com. Goes in apps/web/.env.local as NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID |
| Chrome Web Store developer account | Done (human) | Already registered |
| Arkiv access key | Done (human) | Created at hub.arkiv.network/access-keys; given to Person A for apps/api/.env only (Arkiv's guidance: never in a browser bundle) |

## B2 · `@cloakroom/platform`

Done. `pnpm --filter @cloakroom/platform test`: 10 tests pass.
- Routing through the worker; isolation keys only on isolated fetches.
- Failure is reported, never silently replaced by plain fetch.
- Missing bootstrap RPC or Tor gateways fail loudly instead of using built-in defaults.
- `supportsAnyHttps` is measured with a real request through the worker (`probeUrl`), not assumed.
- Storage: IndexedDB values are encrypted at rest under a non-extractable key; extension storage uses chrome.storage.

## B3 · Parts that need no core

In progress. Done so far:
- Next.js 16 static export builds (`pnpm --filter @cloakroom/web build`), hydrates, and renders in the browser.
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

Still to do: signature collection, which needs `signInMessage` / `signIn` from Person A's core.
