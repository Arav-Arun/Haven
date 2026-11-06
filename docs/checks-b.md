# Plan B checks

Results of the first-hour checks and each step's "Done when" (see docs/plan/PLAN_B.md). Only what was actually run is
marked done.

## B1 · First-hour checks

| Check | Status | Notes |
|---|---|---|
| 6 · Bee node on Fly.io + postage batch | Not started | Needs a human: Fly.io account and xDAI + xBZZ on Gnosis (or a batch from the Swarm team) |
| 7 · Anon-RPC in a real browser (Nym / Nox / Tor) | Partly | The website boots the harness (`/anon-rpc-iframe.html` and `.js` are served from our origin). Not yet confirmed connecting: the Claude desktop preview browser blocks sub-frames (`ERR_BLOCKED_BY_CLIENT`), so run `pnpm --filter @cloakroom/web dev` in Chrome and watch the header badge go from "Connecting privately" to "Private: Nym". Then record start-up time, JSON-RPC success, the live `supportsAnyHttps` probe result and `isolationKey` support here |
| 10 · Faucets | Not started | Sepolia ETH and tGLM |
| WalletConnect project ID | Not started | Reown dashboard (human) |
| Chrome Web Store developer account | Not started | Human, one-time fee |

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

Still to do: WalletConnect (needs the project ID), signature collection (needs `signInMessage` from core), and the
Settings network picker.
