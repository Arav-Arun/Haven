# Haven demo (Sepolia testnet), about 3 minutes

Everything runs on the **Sepolia** test network, Arkiv's Rabdi testnet and Swarm. Nothing is mocked: every name,
address, file and record you show is live and can be checked on Etherscan or the Arkiv explorer.

**Before you start**
- Open the site on its real domain: `https://havenethglobal.xyz` (wallet sign-in only works on that domain, because
  your keys are tied to it). Until the domain resolves, use **Try it**, which needs no wallet, on
  `https://eth-global-mumbai-six.vercel.app/try/`.
- Use Chrome or Brave, not the built-in browser of an IDE: the private network (Anon-RPC Nox) runs in a sandboxed
  iframe that some embedded browsers block.
- Install the extension from `/extension` (Download for Chrome → chrome://extensions → Developer mode → Load
  unpacked), then **Settings → Connect extension**.
- Have Etherscan (Sepolia) open in a second tab.

## 1. Opening (15 s)
"Haven is stealth storage on open networks. Your files are encrypted on your device, kept on Swarm, and shared with
any ENS name through a fresh address nobody can trace. Access ends on its own."

Point at the hero screenshot: it's the real Public view of a live room.

## 2. Sign in and claim a name (ENS, 30 s)
1. **Start sharing** → **Connect wallet** (MetaMask) → sign one message. Keys are made on the device from that
   signature; nothing is stored on a server.
2. **Claim your name**: `yourname.haven.eth`. Say: "This is an ENSv2 name. Every folder is its own ENSv2 registry,
   with roles from Enhanced Access Control that end on their own."
3. Click the ticket's **Etherscan** link: the name's registry on Sepolia.

## 3. Make a room, upload, share (ENS + Swarm + Arkiv, 60 s)
1. **Rooms → New room**: "A room gets a random name, so nobody can tie it to you." Show `r-….rooms.haven.eth`.
2. Drop in a file. The upload row says "Padded to 64 KB: that's all anyone else can see" (Swarm stores only padded
   ciphertext; the sealed file entry is on Arkiv).
3. **Share** → type a friend's name. Show the **eight words**: "We compare these in person to check their key."
   Pick **Viewer**, **1 hour**, keep **Hide from other members** → **Share**.
4. The confirmation shows the new random address: "On the chain they appear only as this address." Open it on
   Etherscan: a role with an end time, nothing about the person.

## 4. What anyone can see (Arkiv + privacy, 30 s)
1. **Public view**. Left: what anyone can read from Sepolia and Arkiv (random addresses, padded sizes, encrypted
   records with expiry dates). Right: the same records opened with your keys (names, files).
2. "Arkiv holds the sealed file entries, key copies and invitations, and each one expires with the access it serves."
3. Click an Arkiv record link to show it on the Rabdi explorer.

## 5. The recipient (30 s)
On a second browser (or Try it's **Switch to the recipient**): **Shared** shows the ticket and its end time. Open
it: the files decrypt. "When the hour is up, their keys stop: files added later are locked for them, with no
transaction."

## 6. Private and verified (Ethereum Foundation: Anon-RPC + CROPS, 30 s)
1. **Receipts** (top right): each lookup is labelled **Private** (through Anon-RPC Nox) with its own isolation key
   per address and room, so the network can't link your shares.
2. **Settings → Private network**: Nox is on.
3. The extension's popup on the site: **Verified release 1.0.3 (or the latest)**. "The extension re-downloads every file of this page
   and checks it against a release signed onchain (Arkiv) before it gives the page your keys. A tampered site gets a
   red warning and no keys."
4. The same build is on Swarm, and `haven.eth`'s contenthash points to it (show the Sepolia transaction).

## 7. Close (15 s)
"Open source, MIT. Runs on ENS, Arkiv, Swarm and Ethereum, not on our servers. Keep anything private, share it
without a trace."

---

## Proof links

| What | Link |
| --- | --- |
| DriveRegistry (verified source) | https://sepolia.etherscan.io/address/0x779Ee739785907454748aAfed760130Bdf0b7628#code |
| `haven.eth` registry | https://sepolia.etherscan.io/address/0xd20bC8330a9E9fCc14B8111Ab0D2CA5626Fc0632 |
| `rooms.haven.eth` registry | https://sepolia.etherscan.io/address/0x951D7D861710dcb645013eD1Fb3A0589980174db |
| Swarm postage batch purchase (Gnosis) | https://gnosisscan.io/tx/0xcf9fd2e0aaf861c181d99aabd5925d26f9cd66d3e8c99ce684a043114a96d0fb |
| Release signer R | `0xBFc132fda5A9119dCE4C9b5bb5470255A586B50e` |

## Track checklist

| Track | What to show | Where |
| --- | --- | --- |
| ENS (Best use of ENSv2) | Name claim, folder = registry, roles that end on their own, share by name, team rules (A team tab) | Steps 2–3, Etherscan |
| Arkiv (Build on Arkiv) | Sealed entries with expiry, public key log, Public view, explorer links | Step 4 |
| Arkiv + Swarm bonus | Padded ciphertext uploads, live doorbells (the green **Live** pill), the site on Swarm | Steps 3, 6 |
| EF (Anon-RPC, CROPS) | Private receipts, Nox, extension-verified release, no trackers, open source | Step 6 |
