"use client";

// The rest of the landing page: the four networks (and prize tracks), privacy, apps, questions, the closing call.
// Every sentence describes what the code does today.

import { ArrowRight, Check, Eye, EyeOff, Monitor, Plus, Puzzle, Smartphone } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useInView } from "./hooks";
import { HavenLogo } from "./Logo";
import { NAV } from "./Nav";
import { FrontClouds } from "./Sky";

export const NETWORKS = [
  { name: "ENS", logo: "/ens.webp" },
  { name: "Arkiv", logo: "/arkive.png" },
  { name: "Swarm", logo: "/swarm.png" },
  { name: "Ethereum", logo: "/eth.png" },
  { name: "Anon-RPC", logo: "/eth.png" },
];

/** A slow, edge-faded strip of the networks Haven runs on. */
export function BuiltOn() {
  const row = [...NETWORKS, ...NETWORKS, ...NETWORKS];
  return (
    <div className="mx-auto max-w-5xl px-5 pb-6 pt-10">
      <p className="text-center text-[15px] text-[#0d1b33]/55">Runs on open networks, not on our servers</p>
      <div className="marquee mt-6 overflow-hidden">
        <div className="flex w-max gap-14">
          {[...row, ...row].map((n, i) => (
            <span key={i} className="flex shrink-0 items-center gap-2.5 text-xl font-semibold tracking-tight text-[#0d1b33]/70">
              <Image src={n.logo} width={28} height={28} alt="" className="rounded-md" />
              {n.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

const TRACKS = [
  {
    name: "ENS",
    prize: "Best Use of ENSv2",
    logo: "/ens.webp",
    lead: "Every folder is its own ENSv2 registry.",
    points: [
      "Your name, yourname.cloakroom.eth, points to your drive",
      "Data rooms are random subnames nobody can tie to you",
      "Roles from Enhanced Access Control that end on their own",
      "An access history any app can ask about any moment",
      "A Permissioned Resolver per name holds your public key",
      "Share with everyone under a name, like acme.eth",
    ],
    span: "lg:col-span-2 lg:row-span-2",
    dark: true,
  },
  {
    name: "Arkiv",
    prize: "Build on Arkiv",
    logo: "/arkive.png",
    lead: "The records that tie it all together.",
    points: ["Sealed file entries, key copies and invitations", "Entries expire with the access they serve", "A public key log for every name", "Every writer checked against onchain roles"],
    span: "lg:col-span-2",
  },
  {
    name: "Swarm",
    prize: "Arkiv + Swarm bonus",
    logo: "/swarm.png",
    lead: "Encrypted bytes, live updates, the site itself.",
    points: ["Padded ciphertext, referenced from Arkiv", "Doorbells for live updates", "A verified copy of the website"],
    span: "",
  },
  {
    name: "Ethereum Foundation",
    prize: "Anon-RPC · CROPS",
    logo: "/eth.png",
    lead: "Private lookups. Keys stay yours.",
    points: ["Every chain read goes through Anon-RPC", "The extension only trusts the published build", "No trackers. Open source, MIT"],
    span: "",
  },
];

export function Tracks() {
  const { ref, inView } = useInView<HTMLDivElement>(0.15);
  return (
    <section id="tracks" className="mx-auto max-w-6xl scroll-mt-28 px-5 py-24 lg:py-32">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="display text-5xl text-[#0d1b33] sm:text-6xl">Four open networks. One private drive.</h2>
        <p className="mt-5 text-lg leading-relaxed text-[#0d1b33]/65">
          Each one does real work in Haven. Built at ETHGlobal Mumbai for these prize tracks.
        </p>
      </div>
      <div ref={ref} className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TRACKS.map((t, i) => (
          <article
            key={t.name}
            data-in={inView}
            style={{ transitionDelay: `${i * 90}ms` }}
            className={`reveal flex flex-col rounded-[28px] p-7 ${t.span} ${t.dark ? "bg-gradient-to-br from-[#1f4fd1] via-[#2d62e6] to-[#5b93ff] text-white shadow-[0_30px_70px_-30px_rgb(31_79_209_/_0.8)]" : "bg-white shadow-[0_18px_44px_-28px_rgb(13_27_51_/_0.4)]"}`}
          >
            <div className="flex items-center gap-3">
              <span className="flex size-12 items-center justify-center overflow-hidden rounded-2xl bg-white">
                <Image src={t.logo} width={40} height={40} alt="" className="object-contain" />
              </span>
              <div>
                <h3 className="text-xl font-semibold tracking-[-0.02em]">{t.name}</h3>
                <p className={`text-[14px] ${t.dark ? "text-white/75" : "text-[#1f4fd1]"}`}>{t.prize}</p>
              </div>
            </div>
            <p className={`mt-6 font-semibold tracking-[-0.02em] ${t.dark ? "text-3xl leading-tight" : "text-xl"}`}>{t.lead}</p>
            <ul className={`mt-5 flex flex-col gap-3 ${t.dark ? "sm:grid sm:grid-cols-2 sm:gap-x-6" : ""}`}>
              {t.points.map((p) => (
                <li key={p} className={`flex gap-2.5 text-[15px] leading-snug ${t.dark ? "text-white/90" : "text-[#0d1b33]/75"}`}>
                  <Check size={17} className={`mt-0.5 shrink-0 ${t.dark ? "" : "text-[#1f4fd1]"}`} />
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

const SEEN = ["That a folder exists, and when it was made", "How many random addresses hold access, and when each ends", "How many files it holds, each padded to a fixed size"];
const UNSEEN = [
  "Who the members are: each is a fresh address only you and they can link",
  "File names, contents and real sizes",
  "Who owns a data room: rooms aren't linked to your name at all",
  "Who looked something up: lookups go through a private network",
];

export function Privacy() {
  return (
    <section id="privacy" className="scroll-mt-28 px-2 sm:px-4">
      <div className="sky relative mx-auto max-w-[1400px] overflow-hidden rounded-[32px] px-5 py-24 lg:py-32">
        <div className="absolute inset-x-0 bottom-0 h-1/2">
          <FrontClouds />
        </div>
        <div className="relative z-30 mx-auto max-w-6xl">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="display text-5xl text-white drop-shadow-[0_2px_18px_rgb(20_60_150_/_0.35)] sm:text-6xl">What the world sees, and what it doesn&apos;t.</h2>
            <p className="mt-5 text-lg leading-relaxed text-white/90">
              Everything Haven writes is public, so we designed what that record says. Every folder has a Public view that
              shows exactly this, read live.
            </p>
          </div>
          <div className="mt-14 grid gap-5 md:grid-cols-2">
            <div className="glass-soft rounded-[28px] p-8">
              <h3 className="flex items-center gap-3 text-xl font-semibold"><Eye size={22} /> Anyone can see</h3>
              <ul className="mt-6 flex flex-col gap-4">
                {SEEN.map((t) => (
                  <li key={t} className="flex gap-3 text-[16px] leading-relaxed text-[#0d1b33]/75">
                    <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-[#0d1b33]/35" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-[28px] bg-[#0d1b33] p-8 text-white shadow-[0_30px_60px_-28px_rgb(13_27_51_/_0.8)]">
              <h3 className="flex items-center gap-3 text-xl font-semibold"><EyeOff size={22} /> Only you and your members see</h3>
              <ul className="mt-6 flex flex-col gap-4">
                {UNSEEN.map((t) => (
                  <li key={t} className="flex gap-3 text-[16px] leading-relaxed text-white/90">
                    <Check size={18} className="mt-0.5 shrink-0 text-[#8fb5ff]" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const APPS = [
  { icon: Monitor, name: "Website", body: "Your drive, rooms and shares in any browser. Nothing to install." },
  { icon: Smartphone, name: "Phone app", body: "Add it to your home screen. On Android, share files to Haven from any app." },
  { icon: Puzzle, name: "Browser extension", body: "Save files with a right-click, hear about new shares, and keep your keys away from any page that isn't the real one." },
];

export function Apps() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-24 lg:py-32">
      <h2 className="display text-center text-5xl text-[#0d1b33] sm:text-6xl">Wherever you are.</h2>
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {APPS.map(({ icon: I, name, body }) => (
          <div key={name} className="rounded-[28px] bg-white p-7 shadow-[0_18px_44px_-28px_rgb(13_27_51_/_0.4)]">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-[#1f4fd1]/10 text-[#1f4fd1]">
              <I size={22} />
            </span>
            <h3 className="mt-5 text-xl font-semibold tracking-[-0.02em]">{name}</h3>
            <p className="mt-2 text-[16px] leading-relaxed text-[#0d1b33]/65">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const FAQ = [
  ["Can Haven read my files?", "No. Each file is encrypted on your device with its own key before it's uploaded. Swarm stores only padded ciphertext, and our API never sees a file, a key, or who you shared with."],
  ["What does the person I share with need?", "An ENS name with a Haven key: a name they claim in Haven, or an ENS name they already own, linked in Settings. They open what you shared in the browser, on their phone, or in the extension."],
  ["What happens when access ends?", "Their role ends onchain on the date you set, and their keys stop at that moment, so every file added afterwards is locked for them. No transaction is needed. What they already opened, they keep, as with any file you share."],
  ["Can anyone tell who I shared with?", "No. Each person appears onchain as a new random address that only you and they can link to their name. A data room isn't linked to you at all. The Public view shows exactly what anyone can see."],
  ["Do I need a wallet or crypto?", "No. Try it creates keys without a wallet. With a wallet you sign one message, and the gas for your name and folders is covered on the test networks."],
  ["What if your servers go away?", "Your files and records live on Sepolia, Arkiv and Swarm, not on our servers. The website also runs from its Swarm copy, and the whole stack is open source (MIT), so anyone can run it."],
] as const;

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="mx-auto grid max-w-6xl scroll-mt-28 gap-10 px-5 py-24 lg:grid-cols-[0.8fr_1.2fr] lg:py-32">
      <div>
        <h2 className="display text-5xl text-[#0d1b33] sm:text-6xl">Common questions</h2>
        <p className="mt-5 text-lg text-[#0d1b33]/65">Plain answers about what Haven can and can&apos;t see.</p>
      </div>
      <div className="flex flex-col">
        {FAQ.map(([q, a], i) => (
          <div key={q} className="border-b border-[#0d1b33]/10">
            <button
              aria-expanded={open === i}
              onClick={() => setOpen(open === i ? null : i)}
              className="flex w-full items-center justify-between gap-6 py-6 text-left text-lg font-semibold tracking-[-0.01em] text-[#0d1b33]"
            >
              {q}
              <span className={`flex size-8 shrink-0 items-center justify-center rounded-full bg-white shadow-sm transition-transform duration-300 ${open === i ? "rotate-45" : ""}`}>
                <Plus size={16} />
              </span>
            </button>
            <div className={`grid transition-[grid-template-rows] duration-300 ${open === i ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
              <p className="overflow-hidden pr-14 text-[16px] leading-relaxed text-[#0d1b33]/70">
                <span className="block pb-6">{a}</span>
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Closing({ href, label }: { href: string; label: string }) {
  return (
    <section className="px-2 pb-2 sm:px-4 sm:pb-4">
      <div className="relative mx-auto max-w-5xl overflow-hidden rounded-[32px] bg-gradient-to-b from-[#3f78e3] via-[#5b8eec] to-[#8fb5f2] px-6 pb-40 pt-20 text-center sm:pb-48 sm:pt-24">
        <FrontClouds />
        <div className="relative z-30 mx-auto max-w-3xl">
          <h2 className="display text-5xl text-white drop-shadow-[0_2px_20px_rgb(20_60_150_/_0.35)] sm:text-7xl">Hand over a file. Keep the names to yourself.</h2>
          <Link href={href} className="pill-white mt-10 inline-flex items-center gap-2.5 rounded-full px-7 py-3.5 text-[16px] font-semibold">
            {label}
            <ArrowRight size={18} />
          </Link>
        </div>
      </div>
      <footer className="mx-auto mt-6 flex max-w-5xl flex-col gap-6 px-4 py-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <HavenLogo size={30} />
          <p className="text-[15px] text-[#0d1b33]/60">
            Built at ETHGlobal Mumbai 2026 by Team <strong className="font-semibold text-[#0d1b33]">Deploy For Good</strong>
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-[15px] text-[#0d1b33]/65">
          {NAV.map(([l, h]) => (
            <a key={h} href={h} className="hover:text-[#0d1b33]">
              {l}
            </a>
          ))}
          <a href="https://github.com/Arav-Arun/ETHGlobalMumbai" rel="noreferrer" className="hover:text-[#0d1b33]">
            Source code
          </a>
        </nav>
      </footer>
    </section>
  );
}
