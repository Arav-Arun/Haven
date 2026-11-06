"use client";

import type { Address, Role, Timestamp } from "@cloakroom/types";
import { Check, LoaderCircle, RefreshCw, TriangleAlert, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { describeError } from "./errors";
import { formatAgo, formatUntil, ROLE_LABEL, shortAddress } from "./format";
import { Button, ErrorNote, inputClass } from "./primitives";

// Add-on F2, sharing with everyone under an ENS name. These shapes are the add-on's proposed @cloakroom/types
// additions (SubtreeRule, plus a preview); @cloakroom/core's subtree.ts returns exactly these.

export interface SubtreeRuleView {
  parent: string;
  role: Role;
  until: Timestamp | null;
  excluded: string[];
  memberCount: number;
  lastSyncedAt: Timestamp;
  /** Who the rule shared with, through which random address. Managers only. */
  members?: { ensName: string; address: Address }[];
}

export interface SubtreePreviewView {
  found: number;
  withKey: number;
  withoutKey: string[];
}

/** The most people a folder holds (ENS allows 15 holders per role; the owner is one). */
export const TEAM_CAP = 14;

export const TEAM_EXPLAINER =
  "The chain only sees random addresses. It never learns this folder is shared with your team.";

type PreviewState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok"; parent: string; preview: SubtreePreviewView }
  | { state: "failed"; error: unknown };

/** The "Team" tab's name field and live preview: "12 members found (2 have no Cloakroom key)". */
export function TeamPicker({
  previewTeam,
  onReady,
}: {
  previewTeam: (parentEnsName: string) => Promise<SubtreePreviewView>;
  /** The parent name once it can be shared with, or null. */
  onReady: (parent: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<PreviewState>({ state: "idle" });

  useEffect(() => {
    const n = name.trim().toLowerCase();
    if (!n.includes(".")) return setPreview({ state: "idle" });
    setPreview({ state: "checking" });
    let live = true;
    const t = setTimeout(() => {
      previewTeam(n).then(
        (p) => live && setPreview({ state: "ok", parent: n, preview: p }),
        (error) => live && setPreview({ state: "failed", error }),
      );
    }, 500);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [name, previewTeam]);

  const ready =
    preview.state === "ok" && preview.preview.withKey > 0 && preview.preview.withKey <= TEAM_CAP ? preview.parent : null;
  useEffect(() => onReady(ready), [ready, onReady]);

  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <label className="flex flex-col gap-1.5">
        Everyone under this ENS name
        <input
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="acme.eth"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
        />
      </label>
      <span aria-live="polite" className="min-h-5 text-xs">
        {preview.state === "checking" && (
          <span className="inline-flex items-center gap-1 text-muted">
            <LoaderCircle size={12} className="animate-spin" aria-hidden /> Reading {name.trim()}&apos;s subnames…
          </span>
        )}
        {preview.state === "failed" && (
          <span className="inline-flex items-center gap-1 text-danger">
            <TriangleAlert size={12} aria-hidden /> {describeError(preview.error).title}
          </span>
        )}
        {preview.state === "ok" && <PreviewLine preview={preview.preview} />}
      </span>
      <p className="text-xs text-muted">
        People who get a subname later are added automatically; people whose subname ends or moves are removed, and the
        files added after that are locked for them. {TEAM_EXPLAINER}
      </p>
    </div>
  );
}

function PreviewLine({ preview }: { preview: SubtreePreviewView }) {
  const { found, withKey, withoutKey } = preview;
  if (found === 0)
    return (
      <span className="inline-flex items-center gap-1 text-danger">
        <TriangleAlert size={12} aria-hidden /> No subnames found under this name.
      </span>
    );
  const counts = `${found} ${found === 1 ? "member" : "members"} found${withoutKey.length ? ` (${withoutKey.length} ${withoutKey.length === 1 ? "has" : "have"} no Cloakroom key)` : ""}.`;
  if (withKey > TEAM_CAP)
    return (
      <span className="inline-flex items-center gap-1 text-danger">
        <TriangleAlert size={12} aria-hidden /> {counts} A folder can hold at most {TEAM_CAP} people. Use several rooms, or
        split the team.
      </span>
    );
  if (withKey === 0)
    return (
      <span className="inline-flex items-center gap-1 text-danger">
        <TriangleAlert size={12} aria-hidden /> {counts} Ask them to sign in to Cloakroom once.
      </span>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-private" title={withoutKey.join(", ")}>
      <Check size={12} aria-hidden /> {counts}
    </span>
  );
}

/** The folder's team rules, for its managers: who each one shared with, exclusions, and when it last synced. */
export function TeamRulesPanel({
  rules,
  now,
  onExclude,
  onRemoveRule,
  onSync,
}: {
  rules: SubtreeRuleView[];
  now: Timestamp;
  onExclude?: (parent: string, memberEnsName: string) => Promise<void>;
  onRemoveRule?: (parent: string) => Promise<void>;
  /** Runs the sync now (the client's maintain()). */
  onSync?: () => Promise<void>;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  if (!rules.length) return null;

  const run = async (id: string, action: () => Promise<void>) => {
    setPending(id);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {rules.map((rule) => (
        <section key={rule.parent} className="flex flex-col gap-2 rounded-md border border-line p-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <span className="flex items-center gap-2">
              <UsersRound size={16} className="text-muted" aria-hidden />
              <span>
                <span className="font-medium">Everyone under {rule.parent}</span>
                <span className="block text-xs text-muted">
                  {ROLE_LABEL[rule.role]} · {formatUntil(rule.until, now)} · {rule.memberCount}{" "}
                  {rule.memberCount === 1 ? "person" : "people"} ·{" "}
                  {rule.lastSyncedAt ? `last synced ${formatAgo(rule.lastSyncedAt, now)}` : "not synced yet"}
                </span>
              </span>
            </span>
            <span className="flex gap-1">
              {onSync && (
                <Button variant="quiet" pending={pending === `sync:${rule.parent}`} onClick={() => run(`sync:${rule.parent}`, onSync)}>
                  <RefreshCw size={14} aria-hidden /> Sync now
                </Button>
              )}
              {onRemoveRule && (
                <Button
                  variant="quiet"
                  pending={pending === `remove:${rule.parent}`}
                  onClick={() => run(`remove:${rule.parent}`, () => onRemoveRule(rule.parent))}
                >
                  Stop sharing with the team
                </Button>
              )}
            </span>
          </div>
          {rule.members && rule.members.length > 0 && (
            <ul className="flex flex-col divide-y divide-line">
              {rule.members.map((m) => (
                <li key={m.address} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span>
                    {m.ensName}{" "}
                    <span className="text-xs text-muted" title={m.address}>
                      as {shortAddress(m.address)} on chain
                    </span>
                  </span>
                  {onExclude && (
                    <Button
                      variant="quiet"
                      pending={pending === `exclude:${m.ensName}`}
                      onClick={() => run(`exclude:${m.ensName}`, () => onExclude(rule.parent, m.ensName))}
                    >
                      Exclude
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {rule.excluded.length > 0 && <p className="text-xs text-muted">Excluded: {rule.excluded.join(", ")}</p>}
        </section>
      ))}
      <p className="text-xs text-muted">{TEAM_EXPLAINER}</p>
      <ErrorNote error={error} />
    </div>
  );
}

/** "via acme.eth" for a member address that a team rule shared with, or null. */
export function teamOf(rules: SubtreeRuleView[], address: Address): string | null {
  const a = address.toLowerCase();
  return rules.find((r) => r.members?.some((m) => m.address.toLowerCase() === a))?.parent ?? null;
}
