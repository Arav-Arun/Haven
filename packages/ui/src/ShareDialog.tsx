"use client";

import type { Folder, Member, Role, ShareOptions, Timestamp } from "@cloakroom/types";
import { Check, LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { describeError } from "./errors";
import { cx, formatDate, nowSeconds, ROLE_ABOUT, ROLE_LABEL } from "./format";
import { type KeyInfoView, RecipientKey } from "./KeyDirectory";
import { Button, Dialog, ErrorNote, inputClass } from "./primitives";

type Preset = "2m" | "1h" | "1d" | "1w" | "month" | "custom" | "never";

function untilFor(preset: Preset, custom: string, now: Timestamp): Timestamp | null {
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
    case "custom":
      return custom ? Math.floor(new Date(custom).getTime() / 1000) : null;
    case "never":
      return null;
  }
}

type Lookup =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok"; ensName: string }
  | { state: "no"; ensName: string; reason: string };

type KeyCheck =
  | { state: "off" }
  | { state: "checking" }
  | { state: "ok"; info: KeyInfoView }
  | { state: "failed"; error: unknown };

/**
 * Share a folder with an ENS name or one of your groups. The recipient is looked up live: names without a
 * Cloakroom key are refused before anything is sent. With `lookupKey` (add-on F1), the recipient's key is also checked
 * against its public log: sharing is blocked if it disagrees with ENS, and held until confirmed if it changed.
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
  profileHref,
}: {
  open: boolean;
  onClose: () => void;
  folder: Folder;
  groups: Folder[];
  demoMode: boolean;
  lookupRecipient: (ensName: string) => Promise<{ ensName: string; canReceive: boolean }>;
  onShare: (recipient: string, opts: ShareOptions) => Promise<Member>;
  lookupKey?: (ensName: string) => Promise<KeyInfoView>;
  confirmKeyChange?: (ensName: string) => Promise<void>;
  profileHref?: (ensName: string) => string;
}) {
  const [to, setTo] = useState<"name" | "group">("name");
  const [name, setName] = useState("");
  const [group, setGroup] = useState<string>("");
  const [lookup, setLookup] = useState<Lookup>({ state: "idle" });
  const [role, setRole] = useState<Role>("viewer");
  const [preset, setPreset] = useState<Preset>(demoMode ? "2m" : "1w");
  const [custom, setCustom] = useState("");
  const [hide, setHide] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<Member | null>(null);

  useEffect(() => {
    const n = name.trim().toLowerCase();
    if (to !== "name" || !n.includes(".")) return setLookup({ state: "idle" });
    setLookup({ state: "checking" });
    let live = true;
    const t = setTimeout(() => {
      lookupRecipient(n).then(
        (r) =>
          live &&
          setLookup(
            r.canReceive
              ? { state: "ok", ensName: r.ensName }
              : { state: "no", ensName: r.ensName, reason: "This name hasn't set up Cloakroom yet. Ask them to sign in once." },
          ),
        (e) => live && setLookup({ state: "no", ensName: n, reason: describeError(e).title }),
      );
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [name, to, lookupRecipient]);

  const [keyCheck, setKeyCheck] = useState<KeyCheck>({ state: "off" });
  const [keyTick, setKeyTick] = useState(0);
  const checkedName = lookup.state === "ok" ? lookup.ensName : null;

  useEffect(() => {
    if (!lookupKey || to !== "name" || !checkedName) return setKeyCheck({ state: "off" });
    setKeyCheck({ state: "checking" });
    let live = true;
    lookupKey(checkedName).then(
      (info) => live && setKeyCheck({ state: "ok", info }),
      (error) => live && setKeyCheck({ state: "failed", error }),
    );
    return () => {
      live = false;
    };
  }, [lookupKey, to, checkedName, keyTick]);

  /** With F1 on, a person can be shared with only once their key checks out. Groups are checked per member. */
  const keyBlocks =
    !!lookupKey &&
    to === "name" &&
    !(keyCheck.state === "ok" && keyCheck.info.matchesEns && !keyCheck.info.changedSinceLastShare);

  const until = untilFor(preset, custom, nowSeconds());
  const recipient = to === "name" ? (lookup.state === "ok" ? lookup.ensName : null) : group || null;
  const customInvalid = preset === "custom" && (until === null || until <= nowSeconds());

  const submit = async () => {
    if (!recipient) return;
    setPending(true);
    setError(null);
    try {
      setDone(await onShare(recipient, { role, until: untilFor(preset, custom, nowSeconds()), hideFromMembers: hide }));
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };

  const close = () => {
    setDone(null);
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
      {done ? (
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
          {groups.length > 0 && (
            <div className="flex gap-1 rounded-md bg-line/50 p-1 text-sm" role="radiogroup" aria-label="Share with">
              {(["name", "group"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={to === k}
                  onClick={() => setTo(k)}
                  className={cx("flex-1 rounded px-3 py-1.5", to === k ? "bg-card font-medium shadow-sm" : "text-muted")}
                >
                  {k === "name" ? "A person" : "A group"}
                </button>
              ))}
            </div>
          )}

          {to === "name" ? (
            <div className="flex flex-col gap-1.5">
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
                    <span className="inline-flex items-center gap-1 text-private">
                      <Check size={12} aria-hidden /> {lookup.ensName} can receive files.
                    </span>
                  )}
                  {lookup.state === "no" && (
                    <span className="inline-flex items-center gap-1 text-danger">
                      <TriangleAlert size={12} aria-hidden /> {lookup.reason}
                    </span>
                  )}
                </span>
              </label>
              {keyCheck.state === "checking" && (
                <span className="inline-flex items-center gap-1 text-xs text-muted">
                  <LoaderCircle size={12} className="animate-spin" aria-hidden /> Checking their key against its public log…
                </span>
              )}
              {keyCheck.state === "failed" && <ErrorNote error={keyCheck.error} />}
              {keyCheck.state === "ok" && (
                <RecipientKey
                  info={keyCheck.info}
                  {...(profileHref ? { profileHref: profileHref(keyCheck.info.ensName) } : {})}
                  {...(confirmKeyChange
                    ? {
                        onConfirmChange: async () => {
                          await confirmKeyChange(keyCheck.info.ensName);
                          setKeyTick((t) => t + 1);
                        },
                      }
                    : {})}
                />
              )}
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
                <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} className="accent-ink" />
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
                  className={cx("rounded-md border px-2.5 py-1", preset === p ? "border-ink bg-ink text-paper" : "border-line bg-card")}
                >
                  {label}
                </button>
              ))}
            </div>
            {preset === "custom" && (
              <input
                type="datetime-local"
                className={inputClass}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                aria-label="Custom end date"
                required
              />
            )}
            <p className="text-muted">New files will be locked for them after this date. What they already opened, they keep.</p>
          </fieldset>

          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} className="mt-1 accent-ink" />
            <span>
              Hide from other members
              <span className="block text-muted">Other members see only a random address, not this name.</span>
            </span>
          </label>

          <ErrorNote error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="quiet" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" pending={pending} disabled={!recipient || customInvalid || keyBlocks}>
              Share
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
