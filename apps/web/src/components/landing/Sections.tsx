// The landing page below the hero: how a file travels, what stays private, the technology, and the apps.
// Every sentence describes what the code does today.

import Link from "next/link";
import { FrontClouds } from "./Sky";
import type { ComponentType, ReactNode, SVGProps } from "react";
import {
  Arrow,
  Check,
  Clock,
  Doc,
  Eye,
  EyeOff,
  Hanger,
  Hexagon,
  Key,
  Layers,
  Lock,
  Monitor,
  Net,
  Phone,
  Puzzle,
  Shuffle,
  Tag,
} from "./icons";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

export const BUILT_ON: { name: string; role: string; icon: Icon }[] = [
  { name: "ENS", role: "names and access", icon: Tag },
  { name: "Arkiv", role: "file records", icon: Layers },
  { name: "Swarm", role: "encrypted storage", icon: Hexagon },
  { name: "Ethereum", role: "Sepolia testnet", icon: Key },
  { name: "Anon-RPC", role: "private lookups", icon: Net },
];

export function BuiltOn() {
  return (
    <div className="grid grid-cols-2 gap-y-6 px-6 py-7 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:divide-[#0d1b33]/8 lg:px-2">
      {BUILT_ON.map(({ name, role, icon: I }) => (
        <div key={name} className="flex items-center justify-center gap-3 text-[#0d1b33]/70">
          <I width={22} height={22} className="text-[#3a6fd8]" />
          <div className="leading-tight">
            <div className="text-[17px] font-semibold tracking-tight text-[#0d1b33]/85">{name}</div>
            <div className="text-xs">{role}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionHead({ id, kicker, title, children }: { id: string; kicker: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-24">
      <p className="text-sm font-medium text-[#2563eb]">{kicker}</p>
      <h2 className="headline mt-3 text-5xl text-[#0d1b33] sm:text-6xl">{title}</h2>
      {children && <p className="mt-5 max-w-[34rem] text-[17px] leading-relaxed text-[#0d1b33]/70">{children}</p>}
    </div>
  );
}

const STEPS: { icon: Icon; title: string; body: string; tech: string }[] = [
  {
    icon: Key,
    title: "Sign in once",
    body: "Your wallet signs one message and your keys are made from it, on your device. No wallet? Try it with a random key.",
    tech: "On your device",
  },
  {
    icon: Tag,
    title: "Claim your name",
    body: "You get yourname.cloakroom.eth. It publishes your public key and points to your drive: an ENS registry only your key controls.",
    tech: "ENSv2",
  },
  {
    icon: Lock,
    title: "Encrypt before upload",
    body: "Each file gets its own AES-256 key and is padded to a fixed size, so even its real size stays private.",
    tech: "On your device",
  },
  {
    icon: Hexagon,
    title: "Store the ciphertext",
    body: "Only padded ciphertext leaves your device. It lives on Swarm, which never sees a name or a key.",
    tech: "Swarm",
  },
  {
    icon: Layers,
    title: "Record it",
    body: "A small entry holds where the file is, with its name and key sealed. Apps count it only if its writer had access at that moment, checked against the chain.",
    tech: "Arkiv",
  },
  {
    icon: Shuffle,
    title: "Share with an ENS name",
    body: "Type investor.eth. Cloakroom makes a new random address for them, gives it access until the date you pick, and leaves a sealed note only they can open.",
    tech: "ENSv2 + Arkiv",
  },
  {
    icon: Clock,
    title: "Access ends on its own",
    body: "Folder keys move forward every hour. Theirs stop at the end date, so new files lock for them with no transaction to send.",
    tech: "Key chain",
  },
];

export function HowItWorks() {
  return (
    <section className="mx-auto grid max-w-6xl gap-12 px-5 py-24 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-20 lg:py-32">
      <div className="lg:sticky lg:top-24 lg:self-start">
        <SectionHead id="how" kicker="How it works" title="How a file travels">
          From your device to the person you chose, and out of their reach when their time is up. Nothing in between can
          read it, and nothing on the chain says who it went to.
        </SectionHead>
      </div>
      <ol className="relative flex flex-col gap-4">
        <span aria-hidden className="absolute bottom-8 left-[33px] top-8 w-px bg-gradient-to-b from-[#2563eb]/40 via-[#2563eb]/20 to-transparent" />
        {STEPS.map(({ icon: I, title, body, tech }, i) => (
          <li key={title} className="glass-soft relative flex gap-5 rounded-[22px] p-5 sm:p-6">
            <div className="relative flex size-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-b from-[#4a8bff] to-[#2563eb] text-white shadow-[inset_0_1px_0_rgb(255_255_255_/_0.4),0_8px_18px_-8px_rgb(37_99_235_/_0.7)]">
              <I width={21} height={21} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="text-[17px] font-semibold tracking-tight">
                  <span className="mr-2 tabular-nums text-[#0d1b33]/35">{i + 1}</span>
                  {title}
                </h3>
                <span className="rounded-full border border-[#2563eb]/15 bg-[#2563eb]/[0.06] px-2.5 py-0.5 text-xs font-medium text-[#2563eb]">
                  {tech}
                </span>
              </div>
              <p className="mt-1.5 text-[15px] leading-relaxed text-[#0d1b33]/65">{body}</p>
            </div>
          </li>
        ))}
      </ol>
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
      <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-transparent via-[#dce8fb] to-transparent" />
      <div className="relative mx-auto max-w-6xl px-5 py-24 lg:py-32">
        <SectionHead id="privacy" kicker="Privacy" title={<>What the world sees, and what it doesn&apos;t</>}>
          Everything Cloakroom writes is public, so we designed what that public record says. Every folder has a Public view
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
          <div className="relative overflow-hidden rounded-[26px] bg-gradient-to-br from-[#2b62d9] via-[#3a74ea] to-[#5d95f3] p-7 text-white shadow-[0_30px_60px_-28px_rgb(37_99_235_/_0.8)] sm:p-8">
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
      <SectionHead id="tech" kicker="Technology" title="Four open networks, no server that knows">
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
      <SectionHead id="apps" kicker="Apps" title="Wherever you are" />
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
      <div className="relative overflow-hidden rounded-[28px] bg-gradient-to-b from-[#3f78e3] via-[#5b8eec] to-[#8fb5f2] px-6 pb-36 pt-20 text-center sm:pb-44 sm:pt-28">
        <FrontClouds />
        <div className="relative z-30 mx-auto max-w-3xl">
          <span className="glass-soft mx-auto mb-7 flex size-14 items-center justify-center rounded-2xl text-[#2563eb]">
            <Doc width={26} height={26} />
          </span>
          <h2 className="headline text-5xl text-white drop-shadow-[0_2px_20px_rgb(20_60_150_/_0.35)] sm:text-7xl lg:text-[84px]">
            Hand over a file. Keep the names to yourself.
          </h2>
          <Link href={href} className="pill-action mt-10 inline-flex items-center gap-2.5 rounded-full px-7 py-3.5 text-[15px] font-medium">
            {label}
            <Arrow width={18} height={18} />
          </Link>
        </div>
      </div>
      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-[#0d1b33]/55">
        <span className="flex items-center gap-2 text-[#0d1b33]/80">
          <Hanger width={18} height={18} />
          Cloakroom
        </span>
        <span>Built at ETHGlobal Mumbai 2026. Runs on the Sepolia test network.</span>
        <a className="underline-offset-4 hover:underline" href="https://github.com/Arav-Arun/ETHGlobalMumbai" rel="noreferrer">
          Source code
        </a>
      </footer>
    </section>
  );
}
