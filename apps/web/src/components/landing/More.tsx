"use client";

// The home page sections after the story: the four networks (and prize tracks), privacy and questions.
// Every sentence describes what the code does today.

import { ArrowUpRight, Check, Eye, EyeOff, Plus } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { useInView } from "./hooks";
import { FrontClouds } from "./Sky";
import { haven } from "@haven/core";
import { config } from "@/lib/config";



const TRACKS = [
  {
    name: "ENS",
    prize: "Best Use of ENSv2",
    logo: "/ens.webp",
    lead: "Every folder is its own ENSv2 registry.",
    points: [
      "Your name, yourname.haven.eth, points to your drive",
      "Each folder and room is its own ENSv2 registry, made by ENS's factory",
      "Roles from Enhanced Access Control that end on their own",
      "An access history any app can ask about any moment",
      "Everyone you share with gets a fresh stealth address, never their name",
      "Data rooms are random subnames under rooms.haven.eth",
      "A Permissioned Resolver per name holds your public key",
      "Share with everyone under a name, like acme.eth, kept in sync",
    ],
    span: "lg:col-span-2 lg:row-span-2",
    dark: true,
    cols: true,
  },
  {
    name: "Arkiv",
    prize: "Build on Arkiv",
    logo: "/arkive.png",
    lead: "The records that tie it all together.",
    points: [
      "Sealed file entries, key copies and invitations",
      "Entries expire with the access they serve",
      "A signed, hash-chained public key log for every name",
      "Every writer checked against onchain roles",
      "Writer groups for anonymous uploads, checked by zero-knowledge proofs",
      "Signed website releases and independent rebuilds",
    ],
    span: "lg:col-span-2",
    cols: true,
  },
  {
    name: "Swarm",
    prize: "Arkiv + Swarm bonus",
    logo: "/swarm.png",
    lead: "Encrypted bytes, live updates, the site itself.",
    points: [
      "Only padded ciphertext, at fixed sizes",
      "Referenced from sealed Arkiv entries",
      "Doorbells for live updates, topics change hourly",
      "Our own Bee node and postage batch",
      "Every release stored on Swarm, with haven.eth pointing to it",
    ],
    span: "",
  },
  {
    name: "Ethereum Foundation",
    prize: "Anon-RPC · CROPS",
    logo: "/eth.png",
    lead: "Private lookups. Keys stay yours.",
    points: [
      "Lookups go through Anon-RPC, one route per address and room",
      "Fluidkey stealth addresses for every share",
      "Receipts flag anything that had to go direct",
      "Signed, reproducible releases. No trackers. MIT",
    ],
    span: "",
  },
];

/** The deployed contracts behind the ENS card, from contracts/deployments/sepolia.json, each opened on Etherscan. */
const CONTRACTS = [
  { label: "haven.eth", note: "Where every name is claimed", address: haven.appRegistry, code: false },
  { label: "rooms.haven.eth", note: "Where data rooms are made", address: haven.roomsRegistry, code: false },
  { label: "DriveRegistry", note: "Each folder's registry, source verified", address: haven.driveRegistryImpl, code: true },
].filter((c): c is { label: string; note: string; address: `0x${string}`; code: boolean } => !!c.address);

function OnChain() {
  if (!CONTRACTS.length) return null;
  return (
    <div className="mt-auto pt-8">
      <p className="text-[14px] font-medium text-white/75">Live on Sepolia. Check it yourself.</p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-3">
        {CONTRACTS.map((c) => (
          <li key={c.label}>
            <a
              href={`${config.explorerUrl}/address/${c.address}${c.code ? "#code" : ""}`}
              target="_blank"
              rel="noreferrer noopener"
              className="group flex h-full flex-col rounded-2xl bg-white/12 p-4 ring-1 ring-white/20 transition-colors hover:bg-white/20"
            >
              <span className="flex items-center justify-between gap-2 font-semibold">
                {c.label}
                <ArrowUpRight size={16} className="opacity-70 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
              </span>
              <span className="mt-1 text-[13px] text-white/70">{c.note}</span>
              <span className="mt-3 font-mono text-[12px] text-white/60">
                {c.address.slice(0, 6)}…{c.address.slice(-4)}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Tracks() {
  const { ref, inView } = useInView<HTMLDivElement>(0.15);
  return (
    <section id="tracks" className="mx-auto max-w-6xl scroll-mt-28 px-5 py-24 lg:py-32">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="display text-5xl text-[#0d1b33] sm:text-6xl">Four open networks. One private drive.</h2>
        <p className="mt-5 text-lg leading-relaxed text-[#0d1b33]/65">
          Haven is private file storage and sharing for anything: encrypted on your device, shared by name through addresses nobody can trace, with access that ends on its own. Each network does real work in it.
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
            <ul className={`mt-5 flex flex-col gap-3 ${t.cols ? "sm:grid sm:grid-cols-2 sm:gap-x-6" : ""}`}>
              {t.points.map((p) => (
                <li key={p} className={`flex gap-2.5 text-[15px] leading-snug ${t.dark ? "text-white/90" : "text-[#0d1b33]/75"}`}>
                  <Check size={17} className={`mt-0.5 shrink-0 ${t.dark ? "" : "text-[#1f4fd1]"}`} />
                  {p}
                </li>
              ))}
            </ul>
            {t.dark && <OnChain />}
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
  "Who looked something up: lookups go through a private network, and any that go direct are marked",
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



const FAQ = [
  ["Can Haven read my files?", "No. Each file is encrypted on your device with its own key before it's uploaded. Swarm stores only padded ciphertext, and our API never sees a file, a key, or who you shared with."],
  ["What does the person I share with need?", "An ENS name with a Haven key: a name they claim in Haven, or an ENS name they already own, linked in Settings. They open what you shared in the browser, on their phone or on their phone."],
  ["What happens when access ends?", "Their role ends onchain on the date you set, and their keys stop at that moment, so every file added afterwards is locked for them. No transaction is needed. What they already opened, they keep, as with any file you share."],
  ["Can anyone tell who I shared with?", "No. Each person appears onchain as a new random address that only you and they can link to their name. A data room isn't linked to you at all. The Public view shows exactly what anyone can see."],
  ["Do I need a wallet or crypto?", "No. Try it creates keys without a wallet. With a wallet you sign one message, and the gas for your name and folders is covered on the test networks."],
  ["What if your servers go away?", "Your files and records live on Sepolia, Arkiv and Swarm, not on our servers. Every website release is signed and stored on Swarm, with haven.eth pointing to it, and the whole stack is open source (MIT), so anyone can run it."],
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

