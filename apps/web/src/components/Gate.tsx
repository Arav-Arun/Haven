"use client";

import type { HavenClient } from "@haven/core";
import type { Identity } from "@haven/types";
import { EmptyState, FxLabel, Skeleton } from "@haven/ui";
import { KeyRound, Plug, ShieldAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useDrive } from "@/lib/drive";

/** Says plainly why there's no client, instead of showing anything made up. */
export function ClientUnavailable({ reason }: { reason: string }) {
  return (
    <EmptyState icon={<Plug size={22} />} title="Not connected to Haven yet">
      <p>{reason}</p>
    </EmptyState>
  );
}

/** Renders children with a client, or explains why it can't. */
export function RequireClient({ children }: { children: (client: HavenClient) => ReactNode }) {
  const { client, unavailable, restoring } = useDrive();
  if (restoring) return <Skeleton />;
  if (!client) return <ClientUnavailable reason={unavailable ?? "No client."} />;
  return <>{children(client)}</>;
}

/** Renders children for a signed-in user, or points to sign-in. */
export function RequireIdentity({ children }: { children: (client: HavenClient, identity: Identity) => ReactNode }) {
  const { client, unavailable, restoring, identity, custodyProblem } = useDrive();
  if (restoring) return <Skeleton />;
  if (!client) return <ClientUnavailable reason={unavailable ?? "No client."} />;
  if (!identity && custodyProblem)
    return (
      <EmptyState icon={<ShieldAlert size={22} />} title="Your keys stayed in the extension">
        <p>{custodyProblem}</p>
        <p>
          The extension gives your keys only to a page whose code matches a published Haven release. Check the extension&apos;s
          toolbar icon for details.
        </p>
      </EmptyState>
    );
  if (!identity)
    return (
      <EmptyState icon={<KeyRound size={22} />} title="Sign in to see your files">
        <p>Your keys are made on this device from a wallet signature or a passkey. Nothing to install.</p>
        <Link href="/onboarding" className="btn-action fx inline-flex rounded-full px-4.5 py-2 text-sm font-semibold">
          <FxLabel>Sign in</FxLabel>
        </Link>
      </EmptyState>
    );
  return <>{children(client, identity)}</>;
}
