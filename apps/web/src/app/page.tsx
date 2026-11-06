"use client";

import { Wordmark } from "@cloakroom/ui";
import Link from "next/link";
import { MissingConfig } from "@/components/MissingConfig";
import { NetworkBadge } from "@/components/NetworkBadge";
import { useDrive } from "@/lib/drive";

const FACTS: [string, string][] = [
  [
    "No one can see who you shared with",
    "Each person you share with appears on the chain as a new random address. Only you, and they, know whose it is.",
  ],
  [
    "Access ends on its own",
    "Pick an end date. After it, every new file is locked for them, with no transaction to send. What they already opened, they keep, as with any file you share.",
  ],
  [
    "Files are encrypted before they leave your device",
    "Storage sees only padded ciphertext. Lookups go through a private network, so the RPC providers can't see who is asking.",
  ],
];

export default function Home() {
  const { identity, restoring } = useDrive();
  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-5">
      <header className="flex items-center justify-between gap-3 py-5">
        <Wordmark />
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/settings" className="text-muted hover:text-ink">
            Settings
          </Link>
          <NetworkBadge compact />
        </nav>
      </header>

      <main className="flex flex-1 flex-col gap-12 pb-16 pt-8 md:pt-16">
        <MissingConfig />
        <section className="grid items-end gap-10 md:grid-cols-[1.3fr_1fr]">
          <div>
            <h1 className="font-display text-6xl font-bold uppercase leading-[0.92] tracking-tight md:text-8xl">
              Share files privately with any ENS name.
            </h1>
            <p className="mt-6 max-w-[34rem] text-lg text-ink/80">
              Hand over a file the way you hand over a coat: they get a ticket, not your name. Their access ends when you say,
              and no one else can tell who holds a ticket.
            </p>
          </div>

          <div className="ticket flex min-h-[188px] items-stretch">
            <div className="flex w-[72px] shrink-0 items-center justify-center text-stamp">
              <span className="font-display text-3xl font-bold [writing-mode:vertical-rl] rotate-180">Admit one</span>
            </div>
            <div className="flex flex-1 flex-col justify-center gap-3 py-5 pl-5 pr-5">
              {!restoring && identity ? (
                <>
                  <p className="text-sm">Signed in as {identity.ensName ?? "a new user"}.</p>
                  <Link href="/drive" className="rounded-md bg-ink px-4 py-2.5 text-center font-medium text-paper">
                    Open my drive
                  </Link>
                </>
              ) : (
                <>
                  <Link href="/onboarding" className="rounded-md bg-ink px-4 py-2.5 text-center font-medium text-paper">
                    Sign in with a wallet
                  </Link>
                  <Link href="/try" className="rounded-md border border-ink/30 px-4 py-2.5 text-center font-medium">
                    Try it without a wallet
                  </Link>
                  <p className="text-xs text-ink/70">Sepolia test network. Nothing to install.</p>
                </>
              )}
            </div>
          </div>
        </section>

        <dl className="grid gap-x-10 gap-y-6 border-t border-line pt-8 md:grid-cols-3">
          {FACTS.map(([t, d]) => (
            <div key={t}>
              <dt className="font-semibold">{t}</dt>
              <dd className="mt-1.5 text-sm text-muted">{d}</dd>
            </div>
          ))}
        </dl>
      </main>
    </div>
  );
}
