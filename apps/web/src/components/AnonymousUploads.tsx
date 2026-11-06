"use client";

// Add-on Z1: anonymous uploads. A writer joins the folder's writer group once (relayed, no gas); after that each upload
// can carry a zero-knowledge proof that it came from one of the folder's writers instead of the writer's signature.

import type { FileProof, HavenClient } from "@haven/core";
import type { Address, FileEntry } from "@haven/types";
import { Button, Dialog, ErrorNote, Skeleton } from "@haven/ui";
import { ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLoad } from "@/lib/drive";

/**
 * On by default: a writer joins the folder's writer group by itself the first time it opens the folder (relayed, no
 * gas), and uploads are anonymous once there are enough writers to hide among. Until then they're signed, and this
 * says so. `onReady` reports whether the next upload can be anonymous.
 */
export function AnonymousUploads({
  client,
  folder,
  on,
  onChange,
  onReady,
}: {
  client: HavenClient;
  folder: Address;
  on: boolean;
  onChange: (on: boolean) => void;
  onReady: (ready: boolean) => void;
}) {
  const state = useLoad((c) => c.anonymousWriters(folder), [folder]);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const tried = useRef<string | null>(null);
  const s = state.data;
  const ready = !!s && s.canJoin && s.joined && s.writers >= s.minimum;

  useEffect(() => onReady(ready), [ready, onReady]);

  // Join once per folder, without asking: it's what "on by default" means.
  useEffect(() => {
    if (!s || !s.canJoin || s.joined || tried.current === folder) return;
    tried.current = folder;
    setJoining(true);
    client
      .joinAnonymousWriters(folder)
      .then(() => state.reload(), setError)
      .finally(() => setJoining(false));
  }, [s, folder, client, state]);

  if (!s || !s.canJoin) return null;
  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-line bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <ShieldCheck size={20} className={`mt-0.5 shrink-0 ${ready && on ? "text-private" : "text-ink/60"}`} aria-hidden />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{ready && on ? "Anonymous uploads are on" : "Anonymous uploads"}</h2>
            <p className="text-sm text-muted">
              {joining && "Joining this folder's writer group (no gas needed)…"}
              {!joining && !s.joined && "Couldn't join the writer group yet; uploads are signed for now."}
              {!joining &&
                s.joined &&
                !ready &&
                `On. Uploads are signed until ${s.minimum} writers have joined (${s.writers} so far), so there's someone to hide among.`}
              {ready && on && `Your uploads could be from any of the ${s.writers} writers. Nobody can tell which, not even the owner or Haven.`}
              {ready && !on && "Off. Your uploads are signed by your member address."}
            </p>
          </div>
        </div>
        {ready && (
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input type="checkbox" className="size-4 accent-current" checked={on} onChange={(e) => onChange(e.target.checked)} />
            Anonymous
          </label>
        )}
      </div>
      <ErrorNote error={error ?? state.error} />
    </section>
  );
}

/** What an anonymous file's proof showed, and what it doesn't reveal. */
export function ProofDialog({ client, file, onClose }: { client: HavenClient; file: FileEntry; onClose: () => void }) {
  const proof = useLoad((c) => c.fileProof(file), [file.arkivKey]);
  const p: FileProof | null = proof.data;
  return (
    <Dialog open onClose={onClose} title="Zero-knowledge proof">
      {proof.loading && !p && <Skeleton rows={3} />}
      <ErrorNote error={proof.error} />
      {p && (
        <div className="flex flex-col gap-3 text-sm">
          <p>
            This entry proves it was written by one of the <strong>{p.writers}</strong> writers of this folder at the time.
            It carries no signature, so nobody can tell which one: not other members, the owner, Haven or anyone reading
            Arkiv.{p.mine && " You wrote it: only you can tell, from the proof's nullifier."}
          </p>
          <p className="text-muted">
            Your app checked it just now: a Semaphore (Groth16) proof against the writer group rebuilt from Arkiv and the
            folder&apos;s onchain access history, bound to this entry&apos;s fields.
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs">
            <dt className="text-muted">Group root</dt>
            <dd className="break-all">{p.root}</dd>
            <dt className="text-muted">Nullifier</dt>
            <dd className="break-all">{p.nullifier}</dd>
            <dt className="text-muted">Arkiv entry</dt>
            <dd className="break-all">{p.arkivKey}</dd>
          </dl>
        </div>
      )}
      <div className="flex justify-end">
        <Button variant="quiet" onClick={onClose}>
          Close
        </Button>
      </div>
    </Dialog>
  );
}
