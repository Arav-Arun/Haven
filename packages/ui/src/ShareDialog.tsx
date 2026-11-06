"use client";

import type { Folder, Member, Role, ShareOptions, Timestamp } from "@haven/types";
import { Check, Fingerprint, LoaderCircle, ShieldAlert, TriangleAlert, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { describeError } from "./errors";
import { cx, formatDate, nowSeconds, ROLE_ABOUT, ROLE_LABEL } from "./format";
import { Button, Dialog, ErrorNote, inputClass } from "./primitives";

type Preset = "2m" | "1h" | "1d" | "1w" | "month" | "custom" | "never";

const UNIT_SECONDS: Record<string, number> = {
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
  d: 86_400, day: 86_400, days: 86_400,
  w: 604_800, wk: 604_800, week: 604_800, weeks: 604_800,
};

/**
 * "5m 30s", "5 min 30 sec", "1h30m", "2 hours", "3 days" → seconds. A bare number is minutes. null if it can't be read.
 */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/,|\band\b/g, " ");
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t) * 60);
  let total = 0;
  let rest = t;
  const part = /^\s*(\d+(?:\.\d+)?)\s*([a-z]+)\s*/;
  while (rest.length) {
    const m = rest.match(part);
    if (!m) return null;
    const unit = UNIT_SECONDS[m[2]!];
    if (!unit) return null;
    total += Number(m[1]) * unit;
    rest = rest.slice(m[0].length);
  }
  return total > 0 ? Math.round(total) : null;
}

/** "5 minutes 30 seconds" for a number of seconds. */
function spell(seconds: number): string {
  const units: [number, string][] = [[86_400, "day"], [3600, "hour"], [60, "minute"], [1, "second"]];
  const out: string[] = [];
  let left = seconds;
  for (const [n, name] of units) {
    const q = Math.floor(left / n);
    if (q) out.push(`${q} ${name}${q === 1 ? "" : "s"}`);
    left -= q * n;
  }
  return out.slice(0, 3).join(" ");
}

function untilFor(preset: Preset, custom: string, now: Timestamp, customAt = ""): Timestamp | null {
  switch (preset) {
    case "2m":
      return now + 120;
    case "1h":
      return now + 3600;
    case "1d":
      return now + 86_400;
    case "1w":
      return now + 7 * 86_400;
    case "month": {
      const d = new Date();
      return Math.floor(new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() / 1000) - 1;
    }
    case "custom": {
      if (customAt) return Math.floor(new Date(customAt).getTime() / 1000);
      const secs = parseDuration(custom);
      return secs === null ? null : now + secs;
    }
    case "never":
      return null;
  }
}

/** Add-on F1: what the share dialog shows about a recipient's public key log (core's KeyInfo, structurally). */
export interface RecipientKeyView {
  ensName: string;
  current: string | null;
  fingerprint: string[];
  matchesEns: boolean;
  changedSinceLastShare: boolean;
  problem: string | null;
  history: { at: Timestamp }[];
}

/** Add-on F2: who a team share would reach (core's SubtreePreview, structurally). */
export interface TeamPreview {
  parent: string;
  ready: string[];
  noKey: { name: string; why: string }[];
}

/** The eight fingerprint words, for comparing in person. */
export function FingerprintWords({ words, className }: { words: string[]; className?: string }) {
  if (!words.length) return null;
  return (
    <span className={cx("inline-flex flex-wrap items-center gap-1", className)} aria-label={`Key fingerprint: ${words.join(" ")}`}>
      <Fingerprint size={12} aria-hidden className="text-muted" />
      {words.map((w, i) => (
        <span key={i} className="rounded-md bg-ink/8 px-1 font-mono text-[11px]">
          {w}
        </span>
      ))}
    </span>
  );
}

type Lookup =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok"; ensName: string }
  | { state: "no"; ensName: string; reason: string };

/**
 * Share a folder with an ENS name or one of your groups. The recipient is looked up live: names without a
 * Haven key are refused before anything is sent.
 */
export function ShareDialog({
  open,
  onClose,
  folder,
  groups,
  demoMode,
  lookupRecipient,
  onShare,
  lookupKey,
  confirmKeyChange,
  previewTeam,
  onShareTeam,
}: {
  open: boolean;
  onClose: () => void;
  folder: Folder;
  groups: Folder[];
  demoMode: boolean;
  lookupRecipient: (ensName: string) => Promise<{ ensName: string; canReceive: boolean }>;
  onShare: (recipient: string, opts: ShareOptions) => Promise<Member>;
  /** Add-on F1: the recipient's key log, for the fingerprint and the "key changed" warning. */
  lookupKey?: (ensName: string) => Promise<RecipientKeyView>;
  confirmKeyChange?: (ensName: string) => Promise<void>;
  /** Add-on F2: share with everyone under an ENS name. */
  previewTeam?: (parent: string) => Promise<TeamPreview>;
  onShareTeam?: (parent: string, opts: ShareOptions) => Promise<{ memberCount: number }>;
}) {
  const [to, setTo] = useState<"name" | "team" | "group">("name");
  const [key, setKey] = useState<RecipientKeyView | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [team, setTeam] = useState("");
  const [preview, setPreview] = useState<TeamPreview | null | "checking">(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [teamDone, setTeamDone] = useState<{ parent: string; memberCount: number } | null>(null);
  const [name, setName] = useState("");
  const [group, setGroup] = useState<string>("");
  const [lookup, setLookup] = useState<Lookup>({ state: "idle" });
  const [role, setRole] = useState<Role>("viewer");
  const [preset, setPreset] = useState<Preset>(demoMode ? "2m" : "1w");
  const [custom, setCustom] = useState("");
  /** "Pick a date and time" instead of typing a duration. */
  const [customAt, setCustomAt] = useState("");
  const [pickDate, setPickDate] = useState(false);
  const [hide, setHide] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<Member | null>(null);
  // Callers often pass a fresh function each render (client.lookupRecipient.bind(client)). Kept in refs, so a
  // re-render (a clock tick, an upload finishing) doesn't cancel a lookup that's under way and start it again.
  const recipientFn = useRef(lookupRecipient);
  recipientFn.current = lookupRecipient;
  const keyFn = useRef(lookupKey);
  keyFn.current = lookupKey;
  const teamFn = useRef(previewTeam);
  teamFn.current = previewTeam;

  useEffect(() => {
    const n = name.trim().toLowerCase();
    if (to !== "name" || !n.includes(".")) return setLookup({ state: "idle" });
    setLookup({ state: "checking" });
    let live = true;
    const t = setTimeout(() => {
      recipientFn.current(n).then(
        (r) =>
          live &&
          setLookup(
            r.canReceive
              ? { state: "ok", ensName: r.ensName }
              : { state: "no", ensName: r.ensName, reason: "This name hasn't set up Haven yet. Ask them to sign in once." },
          ),
        (e) => live && setLookup({ state: "no", ensName: n, reason: describeError(e).title }),
      );
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [name, to]);

  const okName = lookup.state === "ok" ? lookup.ensName : null;
  useEffect(() => {
    setKey(null);
    const fn = keyFn.current;
    if (!okName || !fn) return;
    let live = true;
    fn(okName).then((k) => live && setKey(k), () => undefined);
    return () => {
      live = false;
    };
  }, [okName]);

  useEffect(() => {
    const p = team.trim().toLowerCase();
    setPreviewError(null);
    const preview = teamFn.current;
    if (to !== "team" || !preview || !p.includes(".")) return setPreview(null);
    setPreview("checking");
    let live = true;
    const t = setTimeout(() => {
      preview(p).then(
        (r) => live && setPreview(r),
        (e) => {
          if (!live) return;
          setPreview(null);
          setPreviewError(e);
        },
      );
    }, 500);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [team, to]);

  const until = untilFor(preset, custom, nowSeconds(), pickDate ? customAt : "");
  const keyBlocked = !!key && (key.changedSinceLastShare || !key.matchesEns || !!key.problem);
  const recipient =
    to === "name" ? (lookup.state === "ok" && !keyBlocked ? lookup.ensName : null) : to === "team" ? (preview && preview !== "checking" && preview.ready.length ? preview.parent : null) : group || null;
  const customInvalid = preset === "custom" && (until === null || until <= nowSeconds());

  const submit = async () => {
    if (!recipient) return;
    setPending(true);
    setError(null);
    try {
      const opts = { role, until: untilFor(preset, custom, nowSeconds(), pickDate ? customAt : ""), hideFromMembers: hide };
      if (to === "team" && onShareTeam) setTeamDone({ parent: recipient, ...(await onShareTeam(recipient, opts)) });
      else setDone(await onShare(recipient, opts));
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };

  const close = () => {
    setDone(null);
    setTeamDone(null);
    setTeam("");
    setName("");
    setError(null);
    onClose();
  };

  const presets: [Preset, string][] = [
    ...(demoMode ? ([["2m", "2 minutes"]] as [Preset, string][]) : []),
    ["1h", "1 hour"],
    ["1d", "1 day"],
    ["1w", "1 week"],
    ["month", "End of month"],
    ["custom", "Custom"],
    ["never", "No end date"],
  ];

  return (
    <Dialog open={open} onClose={close} title={`Share ${folder.displayName}`}>
      {teamDone ? (
        <div className="flex flex-col gap-4 text-sm">
          <p>
            Shared with {teamDone.memberCount} {teamDone.memberCount === 1 ? "person" : "people"} under {teamDone.parent}. New names under it
            get access when your app next syncs; names that go away lose it.
          </p>
          <p className="text-muted">The chain only sees random addresses. It never learns this folder is shared with {teamDone.parent}.</p>
          <div className="flex justify-end">
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          </div>
        </div>
      ) : done ? (
        <div className="flex flex-col gap-4 text-sm">
          <p>
            Shared with {done.label} as {ROLE_LABEL[done.role].toLowerCase()}.{" "}
            {done.until === null ? "No end date." : `Until ${formatDate(done.until)}.`}
          </p>
          <p className="text-muted">
            On the chain they appear only as {done.address}, a new random address that can&apos;t be tied to their name.
          </p>
          <div className="flex justify-end">
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {(groups.length > 0 || onShareTeam) && (
            <div className="flex gap-1 rounded-xl bg-line/50 p-1 text-sm" role="radiogroup" aria-label="Share with">
              {(["name", ...(onShareTeam ? (["team"] as const) : []), ...(groups.length ? (["group"] as const) : [])] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={to === k}
                  onClick={() => setTo(k)}
                  className={cx("flex-1 rounded px-3 py-1.5", to === k ? "bg-card font-medium shadow-sm" : "text-muted")}
                >
                  {k === "name" ? "A person" : k === "team" ? "A team" : "A group"}
                </button>
              ))}
            </div>
          )}

          {to === "name" ? (
            <label className="flex flex-col gap-1.5 text-sm">
              ENS name
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="name.eth"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
              />
              <span aria-live="polite" className="min-h-5 text-xs">
                {lookup.state === "checking" && (
                  <span className="inline-flex items-center gap-1 text-muted">
                    <LoaderCircle size={12} className="animate-spin" aria-hidden /> Looking up {name.trim()}…
                  </span>
                )}
                {lookup.state === "ok" && (
                  <span className="flex flex-col gap-1">
                    <span className="inline-flex items-center gap-1 text-private">
                      <Check size={12} aria-hidden /> {lookup.ensName} can receive files.
                    </span>
                    {key && <FingerprintWords words={key.fingerprint} />}
                  </span>
                )}
                {lookup.state === "no" && (
                  <span className="inline-flex items-center gap-1 text-danger">
                    <TriangleAlert size={12} aria-hidden /> {lookup.reason}
                  </span>
                )}
              </span>
            </label>
          ) : to === "team" ? (
            <div className="flex flex-col gap-1.5 text-sm">
              <label className="flex flex-col gap-1.5">
                Everyone under this ENS name
                <input
                  className={inputClass}
                  value={team}
                  onChange={(e) => setTeam(e.target.value)}
                  placeholder="acme.eth"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus
                />
              </label>
              <span aria-live="polite" className="min-h-5 text-xs">
                {preview === "checking" && (
                  <span className="inline-flex items-center gap-1 text-muted">
                    <LoaderCircle size={12} className="animate-spin" aria-hidden /> Reading names under {team.trim()}…
                  </span>
                )}
                {preview && preview !== "checking" && (
                  <span className={cx("inline-flex items-center gap-1", preview.ready.length ? "text-private" : "text-danger")}>
                    <Users size={12} aria-hidden />
                    {preview.ready.length + preview.noKey.length} members found
                    {preview.noKey.length ? ` (${preview.noKey.length} ${preview.noKey.length === 1 ? "has" : "have"} no Haven key)` : ""}
                  </span>
                )}
                {previewError ? <span className="text-danger">{describeError(previewError).title}</span> : null}
              </span>
              {preview && preview !== "checking" && preview.ready.length + preview.noKey.length > 0 && (
                <ul className="max-h-28 overflow-auto rounded-xl border border-line bg-paper/60 p-2 text-xs">
                  {preview.ready.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                  {preview.noKey.map((n) => (
                    <li key={n.name} className="text-muted">
                      {n.name}: {n.why}
                    </li>
                  ))}
                </ul>
              )}
              <span className="text-xs text-muted">
                The chain only sees random addresses. It never learns this folder is shared with {team.trim() || "the team"}. The rule is
                kept encrypted for managers only.
              </span>
            </div>
          ) : (
            <label className="flex flex-col gap-1.5 text-sm">
              Group
              <select className={inputClass} value={group} onChange={(e) => setGroup(e.target.value)} required>
                <option value="">Choose a group</option>
                {groups.map((g) => (
                  <option key={g.registry} value={g.registry}>
                    {g.displayName}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted">Everyone in the group gets access, and people you add to the group later too.</span>
            </label>
          )}

          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1">Role</legend>
            {(["viewer", "editor", "manager"] as const).map((r) => (
              <label key={r} className="flex cursor-pointer items-baseline gap-2">
                <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} className="accent-action" />
                <span>
                  <span className="font-medium">{ROLE_LABEL[r]}</span> <span className="text-muted">{ROLE_ABOUT[r]}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1">Access until</legend>
            <div className="flex flex-wrap gap-1.5">
              {presets.map(([p, label]) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={preset === p}
                  onClick={() => setPreset(p)}
                  className={cx("rounded-xl border px-2.5 py-1", preset === p ? "border-action bg-action text-white" : "border-line bg-card")}
                >
                  {label}
                </button>
              ))}
            </div>
            {preset === "custom" && (
              <div className="flex flex-col gap-1.5">
                {pickDate ? (
                  <input
                    type="datetime-local"
                    className={inputClass}
                    value={customAt}
                    onChange={(e) => setCustomAt(e.target.value)}
                    aria-label="Access ends at"
                    required
                  />
                ) : (
                  <input
                    className={inputClass}
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    placeholder="How long? e.g. 5m 30s, 2 hours, 3 days"
                    aria-label="How long access lasts"
                    autoFocus
                    required
                  />
                )}
                <p className={cx("text-xs", until !== null && until > nowSeconds() ? "text-private" : "text-muted")}>
                  {until !== null && until > nowSeconds()
                    ? `${pickDate ? "Ends" : `${spell(until - nowSeconds())}, ends`} ${new Date(until * 1000).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit", second: "2-digit" })}`
                    : pickDate
                      ? "Pick when access ends."
                      : "Type a length like 5m 30s, 90 minutes, 2h or 1 week."}{" "}
                  <button type="button" className="font-medium text-action underline-offset-2 hover:underline" onClick={() => setPickDate((v) => !v)}>
                    {pickDate ? "Type a length instead" : "Pick a date and time"}
                  </button>
                </p>
              </div>
            )}
            <p className="text-muted">New files will be locked for them after this date. What they already opened, they keep.</p>
          </fieldset>

          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} className="mt-1 accent-action" />
            <span>
              Hide from other members
              <span className="block text-muted">Other members see only a random address, not this name.</span>
            </span>
          </label>

          {to === "name" && key && keyBlocked && (
            <div role="alert" className="flex flex-col gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
              <p className="flex items-start gap-2">
                <ShieldAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
                {key.problem
                  ? `${key.ensName}'s public key log is broken (${key.problem}). Nothing can be shared with it safely.`
                  : !key.matchesEns
                    ? "This name's key doesn't match its public log."
                    : `${key.ensName}'s key changed${key.history.length ? ` on ${formatDate(key.history[key.history.length - 1]!.at)}` : ""}. Ask them to read you their eight words and compare them with the ones above before you share.`}
              </p>
              {key.changedSinceLastShare && !key.problem && key.matchesEns && confirmKeyChange && (
                <Button
                  type="button"
                  variant="quiet"
                  pending={confirming}
                  onClick={async () => {
                    setConfirming(true);
                    try {
                      await confirmKeyChange(key.ensName);
                      setKey({ ...key, changedSinceLastShare: false });
                    } catch (e) {
                      setError(e);
                    } finally {
                      setConfirming(false);
                    }
                  }}
                >
                  The words match: trust the new key
                </Button>
              )}
            </div>
          )}

          <ErrorNote error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="quiet" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" pending={pending} disabled={!recipient || customInvalid}>
              Share
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
