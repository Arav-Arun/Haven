"use client";

import { AppShell, FxLabel, ReceiptsDrawer, useNow, type NavItem } from "@haven/ui";
import { DoorClosed, HardDrive, Inbox, ReceiptText, Settings, UsersRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { config } from "@/lib/config";
import { PERSONA, useDrive } from "@/lib/drive";
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
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-ink px-4 py-2.5 text-sm text-white shadow-[0_14px_30px_-18px_rgb(13_27_51/0.6)]">
      <span>
        Try it: you&apos;re the {PERSONA[profile].name}
        {identity?.ensName ? ` (${identity.ensName})` : ""}.
      </span>
      <span className="flex gap-3">
        <button className="underline" onClick={() => setProfile(other)}>
          Switch to the {PERSONA[other].name}
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
  const who = identity && (
    <span className="truncate font-medium" title={identity.driveKey}>
      {identity.ensName ?? "No name yet"}
    </span>
  );
  return (
    <AppShell
      nav={NAV.map((n) => ({ ...n, active: path === n.href || path.startsWith(`${n.href}/`) }))}
      Link={Link}
      status={null}
      account={who}
      actions={
        <button
          onClick={() => setOpen(true)}
          className="btn-clay fx inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold"
          aria-label={`Receipts${pending ? ", an action is in progress" : ""}`}
        >
          <FxLabel>
            <ReceiptText size={18} aria-hidden />
            <span className="hidden sm:inline">Receipts</span>
            {pending && <span className="h-2 w-2 animate-pulse rounded-full bg-private" aria-hidden />}
          </FxLabel>
        </button>
      }
    >
      {config.demoMode && (
        <p className="mb-4 rounded-2xl border border-white/80 bg-white/60 px-4 py-2.5 text-sm text-muted backdrop-blur">Test network, 1-minute access windows.</p>
      )}
      <PersonaBar />
      {children}
      <ReceiptsDrawer
        open={open}
        onClose={() => setOpen(false)}
        receipts={receipts}
        now={now}
        footer={
          <>
            {who}
            <NetworkBadge compact />
          </>
        }
      />
    </AppShell>
  );
}
