# Cloakroom API (`apps/api`)

A small Hono server (`src/app.ts`, `createApi`) with one key, the **relayer**. The relayer holds `ROLE_REGISTRAR` on
the registries of `cloakroom.eth` and `rooms.cloakroom.eth`, and nothing else. It never sees a file, a name or a key in
the clear. It keeps only in-memory rate-limit counters, which reset on their own, and logs nothing about users.

Everything it does can also be done without it:
- **Names, rooms and gas:** users with their own `.eth` name and gas don't need `/claim`, `/room` or `/drip`.
- **Uploads:** any Bee node takes uploads.

## Endpoints

The request formats are in `packages/core/src/api.ts` (`/upload` in `swarm.ts`). The client and the server use the
same definitions.

| Endpoint | Does |
|---|---|
| `POST /claim` | Takes a request signed by K, with its time within 5 minutes. Deploys the user's PermissionedResolver (`cloak.key`) and `DriveRegistry` drive root, then registers `<label>.cloakroom.eth`. One name per K per day, and a daily cap |
| `POST /room` | Takes proof of work over K_room. Deploys the room's `DriveRegistry` and registers `r-<random>.rooms.cloakroom.eth`. One room per key, and a daily cap |
| `POST /drip` | Only for the owner key of a Cloakroom registry (checked through `VerifiableFactory`). Queues Sepolia ETH and tGLM, sent together every `DRIP_BATCH_SECONDS`. One per key per day |
| `POST /upload` | Takes padded ciphertext, signed by a key that holds WRITE on the folder now. Stored on Bee with `POSTAGE_BATCH_ID`. Daily quota per key |
| `GET /bytes/:ref` | A read-only Swarm gateway, so the Bee node stays private |
| `POST /arkiv-rpc` | An Arkiv JSON-RPC pass-through that adds the access key on the server. Allow-listed methods only |
| `POST /keylog` | Add-on F1. Relays a public key-log or device entry signed by the name's controller |
| `POST /doorbell` | Add-on F4. Stamps a signed GSOC chunk and hands it to Bee. `/doorbell/subscribe/<address>` is a WebSocket proxy (`src/ws.ts`) |
| `GET /config`, `GET /health` | `/config` returns public values: the relayer, the work difficulty, the drip interval and the doorbell settings. `/health` is the liveness check |

**Errors** come back as `{ error: { code, message } }`:
- `403 NOT_AUTHORIZED`
- `404 NOT_FOUND`
- `409 NAME_TAKEN` or `KEY_MISMATCH`
- `410 EXPIRED`
- `413 TOO_LARGE`
- `429 RATE_LIMITED`

## Configuration

`apps/api/.env.example` lists every setting. The server refuses to start without them.

**Addresses** come from `@cloakroom/core` (`contracts/deployments/sepolia.json`), so run
`pnpm --filter @cloakroom/core bootstrap` first.

## Run, test, deploy

```sh
pnpm --filter @cloakroom/api test        # refusals that need no network
pnpm --filter @cloakroom/api dev         # local server on $PORT, reads apps/api/.env

# Fly.io, region bom, from the repo root:
fly secrets set --config apps/api/fly.toml SEPOLIA_RPC_URL=… RELAYER_PRIVATE_KEY=… ARKIV_ACCESS_KEY=… BEE_URL=… POSTAGE_BATCH_ID=…
fly deploy --config apps/api/fly.toml --dockerfile apps/api/Dockerfile .
```

**What reaches the image:** the build context is the repo root. The root `.dockerignore` excludes every `.env` file
(except the `.env.example` templates), `node_modules` and the build output.
