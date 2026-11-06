# How we use Arkiv

**Filters.** Every screen is an indexed query: a folder's files (`eq("folder", …)`), my key copies
(`folder` + `recipient`), this week's welcome notes (`bucket`), a link (`link`). Nothing is filtered on the device that
Arkiv could filter, and nothing secret is indexed: the indexed columns are addresses, random ids, numbers and a namehash.

**Edit rights.** We don't rely on Arkiv's ownership for who may write: anyone can create an entity that matches a query.
Instead every entity is created read-only, and the client checks its `$creator` against the folder's onchain roles at
`$createdAt` (`DriveRegistry.wasAllowed`). Users see this: planted entries never show, and the Public view counts them
("3 records were written here by addresses without access. Haven ignores them"). Entities that managers keep alive
are created with permissionless extension, so a manager can renew an editor's entry without being able to change it.

**Expiry.** It changes what users see:
- A guest's **key copy expires at the end of their access**, so a new device can't even fetch it afterwards.
- **Welcome notes expire** with the share, which keeps "Shared with me" fast on phones (the scan only reads live notes).
- **Links stop working** at their end: the `cloak.link` entity is gone.
- Refresh requests expire after 30 days.
- Everything else lives as long as Arkiv allows (about 182 days) and managers' apps renew it.

**Each feature, as the user sees it:** "Shared with me" is a welcome-note scan; the folder view is a validated file
query; the members panel reads the sealed roster; the Public view lists every entity with its explorer link, owner,
size and expiry; the receipts panel links each Arkiv transaction.

**Public data (add-ons).** Arkiv also holds data meant for everyone:
- **A key directory keyed by ENS name** (`cloak.keylog`): any app looks up a name's current key, and its whole history,
  with one query, and can tell a swapped key from a real change. Sharing in Haven refuses a key that doesn't match
  its log, and warns when a key changed since the last share. Forged entries (written about a name by anyone but its
  controller) show on the profile page as ignored.
- **Devices** (`cloak.device`) expire after 90 days unless used, so a lost laptop drops off on its own.
- **Website releases** (`cloak.release`): the extension reads them to decide whether the page in front of it may get
  the user's keys. Independent rebuilders post `cloak.rebuild` from their own wallets; the extension counts them.
