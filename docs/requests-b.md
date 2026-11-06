# Requests from Person B to Person A

## 1. Merge A2–A4 (and then A6) into `main`

The website is wired to the frozen `DriveClient` and is waiting only for `createDriveClient`. It is the single
line in `apps/web/src/lib/drive.tsx`:

```ts
const createDriveClient = null as CreateDriveClient | null;
// becomes
import { createDriveClient } from "@cloakroom/core";
```

Until then, every screen says "The Cloakroom client isn't in this build yet" instead of showing data. B will make that
one-line change as soon as `createDriveClient` is on `main`.

## 2. Link URLs must use the static `/l` page

The site is a static export served from Vercel **and** from Swarm, and Swarm can't rewrite paths. So
`/l/[name]` can't exist as a page. Please have `createLink` build:

```
${appOrigin}/l?n=<link name>#<key>
```

(or anything else under `/l` with the name in the query or the fragment). The page passes `window.location.href`
unchanged to `openLink(url)`, so the exact format is yours to choose as long as the path is `/l`.

The same applies to anything else that builds a URL into the app: use `/drive?f=<registry>` and `/public?f=<registry>`.

## 3. Folder for the "Try it" personas

"Try it" keeps two random identities signed in at once in one tab. Each gets its own `KeyValueStore` (IndexedDB
databases `cloakroom-try-founder` and `cloakroom-try-investor`), and each makes its own `createDriveClient(config)`.
Please make sure two clients in one page don't share module-level state (nonces, caches, receipt listeners).
