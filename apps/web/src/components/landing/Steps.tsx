"use client";

// "How it works": three cards, each playing one real step of Haven on a small sky scene.
// They are illustrations of the flow (no live data), so they carry no addresses or hashes.

import { Check, FileText, Lock, Ticket } from "lucide-react";
import type { ReactNode } from "react";
import { useInView, useSteps } from "./hooks";
import { Clouds } from "./Sky";

function Scene({ children, tall }: { children: ReactNode; tall?: boolean }) {
  return (
    <div className={`sky-card relative overflow-hidden rounded-[28px] ${tall ? "aspect-[4/4.4]" : "aspect-square"}`}>
      <Clouds />
      <div className="absolute inset-x-4 bottom-4 sm:inset-x-5 sm:bottom-5">{children}</div>
    </div>
  );
}

function Done({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <li className={`flex items-center gap-2.5 text-[13px] transition-opacity duration-500 ${on ? "opacity-100" : "opacity-35"}`}>
      <span className={`flex size-5 shrink-0 items-center justify-center rounded-full transition-colors duration-500 ${on ? "bg-[#1f4fd1] text-white" : "bg-[#0d1b33]/10 text-transparent"}`}>
        <Check size={12} strokeWidth={3} />
      </span>
      <span className="text-[#0d1b33]/80">{children}</span>
    </li>
  );
}

function ClaimScene({ run }: { run: boolean }) {
  const s = useSteps(4, run);
  const typed = ["", "aar", "aarav", "aarav"][s]!;
  return (
    <Scene>
      <div className="scene-panel rounded-2xl p-4">
        <p className="text-[12px] font-medium text-[#0d1b33]/55">Claim your name</p>
        <div className="mt-2 flex items-center rounded-xl border border-[#0d1b33]/10 bg-white px-3 py-2.5 text-[14px]">
          <span className="font-medium text-[#0d1b33]">{typed}</span>
          {s < 2 && <span className="caret -ml-px h-4 w-px bg-[#1f4fd1]" />}
          <span className="text-[#0d1b33]/40">.haven.eth</span>
          {s >= 2 && <span className="pop ml-auto rounded-full bg-[#e3f4ea] px-2 py-0.5 text-[11px] font-semibold text-[#1d6b4b]">Available</span>}
        </div>
        <ul className="mt-3 flex flex-col gap-1.5">
          <Done on={s >= 3}>Keys made on this device</Done>
          <Done on={s >= 3}>Public key published on ENS and Arkiv</Done>
        </ul>
      </div>
    </Scene>
  );
}

function UploadScene({ run }: { run: boolean }) {
  const s = useSteps(5, run, 900);
  return (
    <Scene tall>
      <div className="scene-panel rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-[#1f4fd1]/10 text-[#1f4fd1]">
            {s >= 1 ? <Lock size={18} /> : <FileText size={18} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold text-[#0d1b33]">Medical records.pdf</p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#0d1b33]/10">
              <span className="block h-full rounded-full bg-[#1f4fd1] transition-[width] duration-700" style={{ width: `${(s / 4) * 100}%` }} />
            </div>
          </div>
        </div>
        <ul className="mt-3.5 flex flex-col gap-1.5">
          <Done on={s >= 1}>Encrypted on your device</Done>
          <Done on={s >= 2}>Padded to a fixed size</Done>
          <Done on={s >= 3}>Stored on Swarm</Done>
          <Done on={s >= 4}>Listed on Arkiv, name sealed</Done>
        </ul>
      </div>
    </Scene>
  );
}

function ShareScene({ run }: { run: boolean }) {
  const s = useSteps(4, run);
  return (
    <Scene>
      <div className="flex flex-col gap-2.5">
        {s >= 3 && (
          <div className="pop glass claim mx-auto flex w-[78%] items-center gap-3 rounded-2xl px-4 py-3">
            <Ticket size={18} className="shrink-0 text-[#1f4fd1]" />
            <div className="text-[12px] leading-tight text-[#0d1b33]">
              <p className="font-semibold">A ticket for sam.eth</p>
              <p className="text-[#0d1b33]/60">A new random address, not their name</p>
            </div>
          </div>
        )}
        <div className="scene-panel rounded-2xl p-4">
          <div className="flex items-center rounded-xl border border-[#0d1b33]/10 bg-white px-3 py-2.5 text-[14px]">
            <span className="font-medium text-[#0d1b33]">{s >= 1 ? "sam.eth" : ""}</span>
            {s < 1 && <span className="caret h-4 w-px bg-[#1f4fd1]" />}
            {s >= 1 && <Check size={15} className="pop ml-auto text-[#1d6b4b]" />}
          </div>
          <div className={`mt-2.5 flex gap-2 transition-opacity duration-500 ${s >= 2 ? "opacity-100" : "opacity-30"}`}>
            <span className="rounded-lg bg-[#0d1b33]/[0.06] px-2.5 py-1.5 text-[12px] font-medium">Can view</span>
            <span className="rounded-lg bg-[#0d1b33]/[0.06] px-2.5 py-1.5 text-[12px] font-medium">Until Friday, 6 pm</span>
            <span className={`ml-auto rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white transition-colors ${s >= 3 ? "bg-[#1d6b4b]" : "bg-[#1f4fd1]"}`}>
              {s >= 3 ? "Shared" : "Share"}
            </span>
          </div>
        </div>
      </div>
    </Scene>
  );
}

const STEPS = [
  { title: "Claim your name", body: "Sign once with your wallet, or try it with no wallet at all. Your keys are made on your device, and your name tells others where to share.", Scene: ClaimScene, offset: "" },
  { title: "Add any file", body: "It's encrypted and padded before it leaves your device. Swarm stores the ciphertext; Arkiv lists it with the name and key sealed.", Scene: UploadScene, offset: "md:mt-16" },
  { title: "Share by name", body: "Type an ENS name and an end date. They get a private ticket, the chain sees a random address, and new files lock for them when time's up.", Scene: ShareScene, offset: "md:mt-32" },
];

export function Steps() {
  const { ref, inView } = useInView<HTMLDivElement>(0.2);
  return (
    <section id="how" className="mx-auto max-w-6xl scroll-mt-28 px-5 py-24 lg:py-32">
      <div className="mx-auto max-w-4xl text-center">
        <h2 className="display text-5xl text-[#0d1b33] sm:text-6xl">Share your first file in a minute.</h2>
        <p className="mt-5 text-lg leading-relaxed text-[#0d1b33]/65">Claim a name, add a file, type who it&apos;s for. That&apos;s the whole thing.</p>
      </div>
      <div ref={ref} className="mt-16 grid gap-10 md:grid-cols-3 md:gap-6">
        {STEPS.map(({ title, body, Scene: S, offset }, i) => (
          <div key={title} data-in={inView} className={`reveal ${offset}`} style={{ transitionDelay: `${i * 140}ms` }}>
            <S run={inView} />
            <h3 className="mt-6 flex items-baseline gap-3 text-2xl font-semibold tracking-[-0.02em] text-[#0d1b33]">
              <span className="text-sm font-medium tabular-nums text-[#1f4fd1]">0{i + 1}</span>
              {title}
            </h3>
            <p className="mt-2 text-[16px] leading-relaxed text-[#0d1b33]/65">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
