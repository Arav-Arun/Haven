# Arkiv + Swarm

## What lives where

| Store | What | Visible to anyone |
|---|---|---|
| Swarm | File contents, encrypted on the device (AES-256-GCM, a random key per file) | Padded ciphertext only |
| Arkiv, `haven.file` | `swarmRef` (the Swarm reference), `folder`, `fileId`, `version`, `epoch` | These fields |
| Arkiv, `haven.file` → `meta` | File name, type, real size and file key | Nothing: sealed to members holding that epoch's key |

- **Field holding the Swarm reference:** `haven.file.swarmRef`.
- **Padding:** every upload is exactly 64 KB, 256 KB, 1 MB, 4 MB, 16 MB or 32 MB, so real sizes don't leak.
- **Plain Swarm references, on purpose.** An encrypted Swarm reference contains its own key, and Arkiv is public, so
  storing one would publish the key. Our own encryption keeps the key inside the sealed `meta` instead.

## One entity and the Swarm reference it points to

- Arkiv entity:
  [`0x9277d0e012d0596341591326baaea3e2c583f43b374a3baada6553daaff121de`](https://rabdi.explorer.arkiv.network/entity/0x9277d0e012d0596341591326baaea3e2c583f43b374a3baada6553daaff121de)
- Its folder on Sepolia:
  [`0x5Ac1BF80cFC369EdAE45f4a5c4Ca6F095E365490`](https://sepolia.etherscan.io/address/0x5Ac1BF80cFC369EdAE45f4a5c4Ca6F095E365490)
- Its `swarmRef`:
  [`dec00d5f4228bae57f34c30f2f6c3bc385ebc9f5bbb8ee21f547c8032df0ad6b`](https://api.gateway.ethswarm.org/bytes/dec00d5f4228bae57f34c30f2f6c3bc385ebc9f5bbb8ee21f547c8032df0ad6b)
  on the public Swarm gateway: exactly 4,194,304 bytes (the 4 MB bucket) of ciphertext.
- Check both with no Haven code:

```bash
curl -s https://rpc.rabdi.db-chain.testnet.arkiv.network -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"arkiv_getEntity","params":["0x9277d0e012d0596341591326baaea3e2c583f43b374a3baada6553daaff121de"]}'
```

```bash
curl -s https://api.gateway.ethswarm.org/bytes/dec00d5f4228bae57f34c30f2f6c3bc385ebc9f5bbb8ee21f547c8032df0ad6b | wc -c
```

## Postage batch and Bee node

- **Batch ID:** `cbbfb329338e20fb1d13171a20dc2da5f964daf85f939b7cefbec6568c63d1e9`
  - Depth 20, amount 28610229492, immutable
  - Bought 2026-11-06 on Gnosis, block 49141474:
    [tx `0xcf9fd2e0…96d0fb`](https://gnosisscan.io/tx/0xcf9fd2e0aaf861c181d99aabd5925d26f9cd66d3e8c99ce684a043114a96d0fb)
- **Bought by:** our own Bee node, with 3 xBZZ from the ETHGlobal Mumbai Swarm bot's gift code
- **Bee node:** our Bee 2.8.3 light node on Fly.io (`infra/bee/fly.toml`, app `haven-bee`, private network)
  - Node wallet: [`0xec074829fB5dd8090178f9f667359DD4Ec82A04f`](https://gnosisscan.io/address/0xec074829fB5dd8090178f9f667359DD4Ec82A04f)

## Files that upload and read

| Step | File | Function |
|---|---|---|
| Encrypt, pad, sign and upload | [`packages/core/src/swarm.ts`](../packages/core/src/swarm.ts) | `uploadEncrypted` |
| Check the signer's role, store on Bee | [`apps/api/src/app.ts`](../apps/api/src/app.ts) | `POST /upload` → `storeOnBee` |
| Write the Arkiv entity | [`packages/core/src/arkiv.ts`](../packages/core/src/arkiv.ts) | `fileOp` |
| Download ciphertext | [`packages/core/src/swarm.ts`](../packages/core/src/swarm.ts) | `downloadEncrypted`, `downloadFolderBlobs` |
| Read-only gateway | [`apps/api/src/app.ts`](../apps/api/src/app.ts) | `GET /bytes/<ref>` |

- `POST /upload` checks the request signature and `DriveRegistry.wasAllowed` before spending the batch.
- The Bee node is private. Only the read-only gateway is public, so nobody else can upload against the batch.

## Run one upload and one read

- **Needs:** the API running with its `.env` (Bee URL, postage batch, a relayer funded with Sepolia ETH and tGLM).
  See the README's "Run it".
- **Command:** `pnpm --filter @haven/core e2e`
- **What it does:** creates a room, uploads files, writes their `haven.file` entities, then reads them back as a second
  identity.
- **Expected output:** `PASS the deck decrypts to what was uploaded`, plus the Swarm reference and padded size of each
  upload.
- **In the app:** upload any file in a room. The row shows its padded size. Open it from a member's account and it
  downloads from Swarm and decrypts.

## Live updates over Swarm (GSOC doorbells)

- **What:** a "doorbell" is a GSOC write that tells members to re-read Arkiv
  ([`packages/core/src/doorbell.ts`](../packages/core/src/doorbell.ts)).
- **Topic:** `HKDF(epoch key, "doorbell/<folder>")`. Only current members can compute it, and it changes every epoch.
- **Chunk key:** the first `HKDF(topic, "gsoc/<i>")` whose address shares `DOORBELL_PROXIMITY` leading bits with our
  Bee node's overlay, which is served at `GET /config`.
- **Payload:** `{type, arkivKey}`, sealed with AES-256-GCM and padded to 256 bytes. It's never trusted: the receiver
  re-reads Arkiv and runs the validator.
- **Write path:** `POST /doorbell` checks the SOC signature and size, then posts to Bee's `/soc` with our batch.
- **Subscribe path:** `/doorbell/subscribe/<address>` is piped to Bee's `/gsoc/subscribe/`.
- **Fallback:** when doorbells aren't configured or the WebSocket drops, the app re-reads Arkiv every 30 seconds.
- **Known limit:** GSOC delivery on a light node isn't confirmed. GSOC is documented for nodes whose neighbourhood
  stores the chunk. A full node, or polling, covers it.

## What got in our way

- **A public Bee API lets anyone with the batch ID upload.** This file has to publish the batch ID, so we put the node
  on a private network and exposed only a read-only gateway.
- **Two tokens on another chain before the first upload.** A light node needs xDAI and xBZZ on Gnosis. For a hackathon
  team that's an extra chain and two faucets.
- **ACT doesn't fit browsers.** Swarm's access control needs each reader to run a Bee node, which phones and browsers
  can't, so we encrypt before upload.
