"use client";

import type { FileEntry, Member, PublicView, Timestamp } from "@haven/types";
import { ExternalLink, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { formatBytes, formatDate, formatUntil, ROLE_LABEL, shortAddress } from "./format";

function Column({ title, about, children }: { title: string; about: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 surface rounded-2xl p-4">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-muted">{about}</p>
      </div>
      {children}
    </section>
  );
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 underline decoration-line underline-offset-2 hover:decoration-action">
      {children}
      <ExternalLink size={12} aria-hidden />
    </a>
  );
}

/**
 * The same folder twice: what anyone can read from Sepolia, Arkiv and Swarm, next to what you see with your keys.
 * Everything on the left comes from `publicView`, which reads the public chains, not your keys.
 */
export function PublicViewPanel({
  view,
  mine,
  now,
  addressUrl,
}: {
  view: PublicView;
  mine: { members: Member[]; files: FileEntry[] } | null;
  now: Timestamp;
  addressUrl: (address: string) => string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-lg">{view.summary}</p>

      {view.directCalls.length > 0 && (
        <div role="alert" className="flex gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">Some traffic for this view didn&apos;t go through the private network:</p>
            <ul className="list-disc pl-5">
              {view.directCalls.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Column title="What anyone can see" about="Read from the public chains. No keys involved.">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted">Name</dt>
            <dd className="truncate">{view.ensName}</dd>
            <dt className="text-muted">Owner</dt>
            <dd>{view.ownerVisible ? "Visible from the name" : "Not visible: this is an unlinked room"}</dd>
            <dt className="text-muted">Registry</dt>
            <dd>
              <Ext href={addressUrl(view.folder)}>{shortAddress(view.folder)}</Ext>
            </dd>
          </dl>

          <h3 className="mt-2 text-sm font-medium">Members ({view.members.length})</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {view.members.map((m) => (
              <li key={m.address} className="flex flex-wrap justify-between gap-x-3">
                <Ext href={addressUrl(m.address)}>{shortAddress(m.address)}</Ext>
                <span className="text-muted">
                  {m.roles.map((r) => ROLE_LABEL[r]).join(", ")}, {m.until === null ? "no end date" : `until ${formatDate(m.until)}`}
                </span>
              </li>
            ))}
          </ul>

          <h3 className="mt-2 text-sm font-medium">Arkiv records ({view.arkiv.length})</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {view.arkiv.map((a) => (
              <li key={a.key} className="flex flex-wrap justify-between gap-x-3">
                <Ext href={a.explorerUrl}>{a.schema}</Ext>
                <span className="text-muted">
                  {formatBytes(a.bytes)} of ciphertext from {shortAddress(a.owner)}, kept until {formatDate(a.expiresAt)}
                </span>
              </li>
            ))}
          </ul>

          <h3 className="mt-2 text-sm font-medium">Swarm chunks ({view.swarm.length})</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {view.swarm.map((s) => (
              <li key={s.ref} className="flex justify-between gap-3">
                <span className="truncate" title={s.ref}>
                  {shortAddress(s.ref)}
                </span>
                <span className="shrink-0 text-muted">{formatBytes(s.paddedBytes)} padded</span>
              </li>
            ))}
          </ul>

          {view.ignoredWrites > 0 && (
            <p className="text-sm text-muted">
              {view.ignoredWrites} record{view.ignoredWrites === 1 ? " was" : "s were"} written here by addresses without access.
              Haven ignores them.
            </p>
          )}
        </Column>

        <Column title="What you see" about="The same records, opened with your keys on this device.">
          {mine ? (
            <>
              <h3 className="text-sm font-medium">Members ({mine.members.length})</h3>
              <ul className="flex flex-col gap-1 text-sm">
                {mine.members.map((m) => (
                  <li key={m.address} className="flex flex-wrap justify-between gap-x-3">
                    <span>
                      {m.label} <span className="text-muted">({shortAddress(m.address)})</span>
                    </span>
                    <span className="text-muted">
                      {ROLE_LABEL[m.role]}, {formatUntil(m.until, now).toLowerCase()}
                    </span>
                  </li>
                ))}
              </ul>
              <h3 className="mt-2 text-sm font-medium">Files ({mine.files.length})</h3>
              <ul className="flex flex-col gap-1 text-sm">
                {mine.files.map((f) => (
                  <li key={f.fileId} className="flex justify-between gap-3">
                    <span className="truncate">{f.readable ? f.name : "Locked file"}</span>
                    <span className="shrink-0 text-muted">{f.size !== null ? formatBytes(f.size) : "size hidden"}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted">Sign in with access to this folder to compare.</p>
          )}
        </Column>
      </div>
    </div>
  );
}
