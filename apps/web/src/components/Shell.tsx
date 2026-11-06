"use client";

import { AppShell, ReceiptsDrawer, useNow, type NavItem } from "@haven/ui";
import { DoorClosed, HardDrive, Inbox, ReceiptText, Settings, UsersRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { config } from "@/lib/config";
import { useDrive } from "@/lib/drive";
import { NetworkBadge } from "./NetworkBadge";

const NAV: Omit<NavItem, "active">[] = [
  { href: "/drive", label: "My drive", icon: <HardDrive size={20} aria-hidden />, primary: true },
  { href: "/rooms", label: "Rooms", icon: <DoorClosed size={20} aria-hidden />, primary: true },
  { href: "/shared", label: "Shared", icon: <Inbox size={20} aria-hidden />, primary: true },
  { href: "/groups", label: "Groups", icon: <UsersRound size={20} aria-hidden />, primary: true },
  { href: "/settings", label: "Settings", icon: <Settings size={20} aria-hidden />, primary: true },
];

/** Shown on every screen while a "Try it" persona is active, so no one mistakes whose keys are in use. */
function PersonaBar() {
  const { profile, setProfile, identity } = useDrive();
  if (profile === "me") return null;
  const other = profile === "founder" ? "investor" : "founder";
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md bg-ink px-3 py-2 text-sm text-paper">
      <span>
        Try it: you&apos;re the {profile}
        {identity?.ensName ? ` (${identity.ensName})` : ""}.
      </span>
      <span className="flex gap-3">
        <button className="underline" onClick={() => setProfile(other)}>
          Switch to the {other}
        </button>
        <button className="underline" onClick={() => setProfile("me")}>
          Leave
        </button>
      </span>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { identity, receipts } = useDrive();
  const [open, setOpen] = useState(false);
  const now = useNow(5000);
  const pending = receipts.some((r) => !r.done);
  return (
    <AppShell
      nav={NAV.map((n) => ({ ...n, active: path === n.href || path.startsWith(`${n.href}/`) }))}
      Link={Link}
      status={<NetworkBadge compact />}
      account={
        identity && (
          <span className="truncate" title={identity.driveKey}>
            {identity.ensName ?? "No name yet"}
          </span>
        )
      }
      actions={
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-ink/80 hover:bg-line/60"
          aria-label={`Receipts${pending ? ", an action is in progress" : ""}`}
        >
          <ReceiptText size={18} aria-hidden />
          <span className="hidden sm:inline">Receipts</span>
          {pending && <span className="h-2 w-2 animate-pulse rounded-full bg-private" aria-hidden />}
        </button>
      }
    >
      {config.demoMode && (
        <p className="mb-4 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">Test network, 1-minute access windows.</p>
      )}
      <PersonaBar />
      {children}
      <ReceiptsDrawer open={open} onClose={() => setOpen(false)} receipts={receipts} now={now} />
    </AppShell>
  );
}
