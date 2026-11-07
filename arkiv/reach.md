# Reach

## Who it's for

People who share sensitive files with outsiders and don't want the platform, or the public, to learn who got them:

- Founders sending a data room to investors
- Lawyers exchanging drafts with clients
- Journalists receiving documents from sources
- DAOs sharing grant applications or security reports with reviewers

## Why they would use it

- **Members nobody else can identify.** Each share goes to a fresh stealth address, not the recipient's ENS name.
- **Access that ends on its own.** Roles expire on Sepolia, key copies expire on Arkiv, and files added later stay
  locked for the expired member.
- **One new step.** An ENS name, which Haven gives away free (`you.haven.eth`) with no gas.

## Try it today (testnets)

- Website: [havenethglobal.xyz](https://havenethglobal.xyz), signing in with a wallet
- No wallet: [havenethglobal.xyz/try](https://havenethglobal.xyz/try/) creates two fresh identities in one tab
- Phone: Settings → Install the app. Android also gets "Share to Haven" in the system share sheet
- Cost to the user: one signature. Names are sponsored, and viewers send no transactions

## Use so far

Live entities on Arkiv on 2026-11-07, from our own and testers' runs at the event. Expired entities no longer appear.

| Entity | Count | Distinct writers |
|---|---|---|
| Key log entries (`haven.keylog`) | 18 | relayed, signed by each name |
| Registered devices (`haven.device`) | 52 | relayed, signed by each name |
| Folder rosters (`haven.roster`) | 20 | 12 folder keys |
| Key schedules (`haven.rotation`) | 13 | 12 folder keys |
| Key copies (`haven.keycopy`) | 15 | 12 |
| Sealed file entries (`haven.file`) | 8 | 6 |
| Anonymous-writer joins (`haven.zkjoin`) | 8 | relayed, signed by each member |

The README's queries return these rows.

## Useful beyond Haven

- **ENS key directory (`haven.keylog`).** Any chat, mail or file app that wants to encrypt to an ENS name can read
  that name's key and its signed history with one Arkiv query. No API key from us and no Haven code.
- **Release log (`haven.release`).** A public, signed record of each website build's file hashes, which anyone can
  check a build against.

## After Mumbai

- Passkey sign-in, so no wallet is needed
- Automatic key refresh when a group changes
- Move names and roles to Ethereum mainnet, where ENSv2 is now live
