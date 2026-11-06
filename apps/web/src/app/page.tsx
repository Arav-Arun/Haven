"use client";

import { FxLabel } from "@haven/ui";
import { ArrowRight, Puzzle } from "lucide-react";
import Link from "next/link";
import "./landing.css";
import { Apps, BuiltOn, Closing, Faq, Privacy, Tracks } from "@/components/landing/More";
import { RealScreens, UseCases } from "@/components/landing/Screens";
import { Nav } from "@/components/landing/Nav";
import { Clouds } from "@/components/landing/Sky";
import { Steps } from "@/components/landing/Steps";
import { Tour } from "@/components/landing/Tour";
import { MissingConfig } from "@/components/MissingConfig";
import { PullUpFooter } from "@/components/SiteFooter";
import { useDrive } from "@/lib/drive";

export default function Home() {
  const { identity, restoring } = useDrive();
  const signedIn = !restoring && !!identity;
  const primary = signedIn ? { href: "/drive", label: "Open my drive" } : { href: "/onboarding", label: "Start sharing" };

  return (
    <div className="landing min-h-dvh">
      <Nav cta={signedIn ? { href: "/drive", label: "Open Haven" } : { href: "/onboarding", label: "Start sharing" }} />

      <PullUpFooter surface="bg-[#eef3fa]">
        <div className="p-2 sm:p-4">
          <section className="sky relative flex min-h-[92svh] flex-col overflow-hidden rounded-[28px] sm:rounded-[36px]">
            <Clouds />
            <div className="relative z-10 px-4 pt-24">
              <MissingConfig />
            </div>
            <div className="hero-copy relative z-30 mx-auto flex max-w-5xl flex-1 flex-col items-center justify-center px-5 pb-10 pt-6 text-center">
              <h1 className="display text-[12vw] text-white drop-shadow-[0_4px_30px_rgb(20_60_150_/_0.35)] sm:text-7xl lg:text-[88px]">
                Keep anything private.
                <br />
                <span className="text-[#0d1b33]">Share it without a trace.</span>
              </h1>
              <p className="mt-7 max-w-[40rem] text-lg leading-relaxed text-[#0d1b33]/80 sm:text-xl">
                Haven is stealth storage on open networks. Files are encrypted on your device and kept on Swarm. Share them
                with any ENS name through a fresh address nobody can trace, until the date you pick.
              </p>
              <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
                <Link href={primary.href} className="btn-clay fx inline-flex items-center gap-3 rounded-full py-2 pl-7 pr-2 text-[17px] font-semibold">
                  <FxLabel>
                    {primary.label}
                    <span className="flex size-10 items-center justify-center rounded-full bg-[#1f4fd1] text-white [.fx-hover_&]:bg-white [.fx-hover_&]:text-[#1f4fd1]">
                      <ArrowRight size={18} />
                    </span>
                  </FxLabel>
                </Link>
                <Link
                  href="/extension/"
                  className="inline-flex h-14 items-center gap-2.5 rounded-full bg-[#0d1b33] px-6 text-[17px] font-semibold text-white shadow-[0_14px_30px_-14px_rgb(13_27_51/0.7)] transition-colors hover:bg-[#1f4fd1]"
                >
                  <Puzzle size={19} aria-hidden /> Add to Chrome
                </Link>
              </div>
            </div>
            {/* The real product, rising out of the clouds: the Public view from a Try it run on Sepolia. */}
            <div className="relative z-20 mx-auto -mb-16 w-full max-w-[640px] px-5 sm:-mb-24">
              <div className="rounded-[24px] bg-white/60 p-2 shadow-[0_40px_80px_-30px_rgb(13_27_51_/_0.55)] ring-1 ring-white/80 backdrop-blur">
                <img
                  src="/screens/public-view.webp"
                  width={606}
                  height={320}
                  alt="Haven's Public view of a live data room: two random addresses and padded files is all anyone can see"
                  className="h-auto w-full rounded-[18px]"
                />
              </div>
            </div>
          </section>
        </div>

        <BuiltOn />
        <main>
          <UseCases />
          <Steps />
          <RealScreens />
          <Tour />
          <Tracks />
          <Privacy />
          <Apps />
          <Faq />
        </main>
        <Closing href={primary.href} label={primary.label} />
      </PullUpFooter>
    </div>
  );
}
