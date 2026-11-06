"use client";

import { EmptyState, ErrorNote, IncomingTickets, Skeleton, useNow } from "@haven/ui";
import { Inbox } from "lucide-react";
import type { Address } from "@haven/types";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { RequireIdentity } from "@/components/Gate";
import { useDrive, useLoad } from "@/lib/drive";

/** Brand-new shares ring no doorbell you already listen to, so the Arkiv scan is repeated this often. */
const NEW_SHARE_POLL_MS = 30_000;

function Shared() {
  const router = useRouter();
  const now = useNow(1000);
  const { client } = useDrive();
  const shares = useLoad((c) => c.sharedWithMe(), []);
  const reload = useRef(shares.reload);
  reload.current = shares.reload;
  // Add-on F4: rooms already shared with you update within seconds through their doorbells.
  const rooms = (shares.data ?? []).map((s) => s.folder.registry).sort().join(",");
  useEffect(() => {
    if (!client) return;
    const folders = rooms ? (rooms.split(",") as Address[]) : [];
    const off = folders.length ? client.subscribe(folders, () => reload.current()) : () => undefined;
    const timer = setInterval(() => reload.current(), NEW_SHARE_POLL_MS);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [client, rooms]);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-[-0.035em]">Shared with me</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Your tickets. Each one is held by a random address only you can link to your name.
        </p>
      </div>
      {shares.loading && !shares.data && <Skeleton />}
      <ErrorNote error={shares.error} />
      {shares.data?.length === 0 && (
        <EmptyState icon={<Inbox size={22} />} title="Nothing shared with you yet">
          <p>When someone shares a folder with your name, it shows up here.</p>
        </EmptyState>
      )}
      {shares.data && shares.data.length > 0 && (
        <IncomingTickets shares={shares.data} now={now} onOpen={(s) => router.push(`/drive?f=${s.folder.registry}`)} />
      )}
    </div>
  );
}

export default function SharedPage() {
  return <RequireIdentity>{() => <Shared />}</RequireIdentity>;
}
