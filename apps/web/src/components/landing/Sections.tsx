// The landing page below the hero: how a file travels, what stays private, the technology, and the apps.
// Every sentence describes what the code does today.

import Link from "next/link";
import { FileJourney } from "./FileJourney";
import Image from "next/image";
import type { ComponentType, ReactNode, SVGProps } from "react";
import {
  Arrow,
  Check,
  Eye,
  EyeOff,
  Hanger,
  Hexagon,
  Layers,
  Monitor,
  Net,
  Phone,
  Puzzle,
  Tag,
} from "./icons";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const TRACKS = [
  { name: "ENS", feature: "Names & expiring access", logo: "/ens.webp" },
  { name: "Arkiv", feature: "Encrypted, queryable file records", logo: "/arkive.png" },
  { name: "Swarm", feature: "Storage for encrypted files", logo: "/swarm.png" },
  { name: "Ethereum Foundation", feature: "Private network lookups", logo: "/eth.png" },
];

export function BuiltOn() {
  return (
    <section aria-labelledby="tracks-heading" className="relative z-10 mx-auto max-w-6xl px-5 pb-10 sm:px-8 sm:pb-14">
      <div className="mb-5 flex flex-col gap-1 text-center">
        <h2 id="tracks-heading" className="text-lg font-semibold tracking-tight text-[#0d1b33]">The technology behind Haven</h2>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {TRACKS.map(({ name, feature, logo }) => (
          <article key={name} className="flex min-h-[120px] items-start gap-3.5 rounded-2xl border border-[#d4dfed] bg-white p-4">
            <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#0d1b33]/5 bg-white">
              <Image src={logo} width={44} height={44} alt="" className="size-full object-contain" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold leading-snug text-[#0d1b33]">{name}</h3>
              <p className="mt-1 text-sm leading-relaxed text-[#0d1b33]/65">{feature}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function SectionHead({ id, kicker, title, children }: { id: string; kicker?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-24">
      {kicker && <p className="text-sm font-medium text-[#2563eb]">{kicker}</p>}
      <h2 className={`headline text-5xl text-[#0d1b33] sm:text-6xl${kicker ? " mt-3" : ""}`}>{title}</h2>
      {children && <p className="mt-5 max-w-[34rem] text-[17px] leading-relaxed text-[#0d1b33]/70">{children}</p>}
    </div>
  );
}

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-24 lg:py-32">
      <div className="mb-10 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <SectionHead id="how" title="How a file travels" />
        <p className="max-w-sm text-[16px] leading-relaxed text-[#0d1b33]/65">One file. Encrypted on your device, shared with the person you choose.</p>
      </div>
      <FileJourney />
    </section>
  );
}

const SEEN = [
  "That a folder exists, and when it was made",
  "How many random addresses hold access, and when each one ends",
  "How many files it holds, each padded to a fixed size",
];
const UNSEEN = [
  "Who the members are: each is a fresh address only you and they can link",
  "File names, contents and real sizes",
  "Who owns a room: rooms aren't linked to your name at all",
  "Who looked something up: lookups go through a private network",
];

export function Privacy() {
  return (
    <section className="relative overflow-hidden">
      <div className="relative mx-auto max-w-6xl px-5 py-24 lg:py-32">
        <SectionHead id="privacy" title={<>What the world sees, and what it doesn&apos;t</>}>
          Everything Haven writes is public, so we designed what that public record says. Every folder has a Public view
          that shows exactly this, read live from the chain.
        </SectionHead>
        <div className="mt-12 grid gap-5 md:grid-cols-2">
          <div className="glass-soft rounded-[26px] p-7 sm:p-8">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-full bg-[#0d1b33]/[0.06]">
                <Eye width={20} height={20} />
              </span>
              <h3 className="text-lg font-semibold">Anyone can see</h3>
            </div>
            <ul className="mt-6 flex flex-col gap-4">
              {SEEN.map((t) => (
                <li key={t} className="flex gap-3 text-[15px] leading-relaxed text-[#0d1b33]/70">
                  <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-[#0d1b33]/30" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative overflow-hidden rounded-[26px] border border-[#2563eb] bg-[#2563eb] p-7 text-white sm:p-8">
            <div aria-hidden className="absolute -right-16 -top-16 size-56 rounded-full bg-white/15 blur-2xl" />
            <div className="relative flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-full bg-white/20">
                <EyeOff width={20} height={20} />
              </span>
              <h3 className="text-lg font-semibold">Only you and your members see</h3>
            </div>
            <ul className="relative mt-6 flex flex-col gap-4">
              {UNSEEN.map((t) => (
                <li key={t} className="flex gap-3 text-[15px] leading-relaxed text-white/90">
                  <Check width={18} height={18} className="mt-0.5 shrink-0" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

const TECH: { icon: Icon; name: string; what: string; points: string[] }[] = [
  {
    icon: Tag,
    name: "ENSv2",
    what: "Every folder is its own ENS registry.",
    points: ["Roles that end on their own, set once", "Access history any app can ask about any past moment", "Members appear as stealth addresses"],
  },
  {
    icon: Layers,
    name: "Arkiv",
    what: "The records that tie it together.",
    points: ["Sealed file entries, key copies and welcome notes", "Entries expire along with the access they serve", "Every writer checked against the chain's role history"],
  },
  {
    icon: Hexagon,
    name: "Swarm",
    what: "Where the encrypted bytes live.",
    points: ["Padded ciphertext only, never a name or key", "Uploads need a signature from someone with write access", "Our Bee node stays private behind a read-only gateway"],
  },
  {
    icon: Net,
    name: "Anon-RPC",
    what: "Private reads and writes.",
    points: ["Every Sepolia and Arkiv call goes through a private network", "Isolated per folder, so calls can't be linked to each other", "Anything that can't go private is labelled, never hidden"],
  },
];

export function Technology() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-24 lg:py-32">
      <SectionHead id="tech" title="Four open networks, no server that knows">
        Our API only pays gas and registers names. It never sees a file, a key or who you shared with, and the app shows
        a receipt for every step it takes.
      </SectionHead>
      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {TECH.map(({ icon: I, name, what, points }) => (
          <article key={name} className="glass-soft flex flex-col rounded-[24px] p-6">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-[#2563eb]/[0.08] text-[#2563eb]">
              <I width={22} height={22} />
            </span>
            <h3 className="mt-5 text-xl font-semibold tracking-tight">{name}</h3>
            <p className="mt-1 text-[15px] text-[#0d1b33]/60">{what}</p>
            <ul className="mt-5 flex flex-col gap-3 border-t border-[#0d1b33]/8 pt-5">
              {points.map((p) => (
                <li key={p} className="flex gap-2.5 text-sm leading-snug text-[#0d1b33]/75">
                  <Check width={16} height={16} className="mt-px shrink-0 text-[#2563eb]" />
                  {p}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

const APPS: { icon: Icon; name: string; body: string }[] = [
  { icon: Monitor, name: "Website", body: "Your drive, rooms and shares in any browser. Nothing to install." },
  { icon: Phone, name: "Phone app", body: "Add it to your home screen. On Android, share files to it straight from other apps." },
  { icon: Puzzle, name: "Browser extension", body: "Save any file from a page with a right-click, and hear about new shares in the background." },
];

export function Apps() {
  return (
    <section className="mx-auto max-w-6xl px-5 pb-24 lg:pb-32">
      <SectionHead id="apps" title="Wherever you are" />
      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {APPS.map(({ icon: I, name, body }) => (
          <div key={name} className="glass-soft flex items-start gap-4 rounded-[24px] p-6">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#0d1b33]/[0.05] text-[#0d1b33]/80">
              <I width={22} height={22} />
            </span>
            <div>
              <h3 className="font-semibold">{name}</h3>
              <p className="mt-1 text-[15px] leading-relaxed text-[#0d1b33]/65">{body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function FinalCall({ href, label }: { href: string; label: string }) {
  return (
    <section className="px-2 pb-2 sm:px-4 sm:pb-4">
      <div className="relative overflow-hidden rounded-[28px] border border-[#2563eb] bg-[#2563eb] px-6 pb-16 pt-14 text-center sm:pb-20 sm:pt-16">
        <div className="relative z-30 mx-auto max-w-3xl">
          <h2 className="headline text-5xl text-white sm:text-7xl lg:text-[84px]">
            Hand over a file. Keep the names to yourself.
          </h2>
          <Link href={href} className="final-action mt-8 inline-flex items-center gap-2.5 rounded-full border border-white bg-white px-7 py-3.5 text-[15px] font-medium text-[#2563eb] transition-colors hover:bg-[#edf4fd]">
            {label}
            <Arrow width={18} height={18} />
          </Link>
        </div>
      </div>
      <footer className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 text-sm text-[#0d1b33]/55">
        <span className="flex items-center gap-2 text-[#0d1b33]/80">
          <Hanger width={18} height={18} />
          Haven
        </span>
        <span>Built at ETHGlobal Mumbai 2026 by Team <strong>Deploy For Good</strong></span>
        <a className="underline-offset-4 hover:underline" href="https://github.com/Arav-Arun/ETHGlobalMumbai" rel="noreferrer">
          Source code
        </a>
      </footer>
    </section>
  );
}
