"use client";

import type { Address } from "@cloakroom/types";
import { EmptyState, ErrorNote, PublicViewPanel, Skeleton, useNow } from "@cloakroom/ui";
import { Eye } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { RequireClient } from "@/components/Gate";
import { config } from "@/lib/config";
import { useDrive, useLoad } from "@/lib/drive";

function View({ folder }: { folder: Address }) {
  const { identity } = useDrive();
  const now = useNow(5000);
  const view = useLoad((c) => c.publicView(folder), [folder]);
  // "What you see" only for someone signed in; a failure here (no access) just leaves that side empty.
  const mine = useLoad(
    identity ? async (c) => ({ members: await c.listMembers(folder).catch(() => []), files: await c.listFiles(folder) }) : null,
    [folder, identity],
  );
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Public view</h1>
      {view.loading && !view.data && <Skeleton rows={5} />}
      <ErrorNote error={view.error} />
      {view.data && (
        <PublicViewPanel
          view={view.data}
          mine={mine.data}
          now={now}
          addressUrl={(a) => `${config.explorerUrl}/address/${a}`}
        />
      )}
    </div>
  );
}

function PublicPage() {
  const f = useSearchParams().get("f") as Address | null;
  if (!f)
    return (
      <EmptyState icon={<Eye size={22} />} title="Pick a folder">
        <p>Open a folder and choose "Public view" to see exactly what anyone can read about it.</p>
      </EmptyState>
    );
  return <RequireClient>{() => <View folder={f} />}</RequireClient>;
}

export default function Page() {
  return (
    <Suspense fallback={<Skeleton />}>
      <PublicPage />
    </Suspense>
  );
}
