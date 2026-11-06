"use client";

// Every page's ending: over the last stretch of scroll the page shrinks a little, lifts and rounds its corners,
// pulling up like a sheet to show the night-sky footer pinned underneath. A giant HAVEN rises out of the footer's
// floor as it opens. One scroll listener drives both; nothing loads from elsewhere.
//
// The pull-up moves the page with a transform, which would pin anything position: fixed inside it to the page
// instead of the screen. So the transform is only set while the page is pulling up (the app's phone tab bar then
// rides along on the page's bottom edge), and the landing page keeps its fixed nav outside.

import { FxLabel } from "@haven/ui";
import { ArrowUp } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { HavenLogo } from "./landing/Logo";
import { haven } from "@haven/core";
import { config } from "@/lib/config";
import "./site-footer.css";

/** Pixels of scroll, at the very end of the page, over which the page pulls up (less on a page with less scroll). */
const PULL_DISTANCE = 500;
const MAX_SHRINK = 0.08;
const MAX_LIFT_PX = 80;

/**
 * Wraps a page so it pulls up off the footer at the end of the scroll. `surface` is the page's own background (the
 * part that lifts); by default the app's sky-tinted page.
 */
export function PullUpFooter({ children, surface = "page-surface" }: { children: ReactNode; surface?: string }) {
  const content = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const distance = Math.min(PULL_DISTANCE, scrollable);
      const from = scrollable - distance;
      const y = window.scrollY;
      setProgress(distance > 0 && y > from ? Math.min((y - from) / distance, 1) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  useEffect(() => {
    const el = content.current;
    if (!el) return;
    const measure = () => setHeight(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = 1 - progress * MAX_SHRINK;
  // Scaling about the centre moves the bottom edge by an amount that depends on the page's height; the measured
  // height cancels that, so the visible lift is the same on every screen.
  const lift = Math.max(-160, Math.min(((1 - scale) * height) / 2 - progress * MAX_LIFT_PX, 320));

  const pulling = progress > 0;
  return (
    // The navy behind the page is what shows round it as it lifts: the footer's night sky.
    <div className="bg-[#0d1b33]">
      <div
        ref={content}
        className={`relative z-10 min-h-dvh overflow-clip ${surface}`}
        style={
          pulling
            ? {
                transform: `translateY(${lift}px) scale(${scale})`,
                borderRadius: `${Math.min(progress * 36, 36)}px`,
                boxShadow: `0 40px 90px -30px rgb(13 27 51 / ${0.55 * progress})`,
              }
            : undefined
        }
      >
        {children}
      </div>
      <SiteFooter progress={progress} />
    </div>
  );
}

/** Where to go next. The landing page's sections are in its own nav, so the footer doesn't repeat them. */
const LINKS = [
  { label: "Open Haven", href: "/drive/" },
  ...(haven.appRegistry ? [{ label: "Contracts on Etherscan", href: `${config.explorerUrl}/address/${haven.appRegistry}`, external: true }] : []),
  { label: "Source code", href: "https://github.com/Arav-Arun/ETHGlobalMumbai", external: true },
] as { label: string; href: string; external?: boolean }[];

function SiteFooter({ progress }: { progress: number }) {
  return (
    // Short enough that the lifted page keeps its lower half on screen at the very end of the scroll.
    <footer className="haven-footer sticky bottom-0 z-[5] flex min-h-[clamp(360px,50svh,420px)] flex-col overflow-hidden text-white">
      {/* The glow fades in from the footer's top edge, so the footer has no seam with the sky above it. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 mask-[linear-gradient(to_bottom,transparent,#000_40%)]">
        <div className="haven-footer-glow absolute left-1/2 top-1/2 h-[60vh] w-[80vw] -translate-x-1/2 -translate-y-1/2 rounded-[50%] blur-[80px]" />
      </div>
      <div aria-hidden className="haven-footer-grid pointer-events-none absolute inset-0" />

      {/* The giant lockup behind everything, sunk into the footer's floor: rises, grows and fades in as the page
          pulls up, and fades out toward the bottom edge. */}
      <div
        aria-hidden
        className="haven-footer-giant pointer-events-none absolute -bottom-[3vw] left-1/2 flex select-none items-center gap-[0.1em] whitespace-nowrap"
        style={{ transform: `translate(-50%, ${(1 - progress) * 10}vh) scale(${0.8 + 0.2 * progress})`, opacity: progress }}
      >
        <GhostMark />
        <span className="haven-footer-word">HAVEN</span>
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-10 gap-y-5 px-6 pt-8">
        <div className="flex flex-col gap-2">
          <Link href="/" aria-label="Haven home" className="self-start">
            <HavenLogo tone="light" size={30} />
          </Link>
          <p className="text-sm text-white/60">
            Built at ETHGlobal Mumbai 2026 by Team <strong className="font-semibold text-white">Deploy For Good</strong>
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[15px]">
          {LINKS.map(({ label, href, external }) =>
            external ? (
              <a key={label} href={href} target="_blank" rel="noreferrer noopener" className="text-white/65 transition-colors hover:text-white">
                {label}
              </a>
            ) : (
              <Link key={label} href={href} className="text-white/65 transition-colors hover:text-white">
                {label}
              </Link>
            ),
          )}
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="btn-clay fx inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
          >
            <FxLabel>
              Back to top <ArrowUp size={15} aria-hidden />
            </FxLabel>
          </button>
        </nav>
      </div>
    </footer>
  );
}

/** Haven's shield as a ghost in the same fade as the giant word (the two are the same height, so the fades line up). */
function GhostMark() {
  const mask = "url(/haven-mark.webp) center / contain no-repeat";
  return (
    <span
      className="inline-block h-[0.7em] w-[0.7em] shrink-0 bg-[linear-gradient(to_bottom,rgb(190_212_250/0.42),rgb(143_181_242/0)_90%)]"
      style={{ WebkitMask: mask, mask }}
    />
  );
}
