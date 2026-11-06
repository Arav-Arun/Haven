"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import "./landing.css";
import { Apps, BuiltOn, Closing, Faq, Privacy, Tracks } from "@/components/landing/More";
import { Nav } from "@/components/landing/Nav";
import { Clouds } from "@/components/landing/Sky";
import { Steps } from "@/components/landing/Steps";
import { TicketStack } from "@/components/landing/Tickets";
import { Tour } from "@/components/landing/Tour";
import { MissingConfig } from "@/components/MissingConfig";
import { useDrive } from "@/lib/drive";

const PROMISES = ["Encrypted on your device", "Recipients stay hidden", "Access ends on its own"];

export default function Home() {
  const { identity, restoring } = useDrive();
  const signedIn = !restoring && !!identity;
  const primary = signedIn ? { href: "/drive", label: "Open my drive" } : { href: "/onboarding", label: "Start sharing" };

  return (
    <div className="landing min-h-dvh">
      <Nav cta={signedIn ? { href: "/drive", label: "Open Haven" } : { href: "/onboarding", label: "Start sharing" }} />

      <div className="p-2 sm:p-4">
        <section className="sky relative overflow-hidden rounded-[28px] sm:rounded-[36px]">
          <Clouds />
          <div className="relative z-10 px-4 pt-24">
            <MissingConfig />
          </div>
          <div className="hero-copy relative z-30 mx-auto flex max-w-5xl flex-col items-center px-5 pt-14 text-center sm:pt-20">
            <h1 className="display text-[12vw] text-white drop-shadow-[0_4px_30px_rgb(20_60_150_/_0.35)] sm:text-7xl lg:text-[88px]">
              Share any file by name.
              <br />
              <span className="text-[#0d1b33]">Nobody learns who.</span>
            </h1>
            <p className="mt-7 max-w-[40rem] text-lg leading-relaxed text-[#0d1b33]/80 sm:text-xl">
              Haven encrypts files on your device and shares them with any ENS name. Each person gets a private ticket, and
              their access ends on the date you pick.
            </p>
            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
              <Link href={primary.href} className="pill-white inline-flex items-center gap-3 rounded-full py-2 pl-7 pr-2 text-[17px] font-semibold">
                {primary.label}
                <span className="flex size-10 items-center justify-center rounded-full bg-[#1f4fd1] text-white">
                  <ArrowRight size={18} />
                </span>
              </Link>
              {!signedIn && (
                <Link href="/try" className="rounded-full px-5 py-3 text-[16px] font-semibold text-[#0d1b33]/80 transition-colors hover:bg-white/40 hover:text-[#0d1b33]">
                  Try it without a wallet
                </Link>
              )}
            </div>
            <ul className="mt-8 flex flex-wrap justify-center gap-2">
              {PROMISES.map((p) => (
                <li key={p} className="glass-soft rounded-full px-4 py-2 text-[15px] font-medium text-[#0d1b33]/80">
                  {p}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative z-10 mt-6 pb-10 sm:mt-10">
            <TicketStack />
          </div>
        </section>
      </div>

      <BuiltOn />
      <main>
        <Steps />
        <Tour />
        <Tracks />
        <Privacy />
        <Apps />
        <Faq />
      </main>
      <Closing href={primary.href} label={primary.label} />
    </div>
  );
}
