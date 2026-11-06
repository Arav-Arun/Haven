# Cloakroom API (`apps/api`)

A small Hono server with one key, the **relayer**. The relayer holds `ROLE_REGISTRAR` on the registries of
`cloakroom.eth` and `rooms.cloakroom.eth`, and nothing else. It never sees a file, a name or a key in the clear.

Everything it does can also be done without it:
- **Names, rooms and gas:** users with their own `.eth` name and gas don't need `/claim`, `/room` or `/drip`.
- **Uploads:** any Bee node takes uploads.

## Endpoints

Each request is signed (EIP-191) by the key it concerns. The time it carries must be within 5 minutes of the server's
clock. The text formats are defined once, in `packages/core/src/apiAuth.ts` (`/upload` in `swarm.ts`). The client and
the server both use those definitions.

| Endpoint | Body | Checks | Does |
|---|---|---|---|
| `POST /claim` | JSON: `label`, `driveKey` (K), `mainWallet` (W or null), `spendingPublicKey`, `time`, `signature` (by K) | Label rules (3–32 of a–z, 0–9, inner `-`; not `f-`/`r-`/`l-`/`g-`/`m-`/`rooms`); available; valid uncompressed key; one name per K per day; `CLAIM_DAILY_CAP` | Deploys the user's PermissionedResolver with `cloak.key` and their `DriveRegistry` drive root (K everyday roles, W dangerous ones), then registers `<label>.cloakroom.eth`. Returns the addresses and every transaction, so the client can check that the relayer kept no role (`verifyClaim`) |
| `POST /room` | JSON: `roomKey` (K_room), `time`, `nonce`, `signature` (by K_room) | Proof of work: `sha256(challenge ‖ nonce)` has `ROOM_POW_DIFFICULTY` leading zero bits; one room per key; `ROOM_DAILY_CAP` | Deploys the room's `DriveRegistry` (K_room holds everything) and registers `r-<random>.rooms.cloakroom.eth` |
| `POST /drip` | JSON: `key`, `registry`, `label`, `kind` (`drive`/`room`), `time`, `signature` (by key) | The registry is registered under `cloakroom.eth` / `rooms.cloakroom.eth` with that label; `key` is its drive owner; once per key per day | Queues the key. The batch goes out every `DRIP_INTERVAL_SECONDS` (10 minutes), in shuffled order: Sepolia ETH and tGLM, only if the key is below the drip amount, never below `RELAYER_FLOOR_WEI`, within `DRIP_DAILY_BUDGET_WEI` |
| `POST /upload` | Padded ciphertext (exactly one padding bucket), headers `x-cloak-folder/-signer/-time/-signature` | Signature over the folder and the body's SHA-256; the signer holds WRITE on the folder **now** (`wasAllowed` at the latest block); `UPLOAD_QUOTA_BYTES` per key; `UPLOAD_DAILY_BYTES` overall; 32 MiB max | Stores it on Bee with `POSTAGE_BATCH_ID` and returns `{ reference }` |
| `GET /health` | – | – | The relayer, the registries, whether uploads are on, the work difficulty, the drip queue length |

**Errors** come back as `{ error: DriveErrorCode, message }`:
- `403 NOT_AUTHORIZED`
- `409 NAME_TAKEN`
- `413 TOO_LARGE`
- `429 RATE_LIMITED` (any limit)
- `502 NETWORK`
- `400` (anything malformed)

**What it keeps:** daily counters, keyed by a short hash and never by an address, dropped at the start of each UTC day.
No request is logged.

## Configuration

**Shared keys,** in the repo-root `.env.example`:
- `RELAYER_PRIVATE_KEY`
- `ROOM_POW_DIFFICULTY`
- `DRIP_SEPOLIA_WEI`
- `DRIP_ARKIV_WEI`
- `BEE_URL`
- `POSTAGE_BATCH_ID`

**The API's own keys** are in `apps/api/.env.example`.

**Addresses** come from `@cloakroom/core` (`contracts/deployments/sepolia.json`). The server refuses to start until
`pnpm --filter @cloakroom/core bootstrap` has deployed and recorded them.

**Optional pieces:**
- Without `ARKIV_ACCESS_KEY`, tGLM drips are off.
- Without `BEE_URL` and `POSTAGE_BATCH_ID`, `/upload` answers `502`.

## Run, test, deploy

```sh
pnpm --filter @cloakroom/api test        # 7 tests on a local chain (needs anvil and `forge build` in contracts/)
pnpm --filter @cloakroom/api dev         # local server on :8787, reads the environment

# Fly.io, region bom. One-time setup:
cd apps/api
fly auth login
fly launch --no-deploy --copy-config --name cloakroom-api
fly secrets set RELAYER_PRIVATE_KEY=… SEPOLIA_RPC_URL=… ARKIV_ACCESS_KEY=… BEE_URL=… POSTAGE_BATCH_ID=…

# Every deploy:
pnpm --filter @cloakroom/api deploy      # bundles to dist/server.mjs, then `fly deploy`
```

**What reaches the image:** the image holds only `dist/server.mjs`. `.dockerignore` admits nothing else, so no `.env`
file reaches Fly's builder or the image.

**Tests:** the tests copy the live PermissionedResolver bytecode from Sepolia onto the local chain, so `/claim` runs
the same code as in production. Without network access, that one test is skipped.
