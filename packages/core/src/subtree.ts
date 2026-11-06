// Add-on F2: share with an ENS subtree, privately ("everyone at acme.eth").
//
// Teams already manage people with subnames (priya.acme.eth, raj.acme.eth). A subtree rule lets onboarding and
// offboarding happen in ENS instead of in our app. Writing "room X → acme.eth" onchain would publish the link between
// the room and the team, so the rule lives ONLY in the room's sealed manager roster (records.ts), and the owner's app
// turns it into ordinary stealth shares, one per subname holder. The chain only ever sees random member addresses.
//
// Listing: LabelRegistered events on the parent's registry (the event carries the label, so no LabelStore lookup is
// needed), then each label's live status, expiry and owner (ens.ts nameController). Holders without a valid public key
// log (keydir.ts) are skipped and reported.

import type { Address, Hex } from "@cloakroom/types";
import { isAddressEqual } from "viem";
import { normalize } from "viem/ens";

import { creationBlock, findRegistry, listChildren, nameController, type SepoliaReader } from "./ens";
import type { RosterMember, SubtreeRuleData } from "./records";

/** ENSv2 roles allow at most 15 holders per role; one slot stays free for the owner's own changes. */
export const SUBTREE_CAP = 14;

export interface SubtreeHolder {
  /** priya.acme.eth */
  name: string;
  /** Who controls the name now. */
  controller: Address;
  /** The holder's current key from their public log, or null with the reason. */
  key: Hex | null;
  why?: string;
}

const registryStart = new Map<string, bigint>();

/** Every live subname of `parent` and its holder's key. `keyOf` resolves a name's key through its public log. */
export async function listSubtreeHolders(
  client: SepoliaReader,
  parent: string,
  keyOf: (name: string) => Promise<{ key: Hex | null; why?: string }>,
): Promise<SubtreeHolder[]> {
  const p = normalize(parent);
  const registry = await findRegistry(client, p);
  if (!registry) return [];
  const id = registry.toLowerCase();
  let from = registryStart.get(id);
  if (from === undefined) {
    from = await creationBlock(client, registry);
    registryStart.set(id, from);
  }
  const children = await listChildren(client, registry, { fromBlock: from });
  const out: SubtreeHolder[] = [];
  for (const child of children) {
    const name = `${child.label}.${p}`;
    const controller = await nameController(client, name).catch(() => null);
    if (!controller) continue; // unregistered or expired
    const { key, why } = await keyOf(name).catch((e: unknown) => ({ key: null, why: e instanceof Error ? e.message : String(e) }));
    out.push({ name, controller, key, ...(why ? { why } : {}) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface SyncPlan {
  add: SubtreeHolder[];
  /** Members to revoke: their name is gone, excluded, or changed hands. */
  remove: RosterMember[];
}

/**
 * What one sync of `rule` must do, given the roster's current members and the live holders.
 * - new holder with a valid key → add
 * - member whose name is gone, expired, excluded, or now controlled by someone else → remove
 *   (and the new controller, if they have a key, is added fresh)
 */
export function planSync(rule: SubtreeRuleData, members: readonly RosterMember[], holders: readonly SubtreeHolder[]): SyncPlan {
  const excluded = new Set(rule.excluded.map((n) => n.toLowerCase()));
  const live = new Map<string, SubtreeHolder>();
  for (const h of holders) if (h.key && !excluded.has(h.name.toLowerCase())) live.set(h.name.toLowerCase(), h);
  const mine = members.filter((m) => m.rule === rule.parent);
  const remove: RosterMember[] = [];
  const kept = new Set<string>();
  for (const m of mine) {
    const name = (m.label ?? "").toLowerCase();
    const h = live.get(name);
    if (!h || !m.holder || !isAddressEqual(h.controller, m.holder)) remove.push(m);
    else kept.add(name);
  }
  const add = [...live.values()].filter((h) => !kept.has(h.name.toLowerCase()));
  return { add, remove };
}

/** True when the members a rule would leave in place plus `adding` exceed what one role can hold. */
export function overCap(members: readonly RosterMember[], removing: readonly RosterMember[], adding: number): boolean {
  const removed = new Set(removing.map((m) => m.address.toLowerCase()));
  const staying = members.filter((m) => (m.until === null || m.until > Math.floor(Date.now() / 1000)) && !removed.has(m.address.toLowerCase()));
  return staying.length + adding > SUBTREE_CAP;
}
