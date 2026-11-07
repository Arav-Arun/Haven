# Friction with Arkiv

SDK `@arkiv-network/sdk` 1.0.1, Rabdi testnet (chain 7794095).

## 1. `$createdAt` is a block number, not a time

- **Expected:** a timestamp we could compare with onchain role history.
- **Actual:** a block number.
- **Repro:** create an entity, select `$createdAt`, and compare it with the creating transaction's receipt. It equals
  `blockNumber`.
- **Workaround:** `BlockClock` reads each block's timestamp once and caches it.
- **Ask:** a `$createdAtTime` system field, so apps don't need a lookup per entity.

## 2. Anyone can write an entity that matches your query

- **Expected:** a way to limit a query to entities whose creator meets a rule.
- **Actual:** the docs are clear that anyone can write a matching entity, but there's no filter on creator, so every
  app with shared data writes its own validator.
- **Workaround:** we check each `$creator` against `DriveRegistry.wasAllowedMany` on Sepolia at `$createdAt`.
- **Ask:** a `where($creator in [...])` filter for the simple cases.

## 3. No read-only access key

- **Expected:** a key scoped to reads, or to one app's schemas, that's safe to ship in a browser.
- **Actual:** a single key, which must not go in a client bundle.
- **Workaround:** a JSON-RPC pass-through on our API that adds the key and allows only read methods.
- **Cost:** our server sits in the read path, which is what we wanted to avoid.
- **Ask:** a scoped, rate-limited read key.

## 4. Expiry near "now" needs care

- **Expected:** a clear error when an expiry is too short.
- **Actual:** an end date a minute or two away (short test shares) can fall below the minimum expiry. Expiry is set in
  blocks, and `ExpirationTime.atDate` doesn't flag it.
- **Workaround:** we pass `{ atLeast: ExpirationTime.fromMinutes(2) }`.
- **Ask:** document the minimum, and reject with a named error.

## 5. Paging with malformed rows

- **Expected:** a page with fewer rows than the limit is the last page.
- **Actual:** entities that don't fit the schema are skipped and counted in `skipped`, so a short page may not be the
  last one.
- **Workaround:** page by offset, and treat `entities.length + skipped` as the page size.
- **Ask:** one line about this in the paging docs.

## 6. Node page limit is 100, but the SDK accepts more

- **Expected:** the SDK to cap or warn at the node's maximum.
- **Actual:** `.limit(200)` fails at runtime: "limit 200 exceeds the node maximum of 100".
- **Repro:** `select().from(schema).limit(200).fetch()` against Rabdi.
- **Ask:** expose the maximum as a constant, or clamp it in the SDK.

## 7. Every writer key needs tGLM

- **Context:** our writers are one-off keys (editors' stealth addresses, room keys), each needing tGLM to write.
- **Workaround:** the sharer funds them in the same action as the role grant, so the funding never links a member to
  their own wallet.
- **Ask:** sponsored writes, for apps that care about unlinkable writers.
