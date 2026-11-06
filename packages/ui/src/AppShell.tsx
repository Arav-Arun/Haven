"use client";

import type { ComponentType, ReactNode } from "react";
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

export function Wordmark({ className }: { className?: string }) {
  return <span className={cx("font-display text-2xl font-bold uppercase leading-none tracking-wide", className)}>Haven</span>;
}

/** Sidebar on desktop, bottom tabs on phones. `status` is the network badge; `account` the signed-in name. */
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
    <div className="min-h-dvh md:grid md:grid-cols-[232px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:bg-card focus:p-2">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-line px-4 py-5 md:flex">
        <Link href="/drive" className="px-2">
          <Wordmark />
        </Link>
        <nav aria-label="Main" className="flex flex-col gap-0.5">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={n.active ? "page" : undefined}
              className={cx(
                "flex items-center gap-3 rounded-md px-2 py-2 text-sm",
                n.active ? "bg-ink text-paper" : "text-ink/80 hover:bg-line/60 hover:text-ink",
              )}
            >
              {n.icon}
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex flex-col items-start gap-3 px-2 text-sm">
          {account}
          {status}
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-paper/95 px-4 py-3 backdrop-blur md:hidden">
          <Link href="/drive">
            <Wordmark className="text-xl" />
          </Link>
          <div className="flex min-w-0 items-center gap-2">
            {status}
            {actions}
          </div>
        </header>
        <div className="hidden items-center justify-end gap-2 px-8 pt-5 md:flex">{actions}</div>
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-4 md:px-8 md:pb-12">
          {children}
        </main>
      </div>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {nav
          .filter((n) => n.primary)
          .slice(0, 5)
          .map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={n.active ? "page" : undefined}
              className={cx("flex flex-col items-center gap-1 py-2 text-[11px]", n.active ? "text-ink" : "text-muted")}
            >
              {n.icon}
              {n.label}
            </Link>
          ))}
      </nav>
    </div>
  );
}
