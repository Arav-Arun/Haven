# Why Arkiv

**What users would lose with Postgres:**
- **Expiry they can trust.** A guest's key copy and welcome note disappear at the end of their access because the
  database itself removes them, not because our server promised to.
- **No one to ask.** With Postgres, our server would see every query: who opens which folder, when, how often. Here,
  reads go through Anon-RPC to a public database, isolated per room and per stealth address. There's no Haven
  database to subpoena, breach or switch off.
- **Writes owned by their writers.** Each file entry is created and paid for by the key that wrote it (an editor's
  stealth address, a room key). Our server can't add, change or hide a file; the client checks every entity against
  onchain roles itself.
- **Anyone can audit it.** The Public view shows exactly what's stored, with explorer links. With Postgres you'd have to
  trust our word about what we keep.

**What we keep off Arkiv, and why:**
- **File contents** go to Swarm: Arkiv entities hold up to 128 KiB, and files are up to 25 MB. Arkiv keeps the sealed
  pointer.
- **Roles and their history** live in ENSv2 on Sepolia (`DriveRegistry`), because names, resolvers and the 15-holder
  role cap are ENS's, and other apps can ask "was this address allowed at time t?" without reading Arkiv.
- **Keys and the seed** never leave the device.
- **The Arkiv access key** stays on our API (`/arkiv-rpc` adds it), per Arkiv's guidance not to ship it in a browser.
