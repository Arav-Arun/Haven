"use client";

import { FxLabel } from "@haven/ui";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import "../landing.css";
import { Apps, BuiltOn, Closing, Faq, Privacy, Tracks } from "@/components/landing/More";
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
            <div className="hero-copy relative z-30 mx-auto flex max-w-5xl flex-1 flex-col items-center justify-center px-5 pb-40 pt-6 text-center sm:pb-48">
              <h1 className="display text-[12vw] text-white drop-shadow-[0_4px_30px_rgb(20_60_150_/_0.35)] sm:text-7xl lg:text-[88px]">
                Share any file by name.
                <br />
                <span className="text-[#0d1b33]">Nobody learns who.</span>
              </h1>
              <p className="mt-7 max-w-[40rem] text-lg leading-relaxed text-[#0d1b33]/80 sm:text-xl">
                Haven encrypts files on your device and shares them with any ENS name. Each person gets a private ticket, and
                their access ends on the date you pick.
              </p>
              <div className="mt-10 flex justify-center">
                <Link href={primary.href} className="btn-clay fx inline-flex items-center gap-3 rounded-full py-2 pl-7 pr-2 text-[17px] font-semibold">
                  <FxLabel>
                    {primary.label}
                    <span className="flex size-10 items-center justify-center rounded-full bg-[#1f4fd1] text-white [.fx-hover_&]:bg-white [.fx-hover_&]:text-[#1f4fd1]">
                      <ArrowRight size={18} />
                    </span>
                  </FxLabel>
                </Link>
              </div>
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
      </PullUpFooter>
    </div>
  );
}
