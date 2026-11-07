# How AI was used

We used Claude (Anthropic), mostly through **Claude Code**, its command-line coding agent, as a pair programmer
while we built Haven. Each of us ran it on our own laptop, on our own branch, and we merged the branches as we went.

## What was ours

- **The idea:** private file sharing with ENS names, where nobody else learns who got access and access ends by itself.
- **The stack:** ENSv2, Arkiv, Swarm and Anon-RPC.
- **The architecture and every design trade-off.**
- **Every scope decision** during the hackathon.

## Where Claude helped

**Planning.** Claude helped turn our design into a step-by-step build plan (`docs/plan/`), with a "done when" check
for each step. When a review of the plan found flaws, we decided how to fix each one, and Claude updated the plan to
match. The flaws included editor keys that could leak, stealth funding that linked members, and rooms that could be
tied to their owners.

**Contract.** Claude wrote `DriveRegistry.sol` with us, along with its Foundry tests: unit, fuzz, invariant, and fork
tests against the live Sepolia ENSv2 contracts. It ran the feasibility checks against the live deployment and recorded
the results in `docs/checks-a.md`. For example, it confirmed that ENSv2's role hooks can't be overridden, and found that
the live ENSv2 is newer than the source we had pinned.

**Core library** (`packages/core`):
- key derivation from one sign-in signature;
- epoch keys;
- stealth shares;
- the Arkiv schemas and the validator that checks every record against ENS roles;
- Swarm uploads;
- ENS naming;
- the client the apps use.

**API and apps:**
- the Hono API on Fly.io (names, rooms, gas, uploads, and the Arkiv and Sepolia pass-throughs);
- the Anon-RPC wiring;
- the encrypted browser storage;
- the UI components;
- the Next.js website and installable phone app;
- the bootstrap and end-to-end scripts.

**Debugging and performance on the live network.** Claude measured where the time went on Sepolia and implemented the
fixes:
- a sign-up's three transactions and a new folder's two now land in one block;
- one Sepolia send at a time per key, so two actions never pick the same nonce;
- folder lists load child names in a single call, and use folder summaries that skip files;
- drips go out in one block;
- receipts are checked more often.

Each fix was checked on a fork of live Sepolia before we merged it. Claude also tracked down a few surprises in the
live network, such as Sepolia's higher gas prices for deploying code and creating new accounts.

**Docs.** Claude drafted parts of the README (including the CROPS section), the Arkiv judging files, the architecture
diagram and a brief for our pitch deck. We edited and corrected them.

## Rules the agents worked under

These are in `CLAUDE.md`:
- **No mocks, seeded data or fake values:** every value on screen is read live from Sepolia, Arkiv or Swarm.
- **No third-party scripts, trackers or analytics.**
- **No keys or secrets committed.**
- **Contract addresses only from the official ENS docs,** never guessed.
- **Each person edits only the parts of the repo they own.**

## What we did ourselves

- **Review:** we read every change before merging, resolved the merges, and tested everything again ourselves.
- **Accounts and money:** testnet accounts, faucets and funding, keys and secrets.
- **Deploys:** the contracts on Sepolia, the API and Bee node on Fly.io, and the website.
- **Real-world testing:** real phones, and wallets in Chrome and Brave.
- **The demo:** every scope decision, the pitch and the demo video.
