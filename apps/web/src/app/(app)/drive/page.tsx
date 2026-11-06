"use client";

import type { Address } from "@cloakroom/types";
import { Skeleton } from "@cloakroom/ui";
import { HardDrive } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { FolderListPage } from "@/components/FolderListPage";
import { FolderView } from "@/components/FolderView";
import { RequireIdentity } from "@/components/Gate";
import { SharedInbox } from "@/components/SharedInbox";

// One static page for the whole drive: the folder is in ?f=, so the same build works on Vercel and from Swarm,
// which can't rewrite paths.
function Drive() {
  const router = useRouter();
  const params = useSearchParams();
  const f = params.get("f") as Address | null;
  // Set by the service worker after files are shared into the app from Android's share sheet.
  const shared = params.has("shared");
  return (
    <RequireIdentity>
      {(client) =>
        shared ? (
          <SharedInbox client={client} onDone={() => router.replace("/drive")} />
        ) : f ? (
          <FolderView key={f} client={client} folder={f} />
        ) : (
          <FolderListPage
            client={client}
            which="root"
            title="My drive"
            intro="Folders under your name. Anyone can see that they exist, never what's in them or who you shared them with."
            empty={{
              icon: <HardDrive size={22} />,
              title: "No folders yet",
              body: "Make a folder, drop files in, and share it with an ENS name.",
            }}
            action="New folder"
          />
        )
      }
    </RequireIdentity>
  );
}

export default function DrivePage() {
  return (
    <Suspense fallback={<Skeleton />}>
      <Drive />
    </Suspense>
  );
}
