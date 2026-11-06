# Arkiv + Swarm

**What lives where.**
- **Swarm:** file contents only, as padded ciphertext (exactly 64 KB, 256 KB, 1 MB, 4 MB, 16 MB or 32 MB, so real sizes
  don't show), encrypted on the device with a random AES-256-GCM key per file.
- **Arkiv:** the `haven.file` entity. Its `swarmRef` field holds the Swarm reference in the clear (it points at
  ciphertext). The file key, name, type and real size are in the sealed `meta` field, which only members holding that
  epoch's key can open.
- We use plain (unencrypted) Swarm references on purpose. An encrypted Swarm reference contains its own key, and Arkiv
  entities are public, so storing one would publish the key. Our own encryption keeps the key in sealed `meta` instead.

**Repo files.**
- Upload: [`packages/core/src/swarm.ts`](../packages/core/src/swarm.ts) (`uploadEncrypted`, signed by a key with
  WRITE) → [`apps/api/src/app.ts`](../apps/api/src/app.ts) `POST /upload` (checks the signature and `wasAllowed` now,
  then `storeOnBee` with our postage batch).
- Read: `downloadEncrypted` / `downloadFolderBlobs` in `swarm.ts`, through the API's read-only `GET /bytes/<ref>`
  gateway (our Bee node stays private, so no one else can spend the batch).
- Arkiv side: `fileOp` in [`packages/core/src/arkiv.ts`](../packages/core/src/arkiv.ts).

**Run one upload and one read.** With the API running (see the README): `pnpm --filter @haven/core e2e` uploads
files, writes their `haven.file` entities, and reads them back as another identity. Expected: "PASS the deck decrypts
to what was uploaded", with the Swarm reference and padded size printed for each upload. You need the API's `.env`
(Bee URL and postage batch) and a funded relayer.

**Filled in after the live run** (we don't write values we haven't produced):
- Postage batch ID: _from `POSTAGE_BATCH_ID`, recorded at deploy_
- Who bought it or gave it: _recorded at deploy_
- Bee node or service: _our light node from `infra/bee/fly.toml`, or the Swarm team's node, recorded at deploy_
- One Arkiv entity key and its Swarm reference, with an openable link: _from `docs/evidence.md` after the e2e run_
- Timestamp in the demo video where Swarm is used: _added after recording_

**Live updates: Swarm pub/sub (add-on F4, GSOC).**
- A "doorbell" is a GSOC (graffiti single-owner chunk) write: [`packages/core/src/doorbell.ts`](../packages/core/src/doorbell.ts).
  Its topic is `HKDF(E_v[epoch], "doorbell/<folder>")`, so only current members can compute it, and it changes every
  epoch with the key chain.
- Everyone who knows the topic mines the same chunk key: the first `HKDF(topic, "gsoc/<i>")` whose chunk address
  shares `DOORBELL_PROXIMITY` leading bits with our Bee node's overlay (read from Bee's `/addresses` and served at
  `GET /config`), so the node hears the write.
- The payload `{type, arkivKey}` is sealed (AES-256-GCM) and padded to exactly 256 bytes. It never carries trusted
  data: the receiver re-reads Arkiv and runs the validator before showing anything.
- Writes: `POST /doorbell` checks the SOC signature and size, then `POST /soc/{owner}/{id}?sig=` to Bee with our
  batch. Subscriptions: the API upgrades `/doorbell/subscribe/<address>` and pipes it to Bee's `/gsoc/subscribe/`.
- Fallback: with no doorbell config, or when the WebSocket drops, the app re-reads Arkiv every 30 seconds instead.
- **Not yet verified live:** whether a Bee light node delivers GSOC messages (GSOC is documented for nodes whose
  neighbourhood stores the chunk). If it doesn't, run a full node or leave `DOORBELL_PROXIMITY` empty; the polling
  fallback keeps the app working. See `docs/checks-a.md`.

**What got in our way.**
- A Bee node with a public API lets anyone with the batch ID upload against it, and this file has to publish the batch
  ID. We put the node on a private network and expose only a read-only gateway.
- Light nodes need xDAI and xBZZ on Gnosis before the first upload. That's an extra chain and two tokens for a
  hackathon team, which is why we asked the Swarm team for a hosted batch first.
- Swarm ACT (Swarm's own access control) would need every reader to run a Bee node, which doesn't fit phones and
  browsers, so we encrypt before upload instead.
