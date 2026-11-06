"use client";

import type { IncomingShare, Member, Timestamp } from "@cloakroom/types";
import { EyeOff, Fuel, RefreshCw, Users } from "lucide-react";
import { useState } from "react";
import { Button, ErrorNote } from "./primitives";
import { Tag, Ticket } from "./Ticket";

/**
 * Everyone with access to a folder, as tickets. Removing someone refreshes the keys for this folder and its
 * subfolders, so the files added after that are locked for them.
 */
export function MembersPanel({
  members,
  now,
  canManage,
  onRemove,
  teamOf,
}: {
  members: Member[];
  now: Timestamp;
  canManage: boolean;
  onRemove: (m: Member) => Promise<void>;
  /** Add-on F2: the team (e.g. "acme.eth") a member came from. Those are excluded from the team, not removed here. */
  teamOf?: (m: Member) => string | null;
}) {
  const [confirm, setConfirm] = useState<Member | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!members.length)
    return <p className="text-sm text-muted">Only you, so far. Share this folder to give someone a ticket.</p>;

  return (
    <ul className="flex flex-col gap-2.5">
      {members.map((m) => {
        const team = teamOf?.(m) ?? null;
        return (
          <li key={m.address}>
            <Ticket
              address={m.address}
              title={m.label}
              role={m.role}
              until={m.until}
              now={now}
              tags={
                (m.via === "group" || team || m.hiddenFromMembers || m.needsGas) && (
                  <>
                    {m.via === "group" && (
                      <Tag>
                        <Users size={12} aria-hidden /> Via group
                      </Tag>
                    )}
                    {team && (
                      <Tag title={`Added because they hold a name under ${team}. Exclude them in the team panel.`}>
                        <Users size={12} aria-hidden /> Via {team}
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
                !team && (
                  <Button variant="quiet" className="px-2" onClick={() => setConfirm(m)} aria-label={`Remove ${m.label}`}>
                    Remove
                  </Button>
                )
              }
            />
            {confirm?.address === m.address && (
              <div className="mt-2 flex flex-col gap-2 rounded-md border border-line bg-card p-3 text-sm">
                <p>
                  Remove {m.label}? Keys for this folder and its subfolders will be refreshed now. New files will be locked for
                  them. What they already opened, they keep.
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
                        await onRemove(m);
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
        );
      })}
    </ul>
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
