// Share with an ENS subtree, privately: "everyone under acme.eth" (add-on F2).
//
// Teams already manage people with ENS subnames (priya.acme.eth, raj.acme.eth), so onboarding and offboarding can
// happen in ENS instead of in our app. Writing "room X → acme.eth" anywhere public would link the room to the team, so
// the rule lives ONLY in the room's sealed manager roster (records.ts SubtreeRuleState). The owner's app turns it into
// ordinary private shares, one stealth address per subname holder; the chain only ever sees random member addresses.
//
// A sync (run by maintain(): when the web app opens, and in the extension's 15-minute background check):
//   - a new holder with a valid key (add-on F1)  → a normal private share;
//   - a name that's gone (expired, unregistered) or excluded → removeMember, which refreshes the folder's keys;
//   - a transfer (different owner) or a new key → the old stealth address is removed and the name is shared fresh.
// Removals run before additions, so the slots and the key refresh come first.
//
// planSubtreeSync is pure (the rules, tested without a network); syncSubtree carries a plan out through the same share
// and removeMember the rest of the app uses; listSubtreeHolders reads the live state from Sepolia and the key log.

import { DriveError, type Address, type Hex, type Role, type ShareOptions, type Timestamp } from "@cloakroom/types";
import { isAddressEqual } from "viem";
import { normalize } from "viem/ens";

import { creationBlock, findRegistry, labelState, registeredLabels, type SepoliaReader } from "./ens";
import { compressKey, sameKey } from "./keydir";
import type { SubtreeMember, SubtreeRuleState } from "./records";

/** EAC allows at most 15 holders per role; the folder's owner key is one, so 14 are left for everyone else. */
export const SUBTREE_CAP = 14;

const CAP_MESSAGE = "A folder can hold at most 14 people. Use several rooms, or split the team.";

// ---------------------------------------------------------------- shapes

/** One live subname under the parent, as a sync sees it. */
export interface SubnameHolder {
  ensName: string;
  owner: Address;
  /** Compressed spending key from the name's valid key log that agrees with ENS, or null (none, broken, mismatched). */
  key: Hex | null;
}

export type RemovalReason = "gone" | "excluded" | "transferred" | "key-changed" | "no-key";

export interface SubtreePlan {
  add: SubnameHolder[];
  remove: { member: SubtreeMember; reason: RemovalReason }[];
  skipped: { ensName: string; reason: "no-key" | "cap" }[];
}

/** What screens see of a rule (the add-on's proposed SubtreeRule, plus who it shared with, for managers only). */
export interface SubtreeRule {
  parent: string;
  role: Role;
  until: Timestamp | null;
  excluded: string[];
  memberCount: number;
  lastSyncedAt: Timestamp;
  members: { ensName: string; address: Address }[];
}

export function ruleView(rule: SubtreeRuleState): SubtreeRule {
  return {
    parent: rule.parent,
    role: rule.role,
    until: rule.until,
    excluded: [...rule.excluded],
    memberCount: rule.members.length,
    lastSyncedAt: rule.lastSyncedAt,
    members: rule.members.map((m) => ({ ensName: m.ensName, address: m.address })),
  };
}

// ---------------------------------------------------------------- the rules (pure)

/** Whether `ensName` is a direct subname of `parent` (priya.acme.eth under acme.eth; not a.b.acme.eth). */
export function isDirectSubname(ensName: string, parent: string): boolean {
  const name = normalize(ensName);
  const suffix = `.${normalize(parent)}`;
  return name.endsWith(suffix) && !name.slice(0, -suffix.length).includes(".") && name.length > suffix.length;
}

/**
 * Compares what the rule shared with against the live subnames. `capacity` is how many people this rule may hold in
 * total (SUBTREE_CAP minus the folder's other members). Never adds past it; removals are never held back.
 */
export function planSubtreeSync(rule: SubtreeRuleState, holders: readonly SubnameHolder[], capacity: number): SubtreePlan {
  const excluded = new Set(rule.excluded.map((n) => normalize(n)));
  const live = new Map<string, SubnameHolder>();
  for (const h of holders) {
    const name = normalize(h.ensName);
    if (isDirectSubname(name, rule.parent)) live.set(name, { ...h, ensName: name });
  }

  const plan: SubtreePlan = { add: [], remove: [], skipped: [] };
  const kept = new Set<string>();
  for (const member of rule.members) {
    const name = normalize(member.ensName);
    const holder = live.get(name);
    let reason: RemovalReason | null = null;
    if (excluded.has(name)) reason = "excluded";
    else if (!holder) reason = "gone";
    else if (!isAddressEqual(holder.owner, member.owner)) reason = "transferred";
    else if (!holder.key) reason = "no-key";
    else if (!sameKey(holder.key, member.key)) reason = "key-changed";
    if (reason) plan.remove.push({ member, reason });
    else kept.add(name);
  }

  let room = Math.max(0, capacity - kept.size);
  for (const holder of [...live.values()].sort((a, b) => a.ensName.localeCompare(b.ensName))) {
    if (kept.has(holder.ensName) || excluded.has(holder.ensName)) continue;
    if (!holder.key) plan.skipped.push({ ensName: holder.ensName, reason: "no-key" });
    else if (room === 0) plan.skipped.push({ ensName: holder.ensName, reason: "cap" });
    else {
      plan.add.push(holder);
      room--;
    }
  }
  return plan;
}

/** The share dialog's preview: "12 members found (2 have no Cloakroom key)". */
export function previewSubtree(holders: readonly SubnameHolder[], parent: string, excluded: readonly string[] = []) {
  const skip = new Set(excluded.map((n) => normalize(n)));
  const found = holders.filter((h) => isDirectSubname(h.ensName, parent) && !skip.has(normalize(h.ensName)));
  const withoutKey = found.filter((h) => !h.key).map((h) => normalize(h.ensName));
  return { found: found.length, withKey: found.length - withoutKey.length, withoutKey };
}

/** Refuses a team that wouldn't fit. */
export function assertFits(withKey: number, capacity: number): void {
  if (withKey > capacity) {
    throw new DriveError("RATE_LIMITED", `${withKey} people have a Cloakroom key there, and ${CAP_MESSAGE}`);
  }
}

// ---------------------------------------------------------------- live state

export interface SubtreeReaders {
  sepolia: SepoliaReader;
  /** F1's lookupKey (or anything returning the same fields). */
  lookupKey: (ensName: string) => Promise<{ current: Hex; matchesEns: boolean }>;
}

/** A new rule. Its first sync scans the parent's registry from the block it was created in. */
export async function newSubtreeRule(
  sepolia: SepoliaReader,
  parentEnsName: string,
  opts: ShareOptions,
  now: number,
): Promise<SubtreeRuleState> {
  const parent = normalize(parentEnsName);
  const registry = await findRegistry(sepolia, parent);
  if (!registry) throw new DriveError("NOT_FOUND", `${parent} has no subnames registry`);
  const created = await creationBlock(sepolia, registry);
  return {
    parent,
    registry,
    role: opts.role,
    until: opts.until,
    hideFromMembers: opts.hideFromMembers,
    excluded: [],
    members: [],
    labels: [],
    scannedTo: Number(created) - 1,
    createdAt: now,
    lastSyncedAt: 0,
  };
}

/** Reads new registrations since the last scan, then every known label's live owner and key. */
export async function listSubtreeHolders(
  readers: SubtreeReaders,
  rule: Pick<SubtreeRuleState, "parent" | "registry" | "labels" | "scannedTo">,
  now = Math.floor(Date.now() / 1000),
): Promise<{ holders: SubnameHolder[]; labels: string[]; scannedTo: number }> {
  const scan = await registeredLabels(readers.sepolia, rule.registry, { fromBlock: BigInt(rule.scannedTo + 1) });
  const labels = [...new Set([...rule.labels, ...scan.labels.map((l) => l.label)])].sort();
  const holders: SubnameHolder[] = [];
  for (const label of labels) {
    const { owner } = await labelState(readers.sepolia, rule.registry, label, now);
    if (!owner) continue;
    const ensName = `${label}.${rule.parent}`;
    let key: Hex | null = null;
    try {
      const info = await readers.lookupKey(ensName);
      key = info.matchesEns ? compressKey(info.current) : null;
    } catch {
      key = null; // no drive, no log, or a broken log: skipped, never shared with
    }
    holders.push({ ensName, owner, key });
  }
  return { holders, labels, scannedTo: Number(scan.scannedTo) };
}

// ---------------------------------------------------------------- carrying out a sync

export interface SubtreeSyncDeps {
  listHolders: (rule: SubtreeRuleState) => Promise<{ holders: SubnameHolder[]; labels: string[]; scannedTo: number }>;
  /** DriveClient.share: a normal private share to the subname (stealth address, grant, welcome, key copy). */
  share: (ensName: string, opts: ShareOptions) => Promise<{ address: Address }>;
  /** DriveClient.removeMember: revoke and refresh the folder's keys (and its inheriting subfolders'). */
  removeMember: (address: Address) => Promise<void>;
  /** When this device can't refresh keys (NOT_AUTHORIZED), ask a manager to: a cloak.refresh request. */
  requestRefresh?: (reason: string) => Promise<void>;
  /** People this rule may hold in total: SUBTREE_CAP minus the folder's other members. */
  capacity: number;
  now: () => number;
}

export interface SubtreeSyncResult {
  rule: SubtreeRuleState;
  plan: SubtreePlan;
  errors: { ensName: string; error: unknown }[];
  refreshRequested: boolean;
}

/**
 * One sync of one rule. Each step's failure is recorded without stopping the others; a member whose removal failed
 * stays in the rule, so the next sync tries again. The caller writes `rule` back into the sealed roster.
 */
export async function syncSubtree(rule: SubtreeRuleState, deps: SubtreeSyncDeps): Promise<SubtreeSyncResult> {
  const live = await deps.listHolders(rule);
  const plan = planSubtreeSync(rule, live.holders, deps.capacity);
  const errors: SubtreeSyncResult["errors"] = [];
  let members = [...rule.members];
  let refreshRequested = false;

  for (const { member, reason } of plan.remove) {
    try {
      await deps.removeMember(member.address);
      members = members.filter((m) => !isAddressEqual(m.address, member.address));
    } catch (error) {
      errors.push({ ensName: member.ensName, error });
      if (!refreshRequested && deps.requestRefresh && (error as { code?: string }).code === "NOT_AUTHORIZED") {
        await deps.requestRefresh(`team member left (${reason})`);
        refreshRequested = true;
      }
    }
  }

  const opts: ShareOptions = { role: rule.role, until: rule.until, hideFromMembers: rule.hideFromMembers };
  for (const holder of plan.add) {
    try {
      const { address } = await deps.share(holder.ensName, opts);
      members.push({ ensName: holder.ensName, address, owner: holder.owner, key: holder.key!, since: deps.now() });
    } catch (error) {
      errors.push({ ensName: holder.ensName, error });
    }
  }

  return {
    rule: { ...rule, members, labels: live.labels, scannedTo: live.scannedTo, lastSyncedAt: deps.now() },
    plan,
    errors,
    refreshRequested,
  };
}

/**
 * Ends a rule: removes everyone it shared with. Returns the members whose removal failed; while any remain, the
 * caller keeps the rule (with only those members) so the next sync retries them.
 */
export async function dissolveSubtree(
  rule: SubtreeRuleState,
  removeMember: (address: Address) => Promise<void>,
): Promise<{ remaining: SubtreeMember[]; errors: { ensName: string; error: unknown }[] }> {
  const remaining: SubtreeMember[] = [];
  const errors: { ensName: string; error: unknown }[] = [];
  for (const member of rule.members) {
    try {
      await removeMember(member.address);
    } catch (error) {
      remaining.push(member);
      errors.push({ ensName: member.ensName, error });
    }
  }
  return { remaining, errors };
}

/** Excludes one person: they're removed at the next sync (or right away if the caller syncs now). */
export function excludeFromRule(rule: SubtreeRuleState, memberEnsName: string): SubtreeRuleState {
  const name = normalize(memberEnsName);
  if (!isDirectSubname(name, rule.parent)) throw new DriveError("NOT_FOUND", `${name} isn't under ${rule.parent}`);
  return rule.excluded.includes(name) ? rule : { ...rule, excluded: [...rule.excluded, name] };
}
