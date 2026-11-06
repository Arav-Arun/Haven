"use client";

import type { IncomingShare, Member, Timestamp } from "@haven/types";
import { AtSign, EyeOff, Fuel, RefreshCw, Users } from "lucide-react";
import { useState } from "react";
import { formatAgo } from "./format";
import { Button, ErrorNote } from "./primitives";
import { Tag, Ticket } from "./Ticket";

/**
 * Everyone with access to a folder, as tickets. Removing someone refreshes the keys for this folder and its
 * subfolders, so the files added after that are locked for them.
 */
/** Add-on F2: a "share with everyone under acme.eth" rule (core's SubtreeRule, structurally). */
export interface TeamRuleView {
  parent: string;
  /** How to show the rule when it isn't an ENS name (a group). */
  label?: string;
  memberCount: number;
  lastSyncedAt: Timestamp;
  excluded: string[];
}

type PanelMember = Member & { rule?: string; inherited?: boolean };

/** Team rules on a folder: who they reach, when they last synced, and "Sync now". */
function TeamRules({
  rules,
  now,
  onSync,
  onRemoveRule,
}: {
  rules: TeamRuleView[];
  now: Timestamp;
  onSync?: () => Promise<void>;
  onRemoveRule?: (parent: string) => Promise<void>;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const act = async (id: string, f: () => Promise<void>) => {
    setPending(id);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(e);
    } finally {
      setPending(null);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      {rules.map((r) => (
        <div key={r.parent} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-card px-3 py-2 text-sm">
          <div>
            <p className="font-medium">{r.label ? `Everyone in ${r.label}` : `Everyone at ${r.parent}`}</p>
            <p className="text-xs text-muted">
              {r.memberCount} {r.memberCount === 1 ? "person" : "people"}
              {r.excluded.length ? `, ${r.excluded.length} excluded` : ""}, last synced {r.lastSyncedAt ? formatAgo(r.lastSyncedAt, now) : "never"}
            </p>
          </div>
          <div className="flex gap-1">
            {onSync && (
              <Button variant="quiet" className="px-2" pending={pending === `sync:${r.parent}`} onClick={() => act(`sync:${r.parent}`, onSync)}>
                Sync now
              </Button>
            )}
            {onRemoveRule && (
              <Button variant="quiet" className="px-2" pending={pending === `stop:${r.parent}`} onClick={() => act(`stop:${r.parent}`, () => onRemoveRule(r.parent))}>
                Stop sharing
              </Button>
            )}
          </div>
        </div>
      ))}
      <p className="text-xs text-muted">The chain only sees random addresses. It never learns this folder is shared with a team.</p>
      <ErrorNote error={error} />
    </div>
  );
}

export function MembersPanel({
  members,
  now,
  canManage,
  onRemove,
  rules,
  onExclude,
  onSync,
  onRemoveRule,
}: {
  members: PanelMember[];
  now: Timestamp;
  canManage: boolean;
  onRemove: (m: Member) => Promise<void>;
  /** Add-on F2. */
  rules?: TeamRuleView[];
  onExclude?: (parent: string, memberEnsName: string) => Promise<void>;
  onSync?: () => Promise<void>;
  onRemoveRule?: (parent: string) => Promise<void>;
}) {
  const [confirm, setConfirm] = useState<PanelMember | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!members.length && !rules?.length)
    return <p className="text-sm text-muted">Only you, so far. Share this folder to give someone a ticket.</p>;

  return (
    <div className="flex flex-col gap-3">
    {rules && rules.length > 0 && <TeamRules rules={rules} now={now} onSync={canManage ? onSync : undefined} onRemoveRule={canManage ? onRemoveRule : undefined} />}
    <ul className="flex flex-col gap-2.5">
      {members.map((m) => (
        <li key={m.address}>
          <Ticket
            address={m.address}
            title={m.label}
            role={m.role}
            until={m.until}
            now={now}
            tags={
              (m.via === "group" || m.hiddenFromMembers || m.needsGas || m.rule || m.inherited) && (
                <>
                  {m.inherited && (
                    <Tag title="This subfolder follows its parent folder's members">
                      <Users size={12} aria-hidden /> From the parent folder
                    </Tag>
                  )}
                  {m.rule && (
                    <Tag title="Added because their name is under this ENS name">
                      <AtSign size={12} aria-hidden /> Via {m.rule}
                    </Tag>
                  )}
                  {m.via === "group" && (
                    <Tag>
                      <Users size={12} aria-hidden /> Via group
                    </Tag>
                  )}
                  {m.hiddenFromMembers && (
                    <Tag title="Other members see only the random address">
                      <EyeOff size={12} aria-hidden /> Hidden from members
                    </Tag>
                  )}
                  {m.needsGas && (
                    <Tag tone="warn" title="Their random address needs a little Sepolia ETH to add files. Your app tops it up when it opens.">
                      <Fuel size={12} aria-hidden /> Needs gas
                    </Tag>
                  )}
                </>
              )
            }
            actions={
              canManage &&
              m.via === "direct" &&
              !m.inherited && (
                <Button variant="quiet" className="px-2" onClick={() => setConfirm(m)} aria-label={`${m.rule ? "Exclude" : "Remove"} ${m.label}`}>
                  {m.rule ? "Exclude" : "Remove"}
                </Button>
              )
            }
          />
          {confirm?.address === m.address && (
            <div className="mt-2 flex flex-col gap-2 rounded-md border border-line bg-card p-3 text-sm">
              <p>
                {m.rule ? `Exclude ${m.label} from ${m.rule}?` : `Remove ${m.label}?`} Keys for this folder and its subfolders will be
                refreshed now. New files will be locked for them. What they already opened, they keep.
              </p>
              <ErrorNote error={error} />
              <div className="flex justify-end gap-2">
                <Button variant="quiet" onClick={() => (setConfirm(null), setError(null))}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  pending={pending}
                  onClick={async () => {
                    setPending(true);
                    setError(null);
                    try {
                      if (m.rule && onExclude) await onExclude(m.rule, m.label);
                      else await onRemove(m);
                      setConfirm(null);
                    } catch (e) {
                      setError(e);
                    } finally {
                      setPending(false);
                    }
                  }}
                >
                  Remove and refresh keys
                </Button>
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
    </div>
  );
}

/** Folders other people shared with you, as the tickets you hold. */
export function IncomingTickets({
  shares,
  now,
  onOpen,
}: {
  shares: IncomingShare[];
  now: Timestamp;
  onOpen: (s: IncomingShare) => void;
}) {
  return (
    <ul className="flex flex-col gap-2.5">
      {shares.map((s) => (
        <li key={s.folder.registry}>
          <button onClick={() => onOpen(s)} className="block w-full text-left">
            <Ticket
              address={s.folder.registry}
              title={s.folder.displayName}
              subtitle={`From ${s.sharedBy}`}
              role={s.role}
              until={s.until}
              now={now}
            />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function RefreshPendingBanner() {
  return (
    <div role="status" className="flex items-start gap-2 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
      <RefreshCw size={16} className="mt-0.5 shrink-0" aria-hidden />
      <p>
        <span className="font-medium">Waiting for the owner to refresh access.</span> Someone was removed, so new keys are
        needed before files can be added. A manager&apos;s app does this when it next opens.
      </p>
    </div>
  );
}
