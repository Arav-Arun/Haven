// The read rules (HAVEN_PLAN.md section 7, "Rules for writing and reading", and the table in section 10).
// Anyone can write an Arkiv entity that a query matches, so nothing is shown until it passes here. An entity counts
// only if:
//   - it was created read-only (so its attributes are what was written at $createdAt);
//   - its creator held the schema's role in the folder's DriveRegistry at its creation time (wasAllowed, a plain view
//     call over the registry's own history):
//       haven.file, haven.tomb                                 WRITE
//       haven.rotation, roster, keycopy, welcome, link         SHARE
//       haven.refresh                                          SHARE on the named group, which must itself be a member
// and, for files, also:
//   - its version was the latest rotation's version when it was created (no stale version);
//   - its epoch is within one epoch of its creation time under that version's schedule (no back-dating);
//   - if the writer isn't a manager, no refresh request was open when it was created.
// Anonymous file entries (haven.zkfile, add-on Z1) have no creator to check: they count if their zero-knowledge proof
// verifies against the folder's writer group at their creation time (zk.ts), then go through the same file rules as
// an editor who doesn't manage the folder.
// Ordering between Arkiv entities uses block numbers (exact); role checks use the block's timestamp (Arkiv's
// $createdAt is a block number, so BlockClock turns it into a time).

import type { Address } from "@haven/types";

import type {
  EntityInfo,
  FileRecord,
  KeyCopyRecord,
  LinkRecord,
  RefreshRecord,
  RosterRecord,
  RotationRecord,
  TombRecord,
  WelcomeRecord,
  ZkFileRecord,
  ZkJoinRecord,
} from "./arkiv";
import { ROLE_DRIVE_READ, ROLE_DRIVE_SHARE, ROLE_DRIVE_WRITE, wasAllowedMany, type SepoliaReader } from "./ens";
import { DEMO_EPOCH_SECONDS, EPOCH_SECONDS, EPOCHS, isEpochPlausible, type EpochSchedule } from "./epochs";
import { checkZkFiles, type ZkWriteInfo } from "./zk";

export type HiddenReason =
  | "not-readonly" // attributes could have been changed after creation
  | "no-role" // the creator didn't hold the role at creation time
  | "stale-version" // written with an older key version than the latest at the time
  | "unknown-version" // no rotation (yet) for the version it claims
  | "back-dated" // claims an epoch more than one away from its creation time
  | "refresh-open" // written by a non-manager while a refresh request was open
  | "bad-rotation" // a rotation with an implausible schedule
  | "bad-proof" // an anonymous entry whose proof doesn't verify or isn't about its own fields
  | "not-a-writer"; // an anonymous entry proved against a group that wasn't the folder's writers at the time

export interface Hidden<R> {
  record: R;
  reason: HiddenReason;
}

export interface Checked<R> {
  valid: (R & { createdAt: number })[];
  hidden: Hidden<R>[];
}

/** Whether accounts held a role at given times. Backed by DriveRegistry.wasAllowedMany. */
export interface AccessHistory {
  allowedMany(registry: Address, accounts: Address[], roleBitmap: bigint, times: number[]): Promise<boolean[]>;
}

export function registryHistory(client: SepoliaReader): AccessHistory {
  return { allowedMany: (registry, accounts, role, times) => wasAllowedMany(client, registry, accounts, role, times) };
}

/** Block number → unix time (arkiv.BlockClock). */
export interface Clock {
  timesOf(blocks: Iterable<bigint>): Promise<Map<bigint, number>>;
}

const byBlockThenKey = (a: EntityInfo, b: EntityInfo) =>
  a.createdAtBlock === b.createdAtBlock ? (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) : a.createdAtBlock < b.createdAtBlock ? -1 : 1;

export interface RoleCheck<R> {
  record: R;
  registry: Address;
  role: bigint;
  /** Extra checks that must also pass, e.g. "the group is a member of the folder" for refresh requests. */
  alsoRequire?: { registry: Address; account: Address; role: bigint }[];
}

export class Validator {
  constructor(
    private readonly history: AccessHistory,
    private readonly clock: Clock,
  ) {}

  /**
   * The read-only and role rules for any records. Each record's creator must hold `role` in `registry` at its
   * creation time (and every `alsoRequire` must hold at that time too).
   */
  async checkRoles<R extends EntityInfo>(checks: RoleCheck<R>[]): Promise<Checked<R>> {
    const out: Checked<R> = { valid: [], hidden: [] };
    const times = await this.clock.timesOf(checks.map((c) => c.record.createdAtBlock));

    // One wasAllowedMany per (registry, role): every question is "did `account` hold `role` at `t`?".
    type Question = { registry: Address; role: bigint; account: Address; t: number; answer?: boolean };
    const questions: Question[] = [];
    const asked: { check: RoleCheck<R>; parts: Question[] }[] = [];
    for (const check of checks) {
      if (!check.record.readonly) {
        out.hidden.push({ record: check.record, reason: "not-readonly" });
        continue;
      }
      const t = times.get(check.record.createdAtBlock)!;
      const parts: Question[] = [
        { registry: check.registry, role: check.role, account: check.record.creator, t },
        ...(check.alsoRequire ?? []).map((r) => ({ ...r, t })),
      ];
      questions.push(...parts);
      asked.push({ check, parts });
    }
    const groups = new Map<string, Question[]>();
    for (const q of questions) {
      const id = `${q.registry.toLowerCase()}:${q.role}`;
      const list = groups.get(id) ?? [];
      list.push(q);
      groups.set(id, list);
    }
    for (const list of groups.values()) {
      const answers = await this.history.allowedMany(
        list[0]!.registry,
        list.map((q) => q.account),
        list[0]!.role,
        list.map((q) => q.t),
      );
      list.forEach((q, i) => (q.answer = answers[i] === true));
    }
    for (const { check, parts } of asked) {
      if (parts.every((q) => q.answer)) {
        out.valid.push({ ...check.record, createdAt: times.get(check.record.createdAtBlock)! });
      } else {
        out.hidden.push({ record: check.record, reason: "no-role" });
      }
    }
    return out;
  }

  /** haven.welcome, haven.keycopy, haven.roster and haven.link: only a manager of the folder could write them. */
  shareRecords<R extends EntityInfo & { folder: Address }>(records: R[]): Promise<Checked<R>> {
    return this.checkRoles(records.map((record) => ({ record, registry: record.folder, role: ROLE_DRIVE_SHARE })));
  }

  /**
   * A folder's rotations, refresh requests, files and tombs, with every rule applied. Returns the files that count
   * (minus deleted ones), the key schedule of each version, and what was hidden and why.
   */
  async folder(input: {
    folder: Address;
    rotations: RotationRecord[];
    refreshes: RefreshRecord[];
    files: FileRecord[];
    tombs: TombRecord[];
    /** Add-on Z1: anonymous file entries and the writer group's joins. */
    zk?: { files: ZkFileRecord[]; joins: ZkJoinRecord[] };
    /** Entities that didn't even fit their schema (from the queries' `malformed` counts). */
    malformed?: number;
  }): Promise<FolderReading> {
    const { folder } = input;

    // 1. Rotations: SHARE at creation and a plausible schedule. The earliest valid rotation of each version counts.
    const rot = await this.checkRoles(input.rotations.map((record) => ({ record, registry: folder, role: ROLE_DRIVE_SHARE })));
    const hiddenRotations: Hidden<RotationRecord>[] = [...rot.hidden];
    const versions = new Map<number, RotationRecord & { createdAt: number }>();
    for (const r of [...rot.valid].sort(byBlockThenKey)) {
      if (!plausibleSchedule(r)) {
        hiddenRotations.push({ record: r, reason: "bad-rotation" });
        continue;
      }
      if (versions.has(r.version)) continue; // a later duplicate of the same version doesn't count
      versions.set(r.version, r);
    }

    // 2. Refresh requests: SHARE on the named group, and that group was a member of this folder at the time.
    const ref = await this.checkRoles(
      input.refreshes.map((record) => ({
        record,
        registry: record.group,
        role: ROLE_DRIVE_SHARE,
        alsoRequire: [{ registry: folder, account: record.group, role: ROLE_DRIVE_READ }],
      })),
    );

    // 3. Files: WRITE at creation (or a valid proof, for anonymous entries); then version, epoch and refresh rules.
    const files = await this.checkRoles(input.files.map((record) => ({ record, registry: folder, role: ROLE_DRIVE_WRITE })));
    const anonymous = input.zk ? await checkZkFiles(input.zk.files, input.zk.joins, folder, this.history, this.clock) : { valid: [], hidden: [] };
    const hiddenFiles: Hidden<FileRecord>[] = [...files.hidden, ...anonymous.hidden];
    // Anonymous writers could be anyone in the group, so they never count as managers.
    const writersWhoManage = await this.managersAt(folder, files.valid);
    const rotationsInOrder = [...versions.values()].sort(byBlockThenKey);
    const refreshesInOrder = [...ref.valid].sort(byBlockThenKey);
    const kept: (FileRecord & { createdAt: number; zk?: ZkWriteInfo })[] = [];
    for (const f of [...files.valid, ...anonymous.valid]) {
      // the latest version at the file's block (a rotation in the same block counts as earlier)
      let latest: (RotationRecord & { createdAt: number }) | undefined;
      for (const r of rotationsInOrder) {
        if (r.createdAtBlock > f.createdAtBlock) break;
        if (!latest || r.version > latest.version) latest = r;
      }
      if (!latest || f.version > latest.version || !versions.has(f.version)) {
        hiddenFiles.push({ record: f, reason: "unknown-version" });
        continue;
      }
      if (f.version < latest.version) {
        hiddenFiles.push({ record: f, reason: "stale-version" });
        continue;
      }
      const schedule = scheduleOf(latest);
      if (f.epoch > EPOCHS || !isEpochPlausible(schedule, f.epoch, f.createdAt)) {
        hiddenFiles.push({ record: f, reason: "back-dated" });
        continue;
      }
      if (!writersWhoManage.has(f.key) && refreshOpenAt(f.createdAtBlock, refreshesInOrder, rotationsInOrder)) {
        hiddenFiles.push({ record: f, reason: "refresh-open" });
        continue;
      }
      kept.push(f);
    }

    // 4. Tombs: WRITE at creation; a tomb deletes the file id's entries written at or before it.
    const tombs = await this.checkRoles(input.tombs.map((record) => ({ record, registry: folder, role: ROLE_DRIVE_WRITE })));
    const lastTomb = new Map<string, bigint>();
    for (const t of tombs.valid) {
      const prev = lastTomb.get(t.fileId);
      if (prev === undefined || t.createdAtBlock > prev) lastTomb.set(t.fileId, t.createdAtBlock);
    }
    const live = kept.filter((f) => {
      const tomb = lastTomb.get(f.fileId);
      return tomb === undefined || f.createdAtBlock > tomb;
    });

    const latestVersion = rotationsInOrder.reduce((max, r) => Math.max(max, r.version), 0);
    const hidden =
      hiddenRotations.length + ref.hidden.length + hiddenFiles.length + tombs.hidden.length + (input.malformed ?? 0);
    return {
      files: live.sort(byBlockThenKey),
      versions,
      latestVersion,
      refreshOpen: refreshOpenAt(null, refreshesInOrder, rotationsInOrder),
      hiddenFiles,
      hiddenRotations,
      hiddenRefreshes: ref.hidden,
      hiddenTombs: tombs.hidden,
      hidden,
    };
  }

  /** Which file writers held SHARE (were managers) when they wrote: managers may write during an open refresh. */
  private async managersAt(folder: Address, files: (FileRecord & { createdAt: number })[]): Promise<Set<string>> {
    if (files.length === 0) return new Set();
    const answers = await this.history.allowedMany(
      folder,
      files.map((f) => f.creator),
      ROLE_DRIVE_SHARE,
      files.map((f) => f.createdAt),
    );
    return new Set(files.filter((_, i) => answers[i]).map((f) => f.key));
  }
}

export interface FolderReading {
  /** Files that count, oldest first, without deleted ones. Anonymous entries carry what their proof showed. */
  files: (FileRecord & { createdAt: number; zk?: ZkWriteInfo })[];
  /** The rotation that counts for each version. */
  versions: Map<number, RotationRecord & { createdAt: number }>;
  latestVersion: number;
  /** A refresh request is open now: editors are blocked until a manager refreshes. */
  refreshOpen: boolean;
  hiddenFiles: Hidden<FileRecord>[];
  hiddenRotations: Hidden<RotationRecord>[];
  hiddenRefreshes: Hidden<RefreshRecord>[];
  hiddenTombs: Hidden<TombRecord>[];
  /** Every entity hidden by the validator, for PublicView.ignoredWrites. */
  hidden: number;
}

export function scheduleOf(rotation: Pick<RotationRecord, "t0" | "epochLength">): EpochSchedule {
  return { t0: rotation.t0, epochSeconds: rotation.epochLength };
}

/** Clock skew allowed between a manager's device and Arkiv's block time when checking a rotation's t0. */
const ROTATION_SKEW_SECONDS = 300;

function plausibleSchedule(r: RotationRecord & { createdAt: number }): boolean {
  if (r.epochLength !== EPOCH_SECONDS && r.epochLength !== DEMO_EPOCH_SECONDS) return false;
  if (!Number.isSafeInteger(r.t0) || r.version < 1) return false;
  // t0 is "now" on the manager's device when it made the version
  return Math.abs(r.t0 - r.createdAt) <= ROTATION_SKEW_SECONDS + r.epochLength;
}

/**
 * A refresh request is open at `block` if a valid one was created at or before it and no valid rotation was created
 * after the request and at or before `block`. `block` null means "now".
 */
function refreshOpenAt(block: bigint | null, refreshes: EntityInfo[], rotations: EntityInfo[]): boolean {
  for (const r of refreshes) {
    if (block !== null && r.createdAtBlock > block) break;
    const closed = rotations.some(
      (rot) => rot.createdAtBlock > r.createdAtBlock && (block === null || rot.createdAtBlock <= block),
    );
    if (!closed) return true;
  }
  return false;
}

export type {
  FileRecord,
  KeyCopyRecord,
  LinkRecord,
  RefreshRecord,
  RosterRecord,
  RotationRecord,
  TombRecord,
  WelcomeRecord,
};
