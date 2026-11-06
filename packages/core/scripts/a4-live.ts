// A4 "Done when" (PLAN_A.md): on Sepolia + Arkiv + Bee, create a room, write and read each schema, and show the
// validator hiding a planted write from an address without WRITE. Also covers first-hour check 5 (Arkiv: $createdAt
// unit, custom transport, expiry, tGLM transfer K → S).
//
// The script plays the API's part for room creation, drips and /upload (the API itself is step A5): the relayer key
// deploys the room registry and registers its label, and uploads go through the same verifyUpload + wasAllowed check
// before reaching Bee. Every key except the relayer's is fresh and random; nothing is pre-seeded.
//
// Run: pnpm --filter @cloakroom/core a4
// Needs (repo-root .env and apps/api/.env): SEPOLIA_RPC_URL, RELAYER_PRIVATE_KEY (Sepolia ETH, tGLM, ROLE_REGISTRAR
// on rooms.cloakroom.eth), ARKIV_RPC_URL, ARKIV_ACCESS_KEY, BEE_URL, POSTAGE_BATCH_ID; and in
// contracts/deployments/sepolia.json: cloakroom.driveRegistryImpl, cloakroom.roomsRegistry.

import { secp256k1 } from "@noble/curves/secp256k1";
import type { Hex, ReceiptStep } from "@cloakroom/types";
import {
  bytesToHex,
  createPublicClient,
  createWalletClient,
  formatEther,
  isHex,
  namehash,
  parseEther,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import {
  arkivReader,
  arkivWriter,
  BlockClock,
  chainHead,
  createLinkName,
  createWelcome,
  DEMO_EPOCH_SECONDS,
  decryptPadded,
  deployDrive,
  deriveEpochKey,
  deriveKeys,
  downloadEncrypted,
  driveRegistryAbi,
  encryptPadded,
  epochAt,
  epochKeyFor,
  fileOp,
  findRegistry,
  grantRoleUntil,
  keyCopyOp,
  linkOp,
  listFiles,
  listKeyCopies,
  listLinks,
  listRefreshes,
  listRosters,
  listRotations,
  listTombs,
  listWelcomes,
  newFileId,
  openFileMeta,
  openFolderName,
  openKeyCopy,
  openLinkBundle,
  openRoster,
  openWelcome,
  ownSealKey,
  passthroughAnon,
  randomBytes,
  randomLabel,
  randomMaterial,
  refreshOp,
  registerName,
  registryHistory,
  requireDeployed,
  ROLE_DRIVE_WRITE,
  roomKey,
  rosterKey,
  rosterOp,
  rotationOp,
  sealFileMeta,
  sealFolderName,
  sealKeyCopy,
  sealLinkBundle,
  sealRoster,
  sendGlm,
  signUpload,
  storeOnBee,
  tombOp,
  uploadHeaders,
  Validator,
  verifyUpload,
  wasAllowed,
  weekBucket,
  welcomeOp,
  writeEntities,
  type EpochKey,
  type EpochSchedule,
  type SepoliaWriter,
} from "../src/index";
import { anonTransport } from "../src/transport";
import { env } from "./lib";

// ---------------------------------------------------------------- env (repo-root .env and apps/api/.env, via lib.ts)

const SEPOLIA_RPC_URL = env("SEPOLIA_RPC_URL");
const ARKIV_RPC_URL = env("ARKIV_RPC_URL");
const ARKIV_ACCESS_KEY = env("ARKIV_ACCESS_KEY");
const BEE_URL = env("BEE_URL");
const POSTAGE_BATCH_ID = env("POSTAGE_BATCH_ID");
const relayerKey = env("RELAYER_PRIVATE_KEY");
if (!isHex(relayerKey)) throw new Error("RELAYER_PRIVATE_KEY must be 0x-hex");
const DRIP_SEPOLIA_WEI = BigInt(process.env.DRIP_SEPOLIA_WEI || parseEther("0.003"));
const DRIP_ARKIV_WEI = BigInt(process.env.DRIP_ARKIV_WEI || parseEther("0.02"));
const implementation = requireDeployed("driveRegistryImpl");
const roomsRegistry = requireDeployed("roomsRegistry");

// ---------------------------------------------------------------- output

function log(line = "") {
  console.log(line);
}
function stepLogger(actor: string) {
  return (step: ReceiptStep) => {
    if (step.kind === "sepolia-tx" || step.kind === "arkiv-tx") {
      log(`- ${actor}: ${step.label} — ${step.ok ? "ok" : "FAILED"} — ${step.explorerUrl}`);
    } else if (step.kind === "swarm") {
      log(`- ${actor}: ${step.label} — ref ${step.ref} (${step.paddedBytes} bytes padded)`);
    }
  };
}
function check(label: string, ok: boolean, detail = "") {
  log(`- ${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

// ---------------------------------------------------------------- clients

const anon = passthroughAnon();
const sepoliaPublic = createPublicClient({ chain: sepolia, transport: anonTransport({ url: SEPOLIA_RPC_URL, anon }) });
function sepoliaWriter(key: Hex): SepoliaWriter {
  return {
    public: sepoliaPublic,
    wallet: createWalletClient({
      chain: sepolia,
      transport: anonTransport({ url: SEPOLIA_RPC_URL, anon }),
      account: privateKeyToAccount(key),
    }),
  };
}
const arkiv = (isolationKey?: string) =>
  arkivReader({ rpcUrl: ARKIV_RPC_URL, accessKey: ARKIV_ACCESS_KEY, anon, ...(isolationKey ? { isolationKey } : {}) });
const arkivAs = (key: Hex) => arkivWriter({ rpcUrl: ARKIV_RPC_URL, accessKey: ARKIV_ACCESS_KEY, anon }, key);

// ---------------------------------------------------------------- run

const relayer = privateKeyToAccount(relayerKey);
const reader = arkiv();
log(`# A4 live run, ${new Date().toISOString()}`);
log();
log("## Preflight");
log(`- relayer ${relayer.address}: ${formatEther(await sepoliaPublic.getBalance({ address: relayer.address }))} Sepolia ETH, ` +
  `${formatEther(await reader.getBalance({ address: relayer.address }))} tGLM`);
log(`- DriveRegistry implementation ${implementation}; rooms registry ${roomsRegistry}`);
const relayerIsRegistrar = await sepoliaPublic.readContract({
  address: roomsRegistry,
  abi: driveRegistryAbi,
  functionName: "hasRootRoles",
  args: [1n, relayer.address],
});
check("relayer holds ROLE_REGISTRAR on rooms.cloakroom.eth", relayerIsRegistrar);
if (!relayerIsRegistrar) process.exit(1);

// 1. A room, as POST /room will make it: K_room is a fresh key from a fresh seed; the relayer pays.
log();
log("## 1. Create a room");
const owner = deriveKeys(randomMaterial());
const kRoom = roomKey(owner, 0);
const kRoomAddress = privateKeyToAccount(kRoom).address;
const relayerSepolia = sepoliaWriter(relayerKey);
const { registry: room } = await deployDrive(
  relayerSepolia,
  { implementation, driveKey: kRoomAddress, mainWallet: null },
  stepLogger("relayer"),
);
const roomLabel = randomLabel("r");
const roomName = `${roomLabel}.rooms.cloakroom.eth`;
await registerName(
  relayerSepolia,
  {
    parent: roomsRegistry,
    label: roomLabel,
    owner: kRoomAddress,
    subregistry: room,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 3600),
  },
  stepLogger("relayer"),
);
log(`- room ${roomName} → registry ${room}; K_room ${kRoomAddress}`);
check("registry walk through UniversalResolverV2 finds the room", (await findRegistry(sepoliaPublic, roomName)) === room);

// 2. Drip to K_room only (never to a stealth address).
log();
log("## 2. Drip to K_room");
const relayerArkiv = arkivAs(relayerKey);
const dripHash = await relayerSepolia.wallet.sendTransaction({ to: kRoomAddress, value: DRIP_SEPOLIA_WEI });
await sepoliaPublic.waitForTransactionReceipt({ hash: dripHash });
log(`- relayer: Sepolia drip ${formatEther(DRIP_SEPOLIA_WEI)} ETH — https://sepolia.etherscan.io/tx/${dripHash}`);
await sendGlm(relayerArkiv, kRoomAddress, DRIP_ARKIV_WEI, stepLogger("relayer"), `tGLM drip ${formatEther(DRIP_ARKIV_WEI)}`);

// 3. Version 1 of the room's keys.
const t0 = Math.floor(Date.now() / 1000);
const schedule1: EpochSchedule = { t0, epochSeconds: DEMO_EPOCH_SECONDS };
const fs1 = randomBytes(32);
const head1 = chainHead(fs1);

// 4. Share with a recipient as editor until +1 hour: stealth S, grant, fund S from K_room in the same action.
log();
log("## 3. Share with a private editor");
const recipient = deriveKeys(randomMaterial());
const welcome = await createWelcome({ recipientSpendingPublicKey: recipient.spendingPublicKey, folder: room });
const S = welcome.stealthAddress;
const until = t0 + 3600;
const kRoomSepolia = sepoliaWriter(kRoom);
const kRoomArkiv = arkivAs(kRoom);
await grantRoleUntil(kRoomSepolia, room, S, "editor", until, stepLogger("K_room"));
await sendGlm(kRoomArkiv, S, DRIP_ARKIV_WEI / 4n, stepLogger("K_room"), "fund S (tGLM, K_room → S)");
log(`- stealth editor S = ${S}`);

const memberEpoch = epochKeyFor(head1, schedule1, until);
if (!memberEpoch) throw new Error("no epoch key for that end date");
const compressed = (uncompressed: Hex) =>
  bytesToHex(secp256k1.ProjectivePoint.fromHex(uncompressed.slice(2)).toRawBytes(true));
const roster1 = await sealRoster(rosterKey(fs1), room, 1, {
  managers: [],
  members: [
    {
      address: S,
      memberKey: welcome.memberKey,
      role: "editor",
      until,
      hiddenFromMembers: true,
      label: null,
      via: "direct",
    },
  ],
});
await writeEntities(
  kRoomArkiv,
  [
    rotationOp({
      folder: room,
      version: 1,
      t0,
      epochLength: DEMO_EPOCH_SECONDS,
      name: await sealFolderName(deriveEpochKey(head1, 0), room, 1, "A4 check room"),
    }),
    rosterOp({ folder: room, version: 1, ...roster1 }),
    welcomeOp({
      folder: room,
      bucket: weekBucket(Math.floor(Date.now() / 1000)),
      ephemeralPub: compressed(welcome.note.ephemeralPublicKey),
      sealedMemberKey: welcome.note.sealedMemberKey,
      until,
    }),
    keyCopyOp({
      folder: room,
      recipient: S,
      version: 1,
      sealed: await sealKeyCopy(welcome.memberKey, room, { kind: "epoch", version: 1, ...memberEpoch }),
      until,
    }),
    keyCopyOp({
      folder: room,
      recipient: kRoomAddress,
      version: 1,
      sealed: await sealKeyCopy(ownSealKey(kRoom, room), room, { kind: "secret", version: 1, key: fs1 }),
      until: null,
    }),
  ],
  "rotation v1 + roster + welcome + key copies",
  stepLogger("K_room"),
);

// An expiring link: an l-<random> name in the room's registry, plus its sealed bundle on Arkiv (written below).
const linkExpires = Math.floor(Date.now() / 1000) + 24 * 3600;
const { label: linkLabel } = await createLinkName(
  kRoomSepolia,
  { folder: room, owner: kRoomAddress, expiresAt: linkExpires },
  stepLogger("K_room"),
);
const linkName = namehash(`${linkLabel}.${roomName}`);

// ---------------------------------------------------------------- the recipient finds the share
log();
log("## 4. The recipient finds the share (welcome scan by week bucket)");
const bucketNow = weekBucket(Math.floor(Date.now() / 1000));
const welcomes = await listWelcomes(arkiv(), [bucketNow]);
let opened: Awaited<ReturnType<typeof openWelcome>> = null;
for (const w of welcomes.records) {
  if (w.folder !== room) continue;
  opened = await openWelcome({
    spendingPrivateKey: recipient.spendingPrivateKey,
    folder: room,
    note: { ephemeralPublicKey: w.ephemeralPub, sealedMemberKey: w.sealedMemberKey },
  });
  if (opened) break;
}
check("recipient opens its welcome note and recovers S's key", opened?.stealthAddress === S);
if (!opened) process.exit(1);
const sKey = opened.stealthPrivateKey;
const sArkiv = arkivAs(sKey);
const sReader = arkiv(S); // isolation key = S
const copies1 = await listKeyCopies(sReader, room, S);
const sCopy = await openKeyCopy(opened.memberKey, room, 1, copies1.records[0]!.sealed);
check("S opens its key copy (E_1[j], j = last epoch ending by its end)", sCopy.kind === "epoch" && sCopy.index === memberEpoch.index);
const sHeld = sCopy as EpochKey & { kind: "epoch" };

// ---------------------------------------------------------------- uploads, as /upload will check them
async function apiUpload(writerKey: Hex, padded: Uint8Array): Promise<Hex> {
  const account = privateKeyToAccount(writerKey);
  const auth = await signUpload(account, room, padded);
  const verified = await verifyUpload(new Headers(uploadHeaders(auth)), padded);
  const now = Number((await sepoliaPublic.getBlock()).timestamp);
  if (!(await wasAllowed(sepoliaPublic, room, verified.signer, ROLE_DRIVE_WRITE, now))) throw new Error("no WRITE");
  return storeOnBee(BEE_URL, POSTAGE_BATCH_ID, padded);
}

async function sFile(version: number, schedule: EpochSchedule, held: EpochKey, content: string) {
  const fileKey = randomBytes(32);
  const plain = new TextEncoder().encode(content);
  const padded = await encryptPadded(fileKey, plain);
  const swarmRef = await apiUpload(sKey, padded);
  stepLogger("S")({ kind: "swarm", label: "upload via signed /upload check", ref: swarmRef, paddedBytes: padded.length, ok: true });
  const epoch = epochAt(schedule, Math.floor(Date.now() / 1000));
  const fileId = newFileId();
  const meta = await sealFileMeta(
    deriveEpochKey(held, epoch),
    { folder: room, fileId, version, epoch, swarmRef },
    { name: `${content.slice(0, 20)}.txt`, mime: "text/plain", size: plain.length, fileKey },
  );
  return { op: fileOp({ folder: room, fileId, version, epoch, swarmRef, meta }), fileId, plain, swarmRef, fileKey, size: plain.length };
}

log();
log("## 5. S uploads two files and deletes one (one Arkiv batch)");
const file1 = await sFile(1, schedule1, sHeld, `A4 file one ${new Date().toISOString()}`);
const file2 = await sFile(1, schedule1, sHeld, `A4 file two ${new Date().toISOString()}`);
await writeEntities(sArkiv, [file1.op, file2.op, tombOp({ folder: room, fileId: file2.fileId })], "two files + tomb", stepLogger("S"));

// ---------------------------------------------------------------- a group asks for a refresh
log();
log("## 6. A group opens a refresh request; S's next write is held back until a manager refreshes");
const { registry: group } = await deployDrive(
  relayerSepolia,
  { implementation, driveKey: kRoomAddress, mainWallet: null },
  stepLogger("relayer (group registry)"),
);
await grantRoleUntil(kRoomSepolia, room, group, "viewer", null, stepLogger("K_room"));
await writeEntities(
  kRoomArkiv,
  [refreshOp({ folder: room, group, reason: randomBytes(32) })],
  "refresh request (as the group's manager)",
  stepLogger("K_room"),
);
const during = await sFile(1, schedule1, sHeld, `A4 written during refresh ${new Date().toISOString()}`);
await writeEntities(sArkiv, [during.op], "file during open refresh", stepLogger("S"));

// The manager refreshes: version 2, new secret, t0 = now, key copies for S and the owner.
const t0v2 = Math.floor(Date.now() / 1000);
const schedule2: EpochSchedule = { t0: t0v2, epochSeconds: DEMO_EPOCH_SECONDS };
const fs2 = randomBytes(32);
const head2 = chainHead(fs2);
const memberEpoch2 = epochKeyFor(head2, schedule2, until)!;
const roster2 = await sealRoster(rosterKey(fs2), room, 2, await openRoster(rosterKey(fs1), room, 1, roster1));
await writeEntities(
  kRoomArkiv,
  [
    rotationOp({
      folder: room,
      version: 2,
      t0: t0v2,
      epochLength: DEMO_EPOCH_SECONDS,
      name: await sealFolderName(deriveEpochKey(head2, 0), room, 2, "A4 check room"),
    }),
    rosterOp({ folder: room, version: 2, ...roster2 }),
    keyCopyOp({
      folder: room,
      recipient: S,
      version: 2,
      sealed: await sealKeyCopy(welcome.memberKey, room, { kind: "epoch", version: 2, ...memberEpoch2 }),
      until,
    }),
    keyCopyOp({
      folder: room,
      recipient: kRoomAddress,
      version: 2,
      sealed: await sealKeyCopy(ownSealKey(kRoom, room), room, { kind: "secret", version: 2, key: fs2 }),
      until: null,
    }),
  ],
  "refresh: rotation v2 + roster + key copies",
  stepLogger("K_room"),
);
const copies2 = await listKeyCopies(sReader, room, S);
const v2Copy = copies2.records.find((c) => c.version === 2)!;
const sHeld2 = (await openKeyCopy(opened.memberKey, room, 2, v2Copy.sealed)) as EpochKey & { kind: "epoch" };
const file3 = await sFile(2, schedule2, sHeld2, `A4 file three ${new Date().toISOString()}`);
const file3Write = await writeEntities(sArkiv, [file3.op], "file with version 2", stepLogger("S"));

// The link bundle for file 3, sealed with a secret that would travel in the link's URL fragment.
const linkSecret = randomBytes(32);
await writeEntities(
  kRoomArkiv,
  [
    linkOp({
      link: linkName,
      folder: room,
      bundle: await sealLinkBundle(linkSecret, linkName, {
        folder: room,
        fileId: file3.fileId,
        swarmRef: file3.swarmRef,
        name: "file three.txt",
        mime: "text/plain",
        size: file3.size,
        fileKey: file3.fileKey,
      }),
      expiresAt: linkExpires,
    }),
  ],
  "link bundle",
  stepLogger("K_room"),
);

// ---------------------------------------------------------------- the planted writes
log();
log("## 7. An address without WRITE plants a file entry and a key copy");
const attackerKey = toHex(randomBytes(32));
const attacker = privateKeyToAccount(attackerKey).address;
await sendGlm(relayerArkiv, attacker, DRIP_ARKIV_WEI / 4n, stepLogger("relayer"), "gas for the attacker (script only)");
const attackerArkiv = arkivAs(attackerKey);
await writeEntities(
  attackerArkiv,
  [
    fileOp({
      folder: room,
      fileId: newFileId(),
      version: 2,
      epoch: epochAt(schedule2, Math.floor(Date.now() / 1000)),
      swarmRef: file3.swarmRef, // points at a real blob, as an attacker would
      meta: randomBytes(64),
    }),
    keyCopyOp({ folder: room, recipient: S, version: 2, sealed: randomBytes(69), until }),
  ],
  "planted file + key copy",
  stepLogger("attacker"),
);
log(`- attacker ${attacker}`);

// ---------------------------------------------------------------- read everything back through the validator
log();
log("## 8. Read every schema back and validate");
const [rotations, rosters, files, tombs, refreshes, links, keyCopies] = await Promise.all([
  listRotations(reader, room),
  listRosters(reader, room),
  listFiles(reader, room),
  listTombs(reader, room),
  listRefreshes(reader, room),
  listLinks(reader, linkName),
  listKeyCopies(reader, room, S),
]);
log(`- read: ${rotations.records.length} rotations, ${rosters.records.length} rosters, ${files.records.length} files, ` +
  `${tombs.records.length} tombs, ${refreshes.records.length} refreshes, ${links.records.length} links, ` +
  `${keyCopies.records.length} key copies for S, ${welcomes.records.length} welcome notes this week (all folders)`);

const clock = new BlockClock(reader);
const validator = new Validator(registryHistory(sepoliaPublic), clock);
const reading = await validator.folder({
  folder: room,
  rotations: rotations.records,
  refreshes: refreshes.records,
  files: files.records,
  tombs: tombs.records,
  malformed: rotations.malformed + files.malformed + tombs.malformed + refreshes.malformed,
});
const sharesChecked = await validator.shareRecords([...rosters.records, ...keyCopies.records, ...links.records]);
for (const h of reading.hiddenFiles) log(`- hidden file ${h.record.key} by ${h.record.creator}: ${h.reason}`);
for (const h of sharesChecked.hidden) log(`- hidden ${"recipient" in h.record ? "key copy" : "entry"} ${h.record.key} by ${h.record.creator}: ${h.reason}`);

const shown = new Set(reading.files.map((f) => f.fileId));
check("file 1 and file 3 are shown", shown.has(file1.fileId) && shown.has(file3.fileId));
check("file 2 is deleted by its tomb", !shown.has(file2.fileId));
check(
  "the write during the open refresh is hidden",
  reading.hiddenFiles.some((h) => h.record.fileId === during.fileId && h.reason === "refresh-open"),
);
check(
  "the attacker's planted file is hidden (no WRITE at its creation time)",
  reading.hiddenFiles.some((h) => h.record.creator === attacker && h.reason === "no-role"),
);
check(
  "the attacker's planted key copy is hidden (no SHARE)",
  sharesChecked.hidden.some((h) => h.record.creator === attacker && h.reason === "no-role"),
);
check("the refresh is closed by version 2", !reading.refreshOpen && reading.latestVersion === 2);
log(`- hidden entities (Public view "ignoredWrites"): ${reading.hidden + sharesChecked.hidden.length}`);

// The owner and S decrypt what they can.
const v2 = reading.versions.get(2)!;
check(
  "the folder name opens with E_2[0]",
  (await openFolderName(deriveEpochKey(sHeld2, 0), room, 2, v2.name)) === "A4 check room",
);
const ownCopies = await validator.shareRecords((await listKeyCopies(reader, room, kRoomAddress)).records);
const ownV2 = ownCopies.valid.find((c) => c.version === 2);
if (!ownV2) throw new Error("the owner's version-2 key copy is missing");
const ownCopy = await openKeyCopy(ownSealKey(kRoom, room), room, 2, ownV2.sealed);
check("the owner opens its own copy (FS_2)", ownCopy.kind === "secret" && toHex(ownCopy.key) === toHex(fs2));
const latestRoster = rosters.records.find((r) => r.version === 2)!;
const openedRoster = await openRoster(rosterKey(fs2), room, 2, latestRoster);
check("the roster opens with HKDF(FS_2, managers) and lists S", openedRoster.members[0]?.address === S);
const f3 = reading.files.find((f) => f.fileId === file3.fileId)!;
const meta3 = await openFileMeta(deriveEpochKey(sHeld2, f3.epoch), { ...f3 }, f3.meta);
const blob = await downloadEncrypted({ apiUrl: "", beeUrl: BEE_URL, anon }, f3.swarmRef, stepLogger("S"));
const plain3 = await decryptPadded(meta3.fileKey, blob);
check("file 3 downloads from Bee and decrypts to what was uploaded", toHex(plain3) === toHex(file3.plain));
const linkRecord = sharesChecked.valid.find((r) => "bundle" in r);
const linkBundle = linkRecord && "bundle" in linkRecord ? await openLinkBundle(linkSecret, linkName, linkRecord.bundle) : null;
const linkPlain = linkBundle
  ? await decryptPadded(linkBundle.fileKey, await downloadEncrypted({ apiUrl: "", beeUrl: BEE_URL, anon }, linkBundle.swarmRef))
  : null;
check("the link opens with its secret and gives file 3", !!linkPlain && toHex(linkPlain) === toHex(file3.plain));

// Check 5: $createdAt is the block number of the creating transaction (so its time comes from that block).
const file3Receipt = await reader.getTransactionReceipt({ hash: file3Write.txHash });
check(
  "check 5: $createdAt is the creating transaction's block number",
  f3.createdAtBlock === file3Receipt.blockNumber,
  `block ${f3.createdAtBlock}, time ${await clock.timeOf(f3.createdAtBlock)}`,
);

log();
log(process.exitCode ? "RESULT: FAIL" : "RESULT: PASS");
