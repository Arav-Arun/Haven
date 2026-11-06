"use client";

import type { Hex, Timestamp } from "@cloakroom/types";
import { KeyRound, MonitorSmartphone, ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { cx, formatAgo, formatDate, shortAddress } from "./format";
import { Button, ErrorNote } from "./primitives";

// Add-on F1, the public key directory. These shapes are the add-on's proposed @cloakroom/types additions (KeyInfo,
// KeyLogEntry, the listDevices row); they live here until both people agree them on main, and @cloakroom/core's
// keydir.ts returns exactly these.

export interface KeyLogEntryView {
  seq: number;
  kind: "publish" | "rotate" | "revoke-device";
  spendingPublicKey: Hex;
  at: Timestamp;
  arkivKey: Hex;
}

export interface KeyInfoView {
  ensName: string;
  current: Hex;
  fingerprint: string[];
  history: KeyLogEntryView[];
  matchesEns: boolean;
  changedSinceLastShare: boolean;
  /** Entries claiming this name that don't count (another signer, or malformed). */
  ignoredEntries?: number;
}

export interface DeviceView {
  deviceId: string;
  label: string;
  lastSeen: Timestamp;
  expiresAt: Timestamp;
}

/** The 8 words two people read to each other to check they see the same key. */
export function Fingerprint({ words, className }: { words: string[]; className?: string }) {
  return (
    <ol
      className={cx("grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-paper px-3 py-2 font-mono text-sm sm:grid-cols-4", className)}
      aria-label="Key fingerprint"
    >
      {words.map((w, i) => (
        <li key={i} className="flex gap-1.5">
          <span className="text-muted" aria-hidden>
            {i + 1}
          </span>
          {w}
        </li>
      ))}
    </ol>
  );
}

const KIND_LABEL: Record<KeyLogEntryView["kind"], string> = {
  publish: "Key published",
  rotate: "Key changed",
  "revoke-device": "Device removed",
};

/** The name's public key log, newest first, plus how many entries from others were ignored. */
export function KeyHistory({
  history,
  ignoredEntries = 0,
  now,
}: {
  history: KeyLogEntryView[];
  ignoredEntries?: number;
  now: Timestamp;
}) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <ol className="flex flex-col gap-2 border-l border-line pl-4">
        {[...history].reverse().map((e) => (
          <li key={e.arkivKey} className="relative">
            <span
              className={cx(
                "absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full",
                e.kind === "rotate" ? "bg-warn" : e.kind === "publish" ? "bg-private" : "bg-muted",
              )}
              aria-hidden
            />
            <span className="font-medium">{KIND_LABEL[e.kind]}</span>{" "}
            <span className="text-muted">
              #{e.seq} · {e.at ? `${formatDate(e.at)} (${formatAgo(e.at, now)})` : "time unknown"} · entry {shortAddress(e.arkivKey)}
            </span>
          </li>
        ))}
      </ol>
      {ignoredEntries > 0 && (
        <p className="flex items-start gap-2 rounded-md bg-warn-soft px-3 py-2 text-warn">
          <ShieldAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
          {ignoredEntries === 1 ? "1 entry" : `${ignoredEntries} entries`} claiming this name came from someone other than
          its owner, so {ignoredEntries === 1 ? "it was" : "they were"} ignored.
        </p>
      )}
    </div>
  );
}

/** One line under the recipient in the share dialog: their fingerprint, and why sharing is held back if it is. */
export function RecipientKey({
  info,
  profileHref,
  onConfirmChange,
}: {
  info: KeyInfoView;
  profileHref?: string;
  onConfirmChange?: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-muted">
          <KeyRound size={14} aria-hidden /> Their key fingerprint
        </span>
        {profileHref && (
          <a href={profileHref} className="text-xs underline" target="_blank" rel="noreferrer noopener">
            Key history
          </a>
        )}
      </div>
      <Fingerprint words={info.fingerprint} />
      {!info.matchesEns ? (
        <p role="alert" className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-danger">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
          This name&apos;s key doesn&apos;t match its public log. Someone may have taken over the name, so sharing is blocked.
        </p>
      ) : info.changedSinceLastShare ? (
        <div role="alert" className="flex flex-col gap-2 rounded-md bg-warn-soft px-3 py-2 text-warn">
          <p className="flex items-start gap-2">
            <ShieldAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
            {info.ensName}&apos;s key changed since you last shared with them. Check these words with them in person or on a
            call before you trust the new key.
          </p>
          {onConfirmChange && (
            <Button
              className="self-start"
              pending={pending}
              onClick={async () => {
                setPending(true);
                setError(null);
                try {
                  await onConfirmChange();
                } catch (e) {
                  setError(e);
                } finally {
                  setPending(false);
                }
              }}
            >
              I checked the words: trust the new key
            </Button>
          )}
          <ErrorNote error={error} />
        </div>
      ) : (
        <p className="inline-flex items-center gap-1.5 text-private">
          <ShieldCheck size={14} aria-hidden /> Matches the name&apos;s public key log.
        </p>
      )}
    </div>
  );
}

/** Steps for checking a key face to face: both people open this panel and read the words aloud. */
export function VerifyInPerson({ ensName, words }: { ensName: string; words: string[] }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted">
        To be sure {ensName} is really who you think, compare these 8 words with them in person or on a video call. They
        open their own profile page and read their words aloud. If every word matches, nobody has swapped their key.
      </p>
      <Fingerprint words={words} className="text-base" />
    </div>
  );
}

/** The user's own signed-in devices. Removing one goes into the public log, so every app stops trusting it at once. */
export function DevicesList({
  devices,
  now,
  onRevoke,
}: {
  devices: DeviceView[];
  now: Timestamp;
  onRevoke?: (d: DeviceView) => Promise<void>;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!devices.length) return <p className="text-sm text-muted">No devices are registered for this name yet.</p>;
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
        {devices.map((d) => (
          <li key={d.deviceId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
            <span className="flex items-center gap-2">
              <MonitorSmartphone size={16} className="text-muted" aria-hidden />
              <span>
                <span className="font-medium">{d.label}</span>
                <span className="block text-xs text-muted">
                  Last signed in {formatAgo(d.lastSeen, now)} · trusted until {formatDate(d.expiresAt)}
                </span>
              </span>
            </span>
            {onRevoke &&
              (confirm === d.deviceId ? (
                <span className="flex gap-2">
                  <Button variant="quiet" onClick={() => setConfirm(null)} disabled={pending}>
                    Keep
                  </Button>
                  <Button
                    variant="danger"
                    pending={pending}
                    onClick={async () => {
                      setPending(true);
                      setError(null);
                      try {
                        await onRevoke(d);
                        setConfirm(null);
                      } catch (e) {
                        setError(e);
                      } finally {
                        setPending(false);
                      }
                    }}
                  >
                    Remove device
                  </Button>
                </span>
              ) : (
                <Button variant="quiet" onClick={() => setConfirm(d.deviceId)}>
                  Remove
                </Button>
              ))}
          </li>
        ))}
      </ul>
      <ErrorNote error={error} />
    </div>
  );
}
