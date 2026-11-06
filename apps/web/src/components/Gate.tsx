"use client";

import type { CloakroomClient } from "@cloakroom/core";
import type { Identity } from "@cloakroom/types";
import { EmptyState, Skeleton } from "@cloakroom/ui";
import { KeyRound, Plug, ShieldAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useDrive } from "@/lib/drive";

/** Says plainly why there's no client, instead of showing anything made up. */
export function ClientUnavailable({ reason }: { reason: string }) {
  return (
    <EmptyState icon={<Plug size={22} />} title="Not connected to Cloakroom yet">
      <p>{reason}</p>
    </EmptyState>
  );
}

/** Renders children with a client, or explains why it can't. */
export function RequireClient({ children }: { children: (client: CloakroomClient) => ReactNode }) {
  const { client, unavailable, restoring } = useDrive();
  if (restoring) return <Skeleton />;
  if (!client) return <ClientUnavailable reason={unavailable ?? "No client."} />;
  return <>{children(client)}</>;
}

/** Renders children for a signed-in user, or points to sign-in. */
export function RequireIdentity({ children }: { children: (client: CloakroomClient, identity: Identity) => ReactNode }) {
  const { client, unavailable, restoring, identity, custodyProblem } = useDrive();
  if (restoring) return <Skeleton />;
  if (!client) return <ClientUnavailable reason={unavailable ?? "No client."} />;
  if (!identity && custodyProblem)
    return (
      <EmptyState icon={<ShieldAlert size={22} />} title="Your keys stayed in the extension">
        <p>{custodyProblem}</p>
        <p>
          The extension gives your keys only to a page whose code matches a published Cloakroom release. Check the extension&apos;s
          toolbar icon for details.
        </p>
      </EmptyState>
    );
  if (!identity)
    return (
      <EmptyState icon={<KeyRound size={22} />} title="Sign in to see your files">
        <p>Your keys are made on this device from a wallet signature or a passkey. Nothing to install.</p>
        <Link href="/onboarding" className="rounded-md bg-ink px-3.5 py-2 font-medium text-paper">
          Sign in
        </Link>
      </EmptyState>
    );
  return <>{children(client, identity)}</>;
}
