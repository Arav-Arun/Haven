"use client";

import { useId, type ComponentType, type ReactNode } from "react";
import { CloudBank } from "./Clouds";
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
    <div className="relative isolate min-h-dvh md:grid md:grid-cols-[232px_1fr]">
      <CloudBank className="-z-10" />
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-card focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh flex-col gap-7 border-r border-white/70 bg-white/45 px-4 py-6 backdrop-blur-xl md:flex">
        <Link href="/drive" className="px-2">
          <Wordmark />
        </Link>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={n.active ? "page" : undefined}
              className={cx(
                "flex items-center gap-3 rounded-full px-3 py-2.5 text-sm font-medium transition-colors",
                n.active
                  ? "bg-white text-action shadow-[0_1px_2px_rgb(13_27_51/0.05),0_10px_24px_-14px_rgb(28_64_140/0.45)]"
                  : "text-ink/70 hover:bg-white/70 hover:text-ink",
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
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-white/80 bg-white/75 px-4 py-3 backdrop-blur-xl md:hidden">
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
