"use client";

// "Features": a tab per thing Haven does, each with a small animated slice of the real screens.
// Tabs advance on their own while the section is on screen; clicking one stops that.

import { AtSign, BadgeCheck, Clock3, Eye, Fingerprint, Radio, Share2, ShieldAlert, Users } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useInView, useReducedMotion, useSteps } from "./hooks";
import { Clouds } from "./Sky";

const DURATION = 7000;

function Window({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-[0_30px_60px_-30px_rgb(13_27_51_/_0.55)]">
      <div className="flex items-center gap-2 border-b border-[#0d1b33]/[0.06] px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-[#0d1b33]/10" />
        <span className="size-2.5 rounded-full bg-[#0d1b33]/10" />
        <span className="size-2.5 rounded-full bg-[#0d1b33]/10" />
        <span className="ml-2 text-[12px] font-medium text-[#0d1b33]/55">{title}</span>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  );
}

function Row({ children, tone = "plain", show = true }: { children: ReactNode; tone?: "plain" | "good" | "bad" | "blue"; show?: boolean }) {
  const tones = {
    plain: "bg-[#f3f6fb] text-[#0d1b33]",
    good: "bg-[#e7f5ee] text-[#155a3d]",
    bad: "bg-[#fdeceb] text-[#a3261d]",
    blue: "bg-[#e8efff] text-[#173f9e]",
  } as const;
  if (!show) return null;
  return <div className={`pop flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-[13px] ${tones[tone]}`}>{children}</div>;
}

const WORDS = ["maple", "harbor", "violin", "pebble", "summit", "otter", "velvet", "comet"];

function ShareMock({ s }: { s: number }) {
  return (
    <Window title="Share “Series A”">
      <div className="flex items-center rounded-xl border border-[#0d1b33]/10 px-3 py-2.5 text-[14px]">
        <span className="font-medium">investor.eth</span>
        <BadgeCheck size={16} className="ml-auto text-[#1d6b4b]" />
      </div>
      <p className="mt-3 text-[12px] font-medium text-[#0d1b33]/50">Their key, as eight words to compare in person</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {WORDS.map((w) => (
          <span key={w} className="rounded-md bg-[#f3f6fb] px-2 py-1 text-[12px] font-medium">{w}</span>
        ))}
      </div>
      <div className="mt-3 flex gap-2 text-[12px] font-medium">
        <span className="rounded-lg bg-[#f3f6fb] px-2.5 py-1.5">Can view</span>
        <span className="rounded-lg bg-[#f3f6fb] px-2.5 py-1.5">Until Friday</span>
        <span className="rounded-lg bg-[#f3f6fb] px-2.5 py-1.5">Hidden from members</span>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <Row tone="good" show={s >= 1}>
          <BadgeCheck size={15} /> Shared. investor.eth holds a ticket until Friday.
        </Row>
        <Row tone="blue" show={s >= 2}>
          <Eye size={15} /> On the chain: one new random address. Nothing says it&apos;s them.
        </Row>
      </div>
    </Window>
  );
}

function ExpiryMock({ s }: { s: number }) {
  return (
    <Window title="Series A · as investor.eth sees it">
      <div className="relative h-10">
        <div className="absolute inset-x-0 top-4 h-1.5 rounded-full bg-[#0d1b33]/10" />
        <div className="absolute left-0 top-4 h-1.5 rounded-full bg-[#1f4fd1] transition-[width] duration-700" style={{ width: s >= 1 ? "100%" : "62%" }} />
        <div className="absolute left-[62%] top-0 flex -translate-x-1/2 flex-col items-center">
          <span className="whitespace-nowrap rounded-md bg-[#0d1b33] px-1.5 py-0.5 text-[10px] font-semibold text-white">Access ends</span>
        </div>
      </div>
      <div className="mt-2 flex flex-col gap-2">
        <Row>
          <BadgeCheck size={15} className="text-[#1d6b4b]" /> Deck.pdf <span className="ml-auto text-[#0d1b33]/50">Opens</span>
        </Row>
        <Row>
          <BadgeCheck size={15} className="text-[#1d6b4b]" /> Financials.xlsx <span className="ml-auto text-[#0d1b33]/50">Opens</span>
        </Row>
        <Row tone="bad" show={s >= 1}>
          <ShieldAlert size={15} /> Final terms.pdf <span className="ml-auto">Locked: added after access ended</span>
        </Row>
        <Row tone="blue" show={s >= 2}>
          <Clock3 size={15} /> No transaction needed. Their keys simply stop at the end date.
        </Row>
      </div>
    </Window>
  );
}

function TeamMock({ s }: { s: number }) {
  return (
    <Window title="Members · Q3 board pack">
      <Row tone="blue">
        <AtSign size={15} /> Everyone at <b>acme.eth</b> <span className="ml-auto text-[12px]">synced just now</span>
      </Row>
      <div className="mt-2 flex flex-col gap-2">
        <Row>priya.acme.eth <span className="ml-auto text-[#0d1b33]/50">Can edit</span></Row>
        <Row>raj.acme.eth <span className="ml-auto text-[#0d1b33]/50">Can edit</span></Row>
        {s < 1 ? (
          <Row>dev.acme.eth <span className="ml-auto text-[#0d1b33]/50">Can edit</span></Row>
        ) : (
          <Row tone="bad">dev.acme.eth left the team in ENS <span className="ml-auto">Removed, keys changed</span></Row>
        )}
        <Row tone="good" show={s >= 2}>
          <Users size={15} /> Your “Partners” group works the same way, and subfolders can follow their parent.
        </Row>
      </div>
    </Window>
  );
}

function PublicMock({ s }: { s: number }) {
  const seen = ["This room exists, made 3 Nov", "3 addresses hold access, 1 ends Friday", "4 files, about 6 MB padded"];
  const hidden = ["Who the 3 members are", "File names and real sizes", "Who owns the room"];
  return (
    <Window title="Public view · a data room">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className={`rounded-xl p-3 transition-colors duration-500 ${s === 0 ? "bg-[#f3f6fb]" : "bg-white ring-1 ring-[#0d1b33]/[0.06]"}`}>
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-[#0d1b33]/60"><Eye size={14} /> Anyone can see</p>
          <ul className="mt-2 flex flex-col gap-1.5 text-[13px]">{seen.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
        <div className={`rounded-xl p-3 transition-colors duration-500 ${s >= 1 ? "bg-[#1f4fd1] text-white" : "bg-[#f3f6fb]"}`}>
          <p className="flex items-center gap-1.5 text-[12px] font-semibold opacity-80"><ShieldAlert size={14} /> Nobody else can see</p>
          <ul className="mt-2 flex flex-col gap-1.5 text-[13px]">{hidden.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      </div>
      <Row tone="blue" show={s >= 2}>
        <Eye size={15} /> Read live from ENS, Arkiv and Swarm: the same view anyone can check.
      </Row>
    </Window>
  );
}

function KeyLogMock({ s }: { s: number }) {
  return (
    <Window title="investor.eth · public key log">
      <div className="flex flex-wrap gap-1.5">
        {WORDS.map((w) => (
          <span key={w} className="rounded-md bg-[#e8efff] px-2 py-1 text-[12px] font-semibold text-[#173f9e]">{w}</span>
        ))}
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <Row><Fingerprint size={15} /> Key published <span className="ml-auto text-[#0d1b33]/50">1</span></Row>
        <Row show={s >= 1}><Fingerprint size={15} /> New device: Chrome on macOS <span className="ml-auto text-[#0d1b33]/50">2</span></Row>
        <Row tone="bad" show={s >= 2}><ShieldAlert size={15} /> An entry signed by someone else: ignored</Row>
      </div>
    </Window>
  );
}

function VerifyMock({ s }: { s: number }) {
  const ok = s < 2;
  return (
    <Window title={ok ? "haven app" : "haven app (swapped files)"}>
      <div className={`flex items-center gap-3 rounded-xl px-3.5 py-3 text-[13px] ${s === 0 ? "bg-[#f3f6fb]" : ok ? "bg-[#e7f5ee] text-[#155a3d]" : "bg-[#fdeceb] text-[#a3261d]"}`}>
        {s === 0 ? <Radio size={16} className="text-[#1f4fd1]" /> : ok ? <BadgeCheck size={16} /> : <ShieldAlert size={16} />}
        <div>
          <p className="font-semibold">{s === 0 ? "Rebuilding this commit from source…" : ok ? "Matches signed release" : "This build doesn't match any signed release"}</p>
          <p className="opacity-75">{s === 0 ? "Comparing every file with the release signed on Arkiv" : ok ? "The same files haven.eth points to on Swarm." : "Use the signed copy on Swarm instead."}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-6 gap-1.5">
        {Array.from({ length: 18 }, (_, i) => (
          <span key={i} className={`h-2 rounded-full transition-colors duration-500 ${s === 0 ? "bg-[#0d1b33]/10" : !ok && i === 7 ? "bg-[#d9473b]" : "bg-[#3aa17a]"}`} />
        ))}
      </div>
    </Window>
  );
}

function LiveMock({ s }: { s: number }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Window title="Your laptop">
        <Row tone={s >= 1 ? "good" : "plain"}>{s >= 1 ? <BadgeCheck size={15} /> : <Share2 size={15} />} Q3 numbers.pdf</Row>
        <p className="mt-2 text-[12px] text-[#0d1b33]/55">{s >= 1 ? "Uploaded, doorbell rung" : "Uploading…"}</p>
      </Window>
      <Window title="Their phone">
        {s >= 2 ? <Row tone="blue"><Radio size={15} /> Q3 numbers.pdf</Row> : <Row>Waiting…</Row>}
        <p className="mt-2 text-[12px] text-[#0d1b33]/55">{s >= 2 ? "Appeared in seconds, checked on Arkiv" : "Listening on this epoch's topic"}</p>
      </Window>
    </div>
  );
}

const TABS: {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  track: { name: string; logo: string };
  title: string;
  points: string[];
  Mock: ComponentType<{ s: number }>;
}[] = [
  { id: "share", label: "Share by name", icon: Share2, track: { name: "ENSv2", logo: "/ens.webp" }, title: "Share with an ENS name. Nobody sees who.", points: ["Type a name; their key is checked first", "They get a fresh random address and a sealed invitation", "Pick viewer, editor or manager, and an end date"], Mock: ShareMock },
  { id: "expiry", label: "Access ends", icon: Clock3, track: { name: "ENSv2 roles", logo: "/ens.webp" }, title: "Access that ends on its own.", points: ["Roles end onchain on the date you pick", "Keys move forward every hour; theirs stop at the end", "New files lock for them, with no transaction"], Mock: ExpiryMock },
  { id: "teams", label: "Teams and groups", icon: Users, track: { name: "ENS subnames", logo: "/ens.webp" }, title: "Share with a whole team, privately.", points: ["“Everyone at acme.eth” follows the team's ENS names", "Leave the team in ENS and access goes too", "The rule stays encrypted: the chain never learns the team"], Mock: TeamMock },
  { id: "public", label: "Public view", icon: Eye, track: { name: "Arkiv + Swarm", logo: "/arkive.png" }, title: "See exactly what the world sees.", points: ["Every folder shows what's public about it", "Members, names and contents are not in it", "Read live, so you can check it yourself"], Mock: PublicMock },
  { id: "keylog", label: "Key log", icon: Fingerprint, track: { name: "Arkiv", logo: "/arkive.png" }, title: "A public key log for every name.", points: ["Each name's keys, signed and in order, on Arkiv", "Compare eight words in person to be sure", "Forged entries are shown, and ignored"], Mock: KeyLogMock },
  { id: "verify", label: "Signed releases", icon: BadgeCheck, track: { name: "Ethereum Foundation", logo: "/eth.png" }, title: "Every release is signed and on Swarm.", points: ["Each build is signed and recorded on Arkiv", "haven.eth points to the exact files on Swarm", "Anyone can rebuild a commit and check it matches"], Mock: VerifyMock },
  { id: "live", label: "Live updates", icon: Radio, track: { name: "Swarm", logo: "/swarm.png" }, title: "New files appear in seconds.", points: ["A Swarm doorbell rings when something changes", "Its topic changes every hour, for members only", "Nothing shows until Arkiv confirms it"], Mock: LiveMock },
];

function Panel({ tab, run }: { tab: (typeof TABS)[number]; run: boolean }) {
  const s = useSteps(3, run, DURATION / 3.2, DURATION);
  const { Mock } = tab;
  return (
    <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-14">
      <div>
        <p className="flex items-center gap-2 text-[15px] font-medium text-[#0d1b33]/60">
          <Image src={tab.track.logo} width={22} height={22} alt="" className="rounded-md" />
          {tab.track.name}
        </p>
        <h3 className="display mt-4 text-4xl text-[#0d1b33] sm:text-5xl">{tab.title}</h3>
        <ol className="mt-8 flex flex-col gap-2">
          {tab.points.map((p, i) => (
            <li
              key={p}
              className={`flex items-center gap-3.5 rounded-2xl px-4 py-3.5 text-[16px] transition-all duration-500 ${i === s ? "bg-white text-[#0d1b33] shadow-[0_14px_34px_-18px_rgb(13_27_51_/_0.35)]" : "text-[#0d1b33]/55"}`}
            >
              <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold transition-colors ${i <= s ? "bg-[#1f4fd1] text-white" : "border border-[#0d1b33]/20"}`}>
                {i + 1}
              </span>
              {p}
            </li>
          ))}
        </ol>
      </div>
      <div className="sky-card relative overflow-hidden rounded-[32px] px-5 pb-10 pt-12 sm:px-10 sm:pt-16">
        <Clouds />
        <div className="relative z-30">
          <Mock s={s} />
        </div>
      </div>
    </div>
  );
}

export function Tour() {
  const { ref, inView } = useInView<HTMLDivElement>(0.3);
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [auto, setAuto] = useState(true);
  const playing = inView && auto && !reduced;
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setIndex((i) => (i + 1) % TABS.length), DURATION);
    return () => clearTimeout(t);
  }, [playing, index]);
  // Keep the active tab in view on narrow screens, without moving the page.
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = strip.current;
    const btn = box?.querySelectorAll("button")[index];
    if (box && btn) box.scrollTo({ left: btn.offsetLeft - box.clientWidth / 2 + btn.clientWidth / 2, behavior: "smooth" });
  }, [index]);
  const tab = TABS[index]!;
  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-28 px-5 py-24 lg:py-32">
      <div className="mx-auto max-w-4xl text-center">
        <h2 className="display text-5xl text-[#0d1b33] sm:text-6xl">Private by design. Simple to use.</h2>
        <p className="mt-5 text-lg leading-relaxed text-[#0d1b33]/65">Everything Haven does, one feature at a time.</p>
      </div>
      <div ref={ref} className="mt-12">
        <div ref={strip} className="mx-auto w-fit max-w-full overflow-x-auto rounded-full bg-white p-1.5 shadow-[0_14px_40px_-24px_rgb(13_27_51_/_0.4)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div role="tablist" aria-label="Features" className="flex gap-1">
            {TABS.map((t, i) => {
              const I = t.icon;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={i === index}
                  onClick={() => (setIndex(i), setAuto(false))}
                  className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2.5 text-[15px] font-medium transition-colors ${i === index ? "bg-[#1f4fd1] text-white" : "text-[#0d1b33]/65 hover:text-[#0d1b33]"}`}
                >
                  <I size={16} />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="mx-auto mt-4 flex max-w-3xl gap-2 px-6" aria-hidden>
          {TABS.map((t, i) => (
            <div key={t.id} className="tab-bar flex-1">
              <span
                key={`${i}-${index}-${playing}`}
                style={
                  i < index
                    ? { transform: "scaleX(1)" }
                    : i === index
                      ? playing
                        ? { animation: `fill ${DURATION}ms linear both` }
                        : { transform: "scaleX(1)" }
                      : { transform: "scaleX(0)" }
                }
              />
            </div>
          ))}
        </div>
        <div role="tabpanel" className="mt-14" key={tab.id}>
          <Panel tab={tab} run={inView} />
        </div>
      </div>
    </section>
  );
}
