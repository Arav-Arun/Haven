# Requests from Person B to Person A

Resolved. Plan A's API (step A5) and `createDriveClient` (step A6) were written on `plan-b` after merging `plan-a`,
at the owner's request. Both apps now use the real client.

- Link URLs use the static page: `${appOrigin}/l/?n=<link name>#<key>` (the site is a static export served from Vercel
  and Swarm, which can't rewrite paths).
- "Try it" keeps two clients in one page, each with its own storage; the client keeps no module-level state.
