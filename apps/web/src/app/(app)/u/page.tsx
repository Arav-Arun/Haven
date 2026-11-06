"use client";

import type { DriveClient } from "@cloakroom/types";
import { EmptyState, ErrorNote, Fingerprint, KeyHistory, Skeleton, useNow, VerifyInPerson } from "@cloakroom/ui";
import { KeyRound, ShieldCheck, TriangleAlert } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";
import { ClientUnavailable, RequireClient } from "@/components/Gate";
import { MyDevices } from "@/components/MyDevices";
import { useDrive, useLoad } from "@/lib/drive";
import { KEYDIR_MISSING, keyDir } from "@/lib/keydir";

/** Anyone's public key page: the fingerprint, the key log from Arkiv, and how to check it in person. */
function Profile({ client, ensName }: { client: DriveClient; ensName: string }) {
  const { identity } = useDrive();
  const now = useNow(30_000);
  const keys = useMemo(() => keyDir(client), [client]);
  const info = useLoad(keys.lookupKey ? () => keys.lookupKey!(ensName) : null, [keys, ensName]);
  const mine = identity?.ensName === ensName;

  if (!keys.lookupKey) return <ClientUnavailable reason={KEYDIR_MISSING} />;
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="break-all text-2xl font-semibold tracking-tight">{ensName}</h1>
        <p className="mt-1 text-sm text-muted">
          This name&apos;s public key, read live from its log on Arkiv. Any app can read the same log.
        </p>
      </div>
      {info.loading && !info.data && <Skeleton rows={4} />}
      <ErrorNote error={info.error} />
      {info.data && (
        <>
          <section className="flex flex-col gap-3 rounded-lg border border-line bg-card p-5">
            <h2 className="font-medium">Key fingerprint</h2>
            <Fingerprint words={info.data.fingerprint} />
            {info.data.matchesEns ? (
              <p className="inline-flex items-center gap-1.5 text-sm text-private">
                <ShieldCheck size={14} aria-hidden /> The log agrees with the key on the ENS name.
              </p>
            ) : (
              <p role="alert" className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
                The key on the ENS name doesn&apos;t match this log. Don&apos;t share with this name until its owner fixes it.
              </p>
            )}
            {!mine && info.data.changedSinceLastShare && (
              <p className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
                This key changed since you last shared with {ensName}. Check the words with them before sharing again.
              </p>
            )}
          </section>

          <section className="flex flex-col gap-3 rounded-lg border border-line bg-card p-5">
            <h2 className="font-medium">Verify in person</h2>
            <VerifyInPerson ensName={ensName} words={info.data.fingerprint} />
          </section>

          <section className="flex flex-col gap-3 rounded-lg border border-line bg-card p-5">
            <h2 className="font-medium">Key history</h2>
            <KeyHistory history={info.data.history} ignoredEntries={info.data.ignoredEntries ?? 0} now={now} />
          </section>
        </>
      )}
      {mine && (
        <section className="flex flex-col gap-3 rounded-lg border border-line bg-card p-5">
          <h2 className="font-medium">Your devices</h2>
          <p className="text-sm text-muted">Only you see this list&apos;s names; others see only that a device exists.</p>
          <MyDevices client={client} />
        </section>
      )}
    </div>
  );
}

function ProfilePage() {
  const { identity } = useDrive();
  const ensName = (useSearchParams().get("n") ?? identity?.ensName ?? "").trim().toLowerCase();
  if (!ensName)
    return (
      <EmptyState icon={<KeyRound size={22} />} title="Whose key?">
        <p>Open a name&apos;s key page from the share dialog, or claim your own name to get one.</p>
      </EmptyState>
    );
  return <RequireClient>{(client) => <Profile client={client} ensName={ensName} />}</RequireClient>;
}

export default function Page() {
  return (
    <Suspense fallback={<Skeleton />}>
      <ProfilePage />
    </Suspense>
  );
}
