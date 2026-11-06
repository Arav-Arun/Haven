"use client";

import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { CloudBank } from "./Clouds";
import { cx } from "./format";

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  /** Kept for callers; every item shows in the sidebar and the phone drawer. */
  primary?: boolean;
}

export type LinkLike = ComponentType<{ href: string; className?: string; children: ReactNode; "aria-current"?: "page" }>;

/** Haven's mark: the black shield, the same as the landing page's. */
export function HavenMark({ className }: { className?: string }) {
  // The shield, drawn from public/haven-mark.webp as a mask, so it takes the text colour (black on light, white on dark).
  return (
    <span
      aria-hidden
      className={cx("inline-block bg-current", className)}
      style={{ WebkitMask: "url(/haven-mark.webp) center / contain no-repeat", mask: "url(/haven-mark.webp) center / contain no-repeat" }}
    />
  );
}

/** The mark and the name, as in the landing page's nav. The mark scales with the text size. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2.5 text-[21px] font-bold leading-none tracking-[-0.03em] text-ink", className)}>
      <HavenMark className="size-[1.3em] shrink-0" />
      Haven
    </span>
  );
}

/** The nav list, the account and the network: the desktop sidebar and the phone drawer show the same thing. */
function NavPanel({ nav, Link, account, status, onNavigate }: { nav: NavItem[]; Link: LinkLike; account?: ReactNode; status: ReactNode; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-6">
      <Link href="/">
        <Wordmark className="text-xl" />
      </Link>
      <nav aria-label="Main" className="-mx-1">
        <ul className="flex flex-col gap-0.5">
          {nav.map((n) => (
            <li key={n.href} onClick={onNavigate}>
              <Link
                href={n.href}
                aria-current={n.active ? "page" : undefined}
                className={cx(
                  "flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors",
                  n.active ? "bg-white text-ink shadow-[0_6px_18px_-12px_rgb(13_27_51/0.45)]" : "text-muted hover:bg-white/60 hover:text-ink",
                )}
              >
                <span className={n.active ? "text-action" : undefined}>{n.icon}</span>
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-auto flex flex-col gap-2 border-t border-ink/8 pt-4 text-sm">
        {account && <div className="min-w-0 font-medium text-ink">{account}</div>}
        <div>{status}</div>
      </div>
    </div>
  );
}

/**
 * A sidebar on wide screens. On phones a top bar holds the logo, the actions and a menu button that slides the same
 * sidebar in from the left (a modal <dialog>: focus stays inside, Escape and a tap outside close it).
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
  const drawer = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => drawer.current?.close();
  // A phone rotated to a wide screen gets the sidebar, so the drawer shouldn't stay open behind it.
  useEffect(() => {
    const wide = matchMedia("(min-width: 768px)");
    const onChange = () => wide.matches && drawer.current?.close();
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, []);

  return (
    <div className="relative isolate min-h-dvh md:pl-64">
      <CloudBank className="-z-10" />
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-card focus:px-3 focus:py-2">
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-white/70 bg-white/45 px-4 py-6 backdrop-blur-xl md:block">
        <NavPanel nav={nav} Link={Link} account={account} status={status} />
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 bg-gradient-to-b from-paper/90 to-paper/0 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:static md:justify-end md:bg-none md:px-8 md:pt-6">
        <div className="flex items-center gap-1 md:hidden">
          <button
            onClick={() => {
              drawer.current?.showModal();
              setOpen(true);
            }}
            aria-label="Open menu"
            aria-expanded={open}
            aria-haspopup="dialog"
            className="-ml-2 inline-flex size-11 items-center justify-center rounded-full text-ink hover:bg-white/60"
          >
            <Menu size={22} aria-hidden />
          </button>
          <Link href="/">
            <Wordmark className="text-lg" />
          </Link>
        </div>
        <div className="flex min-w-0 items-center gap-3">{actions}</div>
      </header>

      <main id="main" className="mx-auto w-full max-w-5xl px-4 pb-[max(3rem,env(safe-area-inset-bottom))] pt-2 md:px-8 md:pt-4">
        {children}
      </main>

      <dialog
        ref={drawer}
        aria-label="Menu"
        className="side-drawer md:hidden"
        onClose={() => setOpen(false)}
        // A tap on the backdrop lands on the dialog itself, outside the panel.
        onClick={(e) => e.target === e.currentTarget && close()}
      >
        <div className="relative h-full bg-paper px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))]">
          <button onClick={close} aria-label="Close menu" className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] inline-flex size-11 items-center justify-center rounded-full text-muted hover:bg-white hover:text-ink">
            <X size={20} aria-hidden />
          </button>
          <NavPanel nav={nav} Link={Link} account={account} status={status} onNavigate={close} />
        </div>
      </dialog>
    </div>
  );
}
