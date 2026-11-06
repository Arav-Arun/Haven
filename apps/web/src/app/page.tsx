"use client";

import Link from "next/link";
import "./landing.css";
import { Arrow, Hanger, Lock } from "@/components/landing/icons";
import { Apps, BuiltOn, FinalCall, HowItWorks, Privacy, Technology } from "@/components/landing/Sections";
import { Clouds } from "@/components/landing/Sky";
import { TicketStack } from "@/components/landing/Tickets";
import { MissingConfig } from "@/components/MissingConfig";
import { NetworkBadge } from "@/components/NetworkBadge";
import { useDrive } from "@/lib/drive";

const NAV = [
  ["How it works", "#how"],
  ["Privacy", "#privacy"],
  ["Technology", "#tech"],
  ["Apps", "#apps"],
] as const;

export default function Home() {
  const { identity, restoring } = useDrive();
  const signedIn = !restoring && !!identity;
  const primary = signedIn ? { href: "/drive", label: "Open my drive" } : { href: "/onboarding", label: "Start sharing" };

  return (
    <div className="landing min-h-dvh">
      <div className="p-2 sm:p-4">
        <div className="rounded-[32px] border border-white bg-white/60 p-1.5 shadow-[0_40px_80px_-40px_rgb(28_64_140_/_0.35)] backdrop-blur-sm sm:p-2">
          <section className="sky relative overflow-hidden rounded-[26px]">
            <Clouds />

            <header className="relative z-20 flex items-center justify-between gap-4 px-5 py-5 sm:px-8 sm:py-6">
              <Link href="/" className="flex items-center gap-2.5 text-white">
                <span className="flex size-9 items-center justify-center rounded-full bg-white text-[#2563eb] shadow-[0_6px_16px_-6px_rgb(13_27_51_/_0.4)]">
                  <Hanger width={20} height={20} />
                </span>
                <span className="text-lg font-semibold tracking-tight">Haven</span>
              </Link>
              <nav className="flex items-center gap-1 sm:gap-2">
                <ul className="mr-2 hidden items-center gap-1 lg:flex">
                  {NAV.map(([label, href]) => (
                    <li key={href}>
                      <a href={href} className="rounded-full px-4 py-2 text-[15px] text-white/85 transition-colors hover:bg-white/15 hover:text-white">
                        {label}
                      </a>
                    </li>
                  ))}
                </ul>
                <span className="hidden sm:block">
                  <NetworkBadge compact />
                </span>
                <Link
                  href={signedIn ? "/drive" : "/onboarding"}
                  className="rounded-full border border-white/50 bg-white/20 px-5 py-2.5 text-[15px] font-medium text-white shadow-[inset_0_1px_0_rgb(255_255_255_/_0.5)] backdrop-blur-md transition-colors hover:bg-white/30"
                >
                  {signedIn ? "Open app" : "Sign in"}
                </Link>
              </nav>
            </header>

            <div className="relative z-10 px-4">
              <MissingConfig />
            </div>

            <div className="relative z-10 pt-2 sm:pt-4">
              <TicketStack />
            </div>

            <div className="hero-copy relative z-30 mx-auto flex max-w-5xl flex-col items-center px-5 pb-12 text-center sm:pb-16">
              <span className="glass-soft inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-[#0d1b33]/80">
                <Lock width={16} height={16} className="text-[#2563eb]" />
                Private file sharing on ENS
              </span>
              <h1 className="headline mt-7 text-[10.6vw] text-[#0d1b33] sm:text-7xl lg:text-[92px]">
                Share files with any ENS name, privately
              </h1>
              <p className="mt-6 max-w-[36rem] text-[17px] leading-relaxed text-[#0d1b33]/70 sm:text-lg">
                Files are encrypted on your device. Each person gets a claim ticket, not your name, and their access ends on
                the date you pick. No one else can tell who holds one.
              </p>
              <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
                <Link href={primary.href} className="pill-action inline-flex items-center gap-2.5 rounded-full px-8 py-4 text-base font-medium">
                  {primary.label}
                  <Arrow width={18} height={18} />
                </Link>
                {!signedIn && (
                  <Link href="/try" className="text-[15px] font-medium text-[#0d1b33]/70 underline-offset-4 hover:text-[#0d1b33] hover:underline">
                    Try it without a wallet
                  </Link>
                )}
              </div>
            </div>
            <BuiltOn />
          </section>
        </div>
      </div>

      <main>
        <HowItWorks />
        <Privacy />
        <Technology />
        <Apps />
      </main>
      <FinalCall href={primary.href} label={primary.label} />
    </div>
  );
}
