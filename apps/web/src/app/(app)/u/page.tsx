"use client";

import type { KeyInfo } from "@haven/core";
import { Button, EmptyState, ErrorNote, FingerprintWords, Skeleton, formatDate, inputClass, shortAddress, useNow } from "@haven/ui";
import { BadgeCheck, CircleSlash, KeyRound, ShieldAlert, UserRound } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { RequireClient } from "@/components/Gate";
import { Devices } from "@/components/KeyDirectory";
import { config } from "@/lib/config";
import { useDrive, useLoad } from "@/lib/drive";

const ARKIV_EXPLORER = "https://rabdi.explorer.arkiv.network";

const KIND: Record<KeyInfo["history"][number]["kind"], string> = {
  publish: "Key published",
  rotate: "Key changed",
  "revoke-device": "A device revoked",
};

/** Add-on F1: the panel two people use to check each other's key face to face. */
function VerifyInPerson({ info }: { info: KeyInfo }) {
  return (
    <section className="surface rounded-2xl p-5 text-sm">
      <h2 className="font-medium">Verify in person</h2>
      <p className="mt-1 text-muted">
        Ask {info.ensName} to open their own profile and read these eight words aloud. If every word matches, files you share
        reach them and no one else. Any app that reads the public log shows the same words.
      </p>
      <FingerprintWords words={info.fingerprint} className="mt-3 text-base" />
    </section>
  );
}

function Profile({ name }: { name: string }) {
  const { identity } = useDrive();
  const now = useNow(10_000);
  const info = useLoad((c) => c.lookupKey(name), [name]);
  const own = identity?.ensName === name;
  if (info.loading && !info.data) return <Skeleton rows={5} />;
  if (info.error) return <ErrorNote error={info.error} />;
  const k = info.data;
  if (!k) return null;
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-[-0.035em]">{k.ensName}</h1>
        {k.problem ? (
          <p className="inline-flex items-center gap-1.5 text-sm text-danger">
            <ShieldAlert size={16} aria-hidden /> The public key log is broken: {k.problem}. Nothing can be shared with this name.
          </p>
        ) : !k.current ? (
          <p className="inline-flex items-center gap-1.5 text-sm text-muted">
            <CircleSlash size={16} aria-hidden /> No public key log yet: this name hasn&apos;t set up Haven.
          </p>
        ) : !k.matchesEns ? (
          <p className="inline-flex items-center gap-1.5 text-sm text-danger">
            <ShieldAlert size={16} aria-hidden /> This name&apos;s key doesn&apos;t match its public log.
          </p>
        ) : (
          <p className="inline-flex items-center gap-1.5 text-sm text-private">
            <BadgeCheck size={16} aria-hidden />
            {k.ensRecord === "match" ? "Its haven.key record matches its public log." : "Signed by the name's owner; this name has no haven.key record."}
          </p>
        )}
        {k.controller && (
          <p className="text-xs text-muted">
            Entries count only when signed by{" "}
            <a className="underline" href={`${config.explorerUrl}/address/${k.controller}`} target="_blank" rel="noreferrer noopener">
              {shortAddress(k.controller)}
            </a>
            , who controls this name now.
          </p>
        )}
      </header>

      {k.current && <VerifyInPerson info={k} />}

      <section className="surface rounded-2xl p-5 text-sm">
        <h2 className="font-medium">Key history</h2>
        <p className="mt-1 text-muted">An append-only log on Arkiv. Anyone can read it with one query, and every change shows here.</p>
        {k.history.length === 0 && <p className="mt-3 text-muted">No entries.</p>}
        <ol className="mt-3 flex flex-col gap-3 border-l border-line pl-4">
          {k.history.map((e) => (
            <li key={e.arkivKey} className="relative">
              <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-ink" aria-hidden />
              <p className="font-medium">
                {KIND[e.kind]} <span className="text-muted">(seq {e.seq})</span>
              </p>
              <p className="text-xs text-muted">
                {e.at ? formatDate(e.at) : "time unknown"},{" "}
                <a className="underline" href={`${ARKIV_EXPLORER}/entity/${e.arkivKey}`} target="_blank" rel="noreferrer noopener">
                  {shortAddress(e.arkivKey)}
                </a>
              </p>
            </li>
          ))}
        </ol>
      </section>

      {k.ignored.length > 0 && (
        <section className="rounded-2xl border border-danger/40 bg-danger-soft p-5 text-sm text-danger">
          <h2 className="font-medium">Ignored: {k.ignored.length} forged {k.ignored.length === 1 ? "entry" : "entries"}</h2>
          <p className="mt-1">Written about this name by someone who doesn&apos;t control it, so no app should use them.</p>
          <ul className="mt-2 flex flex-col gap-1 text-xs">
            {k.ignored.map((x) => (
              <li key={x.arkivKey}>
                seq {x.seq} by{" "}
                <a className="underline" href={`${ARKIV_EXPLORER}/entity/${x.arkivKey}`} target="_blank" rel="noreferrer noopener">
                  {shortAddress(x.creator)}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {own && <Devices now={now} />}
    </div>
  );
}

function Lookup() {
  const router = useRouter();
  const [name, setName] = useState("");
  return (
    <EmptyState icon={<UserRound size={22} />} title="Look up a name's key">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) router.push(`/u/?n=${encodeURIComponent(name.trim().toLowerCase())}`);
        }}
      >
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="name.eth" autoCapitalize="none" spellCheck={false} />
        <Button type="submit" variant="primary">
          <KeyRound size={16} aria-hidden /> Look up
        </Button>
      </form>
    </EmptyState>
  );
}

function ProfilePage() {
  const n = useSearchParams().get("n");
  return <RequireClient>{() => (n ? <Profile name={n.toLowerCase()} /> : <Lookup />)}</RequireClient>;
}

export default function Page() {
  return (
    <Suspense fallback={<Skeleton />}>
      <ProfilePage />
    </Suspense>
  );
}
