"use client";

import type { DeviceInfo } from "@cloakroom/core";
import { extensionPresent } from "@cloakroom/platform";
import { Button, ErrorNote, FingerprintWords, Skeleton, formatAgo, formatDate, inputClass } from "@cloakroom/ui";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import { keysInExtension, setKeysInExtension, useDrive, useLoad } from "@/lib/drive";

// Add-on F1 (public key log) and F3 (keys in the extension) controls, used by Settings and the profile page.

export function Devices({ now }: { now: number }) {
  const devices = useLoad((c) => c.listDevices(), []);
  const { client } = useDrive();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const revoke = async (d: DeviceInfo) => {
    if (!client) return;
    setPending(d.deviceId);
    setError(null);
    try {
      await client.revokeDevice(d.deviceId);
      devices.reload();
    } catch (e) {
      setError(e);
    } finally {
      setPending(null);
    }
  };
  return (
    <section className="rounded-lg border border-line bg-card p-5 text-sm">
      <h2 className="font-medium">Your devices</h2>
      <p className="mt-1 text-muted">
        Each device you sign in on is listed in your public log (its label is encrypted to you). A device not used for 90 days
        drops off. Revoking one makes the app on it sign out the next time it opens.
      </p>
      {devices.loading && !devices.data && <Skeleton rows={2} />}
      <ErrorNote error={devices.error} />
      {devices.data?.length === 0 && <p className="mt-3 text-muted">No devices listed yet.</p>}
      <ul className="mt-3 flex flex-col divide-y divide-line">
        {devices.data?.map((d) => (
          <li key={d.deviceId} className="flex items-center justify-between gap-3 py-2">
            <span>
              <span className="font-medium">{d.label}</span>
              {d.thisDevice && <span className="text-private"> (this device)</span>}
              <span className="block text-xs text-muted">
                {d.trusted ? `Signed in ${formatAgo(d.lastSeen, now)}, listed until ${formatDate(d.expiresAt)}` : "Revoked or expired: not trusted"}
              </span>
            </span>
            {d.trusted && !d.thisDevice && (
              <Button variant="quiet" pending={pending === d.deviceId} onClick={() => revoke(d)}>
                Revoke
              </Button>
            )}
          </li>
        ))}
      </ul>
      <ErrorNote error={error} />
    </section>
  );
}

/** The user's own fingerprint, with a link to their public profile. */
export function MyKey() {
  const { identity } = useDrive();
  const info = useLoad(identity?.ensName ? (c) => c.lookupKey(identity.ensName!) : null, [identity?.ensName]);
  if (!identity?.ensName) return null;
  return (
    <section className="rounded-lg border border-line bg-card p-5 text-sm">
      <h2 className="font-medium">Your public key</h2>
      <p className="mt-1 text-muted">
        Anyone sharing with {identity.ensName} encrypts to this key. Its history is public on Arkiv, so a swapped key would show.
      </p>
      {info.loading && !info.data && <Skeleton rows={1} />}
      <ErrorNote error={info.error} />
      {info.data && <FingerprintWords words={info.data.fingerprint} className="mt-3" />}
      <Link className="mt-3 inline-block underline" href={`/u/?n=${encodeURIComponent(identity.ensName)}`}>
        Open your public profile
      </Link>
    </section>
  );
}

/** Links another ENS name the connected wallet owns (e.g. priya.acme.eth), so team shares can reach it. */
export function LinkName() {
  const { client, identity } = useDrive();
  const { address } = useAccount();
  const { mutateAsync } = useSignTypedData();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  if (!client || !identity) return null;
  return (
    <section className="rounded-lg border border-line bg-card p-5 text-sm">
      <h2 className="font-medium">Link another ENS name</h2>
      <p className="mt-1 text-muted">
        If your team gives you a name like you.team.eth, link it here so folders shared with &quot;everyone at team.eth&quot; reach you.
        The wallet that owns that name signs one entry in its public key log. Nothing else changes.
      </p>
      {!address ? (
        <p className="mt-3 text-muted">Connect the wallet that owns the name first (from the sign-in page).</p>
      ) : (
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            setError(null);
            setDone(null);
            try {
              const n = name.trim().toLowerCase();
              const info = await client.linkName(n, (td) => mutateAsync(td as never));
              setDone(`${info.ensName} now points at your key (${info.fingerprint.join(" ")}).`);
            } catch (err) {
              setError(err);
            } finally {
              setPending(false);
            }
          }}
        >
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="you.team.eth" autoCapitalize="none" spellCheck={false} required />
          <Button type="submit" variant="primary" pending={pending}>
            Link name
          </Button>
        </form>
      )}
      {done && <p className="mt-2 text-private">{done}</p>}
      <ErrorNote error={error} className="mt-2" />
    </section>
  );
}

/** "Keep keys in the extension": this site stops storing the seed and asks the extension, which checks the page first. */
export function KeysInExtension() {
  const { profile } = useDrive();
  const [present, setPresent] = useState<boolean | null>(null);
  const [on, setOn] = useState(false);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    setOn(keysInExtension());
    void extensionPresent().then(setPresent);
  }, []);
  if (profile !== "me") return null;
  return (
    <section className="rounded-lg border border-line bg-card p-5 text-sm">
      <h2 className="font-medium">Verified page before keys</h2>
      {present === false ? (
        <p className="mt-1 text-muted">
          Install the extension to verify this page before using your keys. It checks every file this site loads against the
          published, open-source release, and won&apos;t hand your keys to a page that was changed.
        </p>
      ) : (
        <>
          <p className="mt-1 text-muted">
            With this on, this website never stores your keys. Each time it opens, the extension compares the page&apos;s code with
            the published release and only then hands the keys over. Connect the extension (below) first.
          </p>
          <label className="mt-3 flex items-center gap-2">
            <input
              type="checkbox"
              className="accent-ink"
              checked={on}
              disabled={pending || present === null}
              onChange={async (e) => {
                setPending(true);
                try {
                  await setKeysInExtension(e.target.checked);
                  setOn(e.target.checked);
                } finally {
                  setPending(false);
                }
              }}
            />
            Keep my keys in the extension
          </label>
        </>
      )}
    </section>
  );
}
