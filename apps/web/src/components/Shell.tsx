"use client";

import { AppShell, FxLabel, ReceiptsDrawer, useNow, type NavItem } from "@haven/ui";
import { DoorClosed, HardDrive, Inbox, ReceiptText, Settings, UsersRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { PERSONA, useDrive } from "@/lib/drive";
import { useSignOut } from "@/lib/signout";
import { NetworkBadge } from "./NetworkBadge";

const NAV: Omit<NavItem, "active">[] = [
  { href: "/drive", label: "My drive", icon: <HardDrive size={20} aria-hidden />, primary: true },
  { href: "/rooms", label: "Rooms", icon: <DoorClosed size={20} aria-hidden />, primary: true },
  { href: "/shared", label: "Shared", icon: <Inbox size={20} aria-hidden />, primary: true },
  { href: "/groups", label: "Groups", icon: <UsersRound size={20} aria-hidden />, primary: true },
  { href: "/settings", label: "Settings", icon: <Settings size={20} aria-hidden />, primary: true },
];

/** Leaving: a door with an arrow into its frame, in red line art. */
function LeaveIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 3.5l6 2v14l-6 2z" />
      <path d="M13 5.5h4v13h-4" />
      <path d="M22 12h-6.5M18.5 9l-3 3 3 3" />
    </svg>
  );
}

/** The small sign-out button at the bottom right of the menu, beside the name. */
function SignOutButton() {
  const signOut = useSignOut();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        setBusy(true);
        try {
          await signOut();
        } finally {
          setBusy(false);
        }
      }}
      disabled={busy}
      aria-label="Sign out of this device"
      title="Sign out of this device"
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-danger transition-colors hover:bg-danger-soft disabled:opacity-50"
    >
      <LeaveIcon />
    </button>
  );
}

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
      signOut={identity && <SignOutButton />}
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
