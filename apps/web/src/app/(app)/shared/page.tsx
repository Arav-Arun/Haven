"use client";

import { EmptyState, ErrorNote, IncomingTickets, Skeleton, useNow } from "@cloakroom/ui";
import { Inbox } from "lucide-react";
import { useRouter } from "next/navigation";
import { RequireIdentity } from "@/components/Gate";
import { useLoad } from "@/lib/drive";

function Shared() {
  const router = useRouter();
  const now = useNow(1000);
  const shares = useLoad((c) => c.sharedWithMe(), []);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Shared with me</h1>
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
