"use client";

import { useId, type ComponentType, type ReactNode } from "react";
import { CloudBank } from "./Clouds";
import { KineticMenu } from "./KineticMenu";
import { cx } from "./format";

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  /** Shown in the phone's bottom tabs as well as the sidebar. */
  primary?: boolean;
}

export type LinkLike = ComponentType<{ href: string; className?: string; children: ReactNode; "aria-current"?: "page" }>;

/** Haven's mark, the same as the landing page's: an arched doorway with a keyhole, on a blue tile. */
export function HavenMark({ className }: { className?: string }) {
  // useId can contain characters that break url(#...) references.
  const id = `haven${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cx("drop-shadow-[0_6px_14px_rgb(31_79_209/0.35)]", className)}>
      <defs>
        <linearGradient id={`${id}-tile`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5b93ff" />
          <stop offset="1" stopColor="#1f4fd1" />
        </linearGradient>
        <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.45" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill={`url(#${id}-tile)`} />
      <rect width="64" height="64" rx="18" fill={`url(#${id}-shine)`} />
      <path d="M17 50V30a15 15 0 0 1 30 0v20" fill="none" stroke="#fff" strokeWidth="6.5" strokeLinecap="round" />
      <circle cx="32" cy="32" r="5" fill="#fff" />
      <path d="M29.6 34.5h4.8l1.6 9.5h-8z" fill="#fff" />
    </svg>
  );
}

/** The mark and the name, as in the landing page's nav. The mark scales with the text size. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2.5 text-[21px] font-bold leading-none tracking-[-0.03em] text-ink", className)}>
      <HavenMark className="size-[1.55em] shrink-0" />
      Haven
    </span>
  );
}

/**
 * No bar and no sidebar: the logo in the top-left corner, the actions and the kinetic menu's "Menu" in the top-right,
 * the network badge (`status`) pinned to the bottom-left corner, and bottom tabs on phones (where the badge moves
 * into the menu). `account` is the signed-in name, shown in the menu.
 */
export function AppShell({
  nav,
  Link,
  status,
  account,
  actions,
  children,
}: {
  nav: NavItem[];
  Link: LinkLike;
  status: ReactNode;
  account?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative isolate min-h-dvh">
      <CloudBank className="-z-10" />
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-card focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="relative z-30 flex items-center justify-between gap-3 px-4 pt-4 sm:px-8 sm:pt-6">
        <Link href="/">
          <Wordmark className="text-xl" />
        </Link>
        <div className="flex min-w-0 items-center gap-3 sm:gap-5">
          {actions}
          <KineticMenu
              items={nav}
              Link={Link}
            footer={
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white bg-white/70 px-4 py-3 text-sm">
                {account}
                {status}
              </div>
            }
          />
        </div>
      </header>
      <div className="fixed bottom-5 left-5 z-20 hidden md:block">{status}</div>
      <main id="main" className="mx-auto w-full max-w-5xl px-4 pb-28 pt-6 md:px-8 md:pb-12">
        {children}
      </main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-white/80 bg-white/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      >
        {nav
          .filter((n) => n.primary)
          .slice(0, 5)
          .map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={n.active ? "page" : undefined}
              className={cx("flex flex-col items-center gap-1 py-2 text-[11px] font-medium", n.active ? "text-action" : "text-muted")}
            >
              {n.icon}
              {n.label}
            </Link>
          ))}
      </nav>
    </div>
  );
}
