"use client";

// Two landing sections: what people keep in Haven, and the real screens from one "Try it" run on Sepolia
// (public/screens/*.webp, captured 7 Nov 2026). Every name, address and file in them is live onchain.

import { BriefcaseBusiness, FileHeart, FlaskConical, HeartHandshake, Newspaper } from "lucide-react";
import { useInView } from "./hooks";

const USES = [
  { icon: FileHeart, title: "Personal records", body: "IDs, medical and tax papers, kept encrypted and shared only when you choose." },
  { icon: BriefcaseBusiness, title: "Deals and data rooms", body: "Rooms with random names, so no one can tie a deal to you." },
  { icon: HeartHandshake, title: "Family and friends", body: "Hand over a document for a week, then it locks on its own." },
  { icon: FlaskConical, title: "Teams and research", body: "Share with everyone under a name like acme.eth, kept in sync." },
  { icon: Newspaper, title: "Sources and journalism", body: "Anonymous uploads prove a writer belongs, never which one." },
];

export function UseCases() {
  return (
    <section aria-labelledby="uses" className="mx-auto max-w-6xl px-5 pb-8 pt-16">
      <h2 id="uses" className="display mx-auto max-w-3xl text-center text-4xl text-[#0d1b33] sm:text-5xl">
        For anything you&apos;d rather not leave a trail.
      </h2>
      <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {USES.map(({ icon: Icon, title, body }) => (
          <li key={title} className="rounded-3xl bg-white p-5 shadow-[0_18px_44px_-30px_rgb(13_27_51_/_0.4)]">
            <span className="flex size-10 items-center justify-center rounded-xl bg-[#1f4fd1]/10 text-[#1f4fd1]">
              <Icon size={20} aria-hidden />
            </span>
            <p className="mt-4 font-semibold tracking-[-0.01em] text-[#0d1b33]">{title}</p>
            <p className="mt-1 text-[14px] leading-relaxed text-[#0d1b33]/65">{body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Shot({ src, alt, w, h, caption, className = "" }: { src: string; alt: string; w: number; h: number; caption: string; className?: string }) {
  return (
    <figure className={`flex flex-col gap-3 ${className}`}>
      <div className="overflow-hidden rounded-[22px] bg-white p-2 shadow-[0_30px_60px_-34px_rgb(13_27_51_/_0.55)] ring-1 ring-[#0d1b33]/[0.05]">
        {/* Static export: plain img, already WebP and sized. */}
        <img src={src} alt={alt} width={w} height={h} loading="lazy" decoding="async" className="h-auto w-full rounded-[16px]" />
      </div>
      <figcaption className="px-1 text-[15px] leading-snug text-[#0d1b33]/70">{caption}</figcaption>
    </figure>
  );
}

export function RealScreens() {
  const { ref, inView } = useInView<HTMLDivElement>(0.12);
  return (
    <section aria-labelledby="real" className="mx-auto max-w-6xl px-5 py-24 lg:py-28">
      <div className="mx-auto max-w-3xl text-center">
        <h2 id="real" className="display text-5xl text-[#0d1b33] sm:text-6xl">The real thing.</h2>
        <p className="mt-5 text-lg leading-relaxed text-[#0d1b33]/65">
          Screens from one run of Try it on Sepolia. The names, addresses and files are live onchain, not a mock-up.
        </p>
      </div>
      <div ref={ref} data-in={inView} className="reveal mt-14 grid items-start gap-6 lg:grid-cols-5">
        <Shot
          className="lg:col-span-3"
          src="/screens/public-view.webp"
          w={606}
          h={320}
          alt="Haven's Public view of a data room: what anyone can read onchain beside what the owner sees with their keys"
          caption="The Public view: two random addresses and padded files is all anyone can see. The names stay with you."
        />
        <Shot
          className="lg:col-span-2"
          src="/screens/share.webp"
          w={319}
          h={399}
          alt="The share dialog with an ENS name, its eight-word key check, a role and an end date"
          caption="Share with any ENS name. Eight words let you check their key in person."
        />
        <Shot
          className="lg:col-span-3"
          src="/screens/recipient.webp"
          w={614}
          h={292}
          alt="The recipient's view of the shared room, with both files and their ticket ending in 56 minutes"
          caption="The recipient opens the files. Their ticket ends on its own, with no transaction."
        />
        <Shot
          className="lg:col-span-2"
          src="/screens/stealth-address.webp"
          w={319}
          h={154}
          alt="Confirmation that the share appears onchain only as a new random address"
          caption="Onchain, the recipient is a new random address nobody can tie to their name."
        />
      </div>
    </section>
  );
}
