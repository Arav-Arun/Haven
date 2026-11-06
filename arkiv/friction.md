# Friction with Arkiv

Expected vs actual, with what we did about it. SDK `@arkiv-network/sdk` 1.0.1, Rabdi testnet (chain 7794095).

1. **`$createdAt` is a block number, not a time.**
   Expected: a timestamp we could compare with onchain role history. Actual: a block number. Repro: create an entity,
   select `$createdAt`, compare with the creating transaction's receipt (`blockNumber` matches). We added `BlockClock`,
   which reads each block's timestamp once and caches it. A `$createdAtTime` system field would save every app a lookup
   per entity.

2. **Anyone can write an entity that matches your query.**
   The docs say so, which is good. But there's no built-in way to restrict a query to entities whose creator satisfies
   a rule. Every app with shared data has to write its own validator. We check each `$creator` against our onchain
   access history. A `where($creator in [...])` filter would cover the simple cases.

3. **The access key can't go in a browser bundle, but there's no read-only key.**
   Expected: a key scoped to reads (or to one app's schemas) that could ship to clients. Actual: one key, so we run a
   JSON-RPC pass-through on our API that adds it, with a method allowlist. That puts our server in the read path, which
   is what we wanted to avoid. A scoped, rate-limited read key would remove it.

4. **Expiry is set in blocks, and `ExpirationTime.atDate` needs care near "now".**
   An end date only a minute or two away (our demo's access windows) can land below the minimum; we pass
   `{ atLeast: ExpirationTime.fromMinutes(2) }`. Expected: a clear error for a too-short expiry rather than having to
   know the floor.

5. **Paging and malformed rows.**
   Entities that don't fit a schema are skipped and counted in `skipped`, so a page can hold fewer rows than the limit
   without being the last one. We page by offset and count `entities + skipped`. Worth a line in the paging docs.

6. **tGLM for writers.**
   Each writer key (our editors' stealth addresses, room keys) needs tGLM. We fund them from the sharer's key in the same
   action as the grant, so funding never links a member to their own wallet. A sponsored-write option would make this
   much simpler for apps that care about unlinkability.
