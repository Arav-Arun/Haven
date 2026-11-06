"use client";

// The loading cover: on every page load and every move to another page, a drop of clear glass lands over the screen,
// spreads into a tile, holds Haven's logo while its rim bends it into colour, then lets go. If the next page is still
// loading by then, the logo stays until it arrives (up to MAX_WAIT_MS); then the cover fades into the page.
// Clicking a link starts it at once, so it covers the load instead of following it. Opening a folder inside the same
// page and #section links don't trigger it. A click or Escape skips it; reduced motion gets the still logo instead.

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { LIGHT_GLASS, playGlassReveal, prepareLogo, type GlassSettings, type LogoData } from "./glass";
import "./intro.css";

/** The page colour (styles.css --color-paper): the canvas paints it, so the fade at the end is seamless. */
const PAGE = "#eef3fa";

const SETTINGS: GlassSettings = { ...LIGHT_GLASS, background: PAGE, tileSize: 360, logoScale: 0.66, finalScale: 0.8 };
const SPEED = 1.2;
/** The longest the finished logo waits for a slow page before fading anyway. */
const MAX_WAIT_MS = 10_000;
const FADE_MS = 450;

// Haven's mark as HavenMark draws it: the blue clay tile and its shine, with the shield (public/haven-mark.webp, white
// on transparent) on top at the same share of the tile.
const TILE = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 64 64"><defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b93ff"/><stop offset="1" stop-color="#1f4fd1"/></linearGradient><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.45"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect width="64" height="64" rx="18" fill="url(#t)"/><rect width="64" height="64" rx="18" fill="url(#s)"/></svg>`;
const SHIELD_SHARE = 0.66;

/** The mark and "Haven" side by side, in the page's own font, as on the landing page's nav. */
async function drawHavenLogo(): Promise<HTMLCanvasElement> {
  const tile = new Image();
  tile.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(TILE)}`;
  const shield = new Image();
  shield.src = "/haven-mark.webp";
  await Promise.all([tile.decode(), shield.decode()]);

  const size = 512;
  const fontPx = Math.round(size * 0.62);
  const gap = Math.round(size * 0.3);
  const family = getComputedStyle(document.documentElement).getPropertyValue("--font-hanken").trim() || "sans-serif";
  const font = `700 ${fontPx}px ${family}`;
  await document.fonts.load(font).catch(() => undefined);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const setText = () => {
    ctx.font = font;
    ctx.letterSpacing = `${-0.03 * fontPx}px`;
  };
  setText();
  const textWidth = Math.ceil(ctx.measureText("Haven").width);
  canvas.width = size + gap + textWidth + 32;
  canvas.height = size;
  setText(); // resizing the canvas resets its state
  ctx.drawImage(tile, 0, 0, size, size);
  const m = size * SHIELD_SHARE;
  ctx.drawImage(shield, (size - m) / 2, (size - m) / 2, m, m);
  ctx.fillStyle = "#0d1b33";
  ctx.textBaseline = "middle";
  ctx.fillText("Haven", size + gap, size / 2 + fontPx * 0.04);
  return canvas;
}

// Drawn and turned into textures once per page load (~100 ms); every later cover reuses it.
let logoJob: Promise<LogoData> | null = null;
function havenLogo() {
  logoJob ??= drawHavenLogo().then(prepareLogo);
  logoJob.catch(() => (logoJob = null));
  return logoJob;
}

// Start drawing the logo the moment this script runs, not after React has started the page: the glass can then
// appear on the first frame the cover is live.
if (typeof window !== "undefined") void havenLogo().catch(() => undefined);

const pathOf = (p: string) => p.replace(/\/+$/, "") || "/";

/** The page a plain left click on this link would open, or null when it stays on this page or leaves the app. */
function linkTarget(e: MouseEvent): string | null {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const a = (e.target as Element | null)?.closest?.("a[href]");
  if (!(a instanceof HTMLAnchorElement)) return null;
  if ((a.target && a.target !== "_self") || a.hasAttribute("download")) return null;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return null;
  const to = pathOf(url.pathname);
  return to === pathOf(location.pathname) ? null : to;
}

export function Intro() {
  const pathname = usePathname();
  const wrap = useRef<HTMLDivElement>(null);
  const [run, setRun] = useState(0);
  const [phase, setPhase] = useState<"show" | "leave" | "gone">("show");
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  /** A page change is under way and hasn't arrived yet. */
  const waiting = useRef(false);
  /** This cover's reveal has finished. */
  const revealed = useRef(false);
  /** The page on screen, as the router last reported it. */
  const shownPath = useRef(pathname);

  const leave = useCallback(() => setPhase((p) => (p === "show" ? "leave" : p)), []);
  const engine = useRef<ReturnType<typeof playGlassReveal>>(null);
  /** The normal ending: the logo blurs away into the backdrop in the glass itself, then the cover fades. A click,
   * Escape or the long-wait cap skip straight to the fade. */
  const finishOut = useCallback(() => {
    if (engine.current) engine.current.outro(leave);
    else leave();
  }, [leave]);
  const start = useCallback((pageLoading: boolean) => {
    waiting.current = pageLoading;
    revealed.current = false;
    setPhase("show");
    setRun((r) => r + 1);
  }, []);

  // Each cover: play the reveal, then leave once the page underneath is there.
  useEffect(() => {
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cancelled = false;
    let beat: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      revealed.current = true;
      // A short beat on the finished logo, then the fade. Still waiting: the page change below ends it.
      if (!waiting.current) beat = setTimeout(finishOut, still ? 900 : 250);
    };
    const cap = setTimeout(leave, MAX_WAIT_MS);
    havenLogo()
      .then((logo) => {
        if (cancelled || !wrap.current) return;
        engine.current = playGlassReveal(wrap.current, logo, SETTINGS, SPEED, finish, still);
        if (!engine.current) finish();
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) finish();
      });
    return () => {
      cancelled = true;
      engine.current?.dispose();
      engine.current = null;
      clearTimeout(beat);
      clearTimeout(cap);
    };
  }, [run, leave, finishOut]);

  // A page-load animation only: moving between pages inside the app never replays it. Escape skips it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && leave();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leave]);

  // The page changed while the first cover was still up (a quick click): let it go.
  useEffect(() => {
    if (shownPath.current === pathname) return;
    shownPath.current = pathname;
    waiting.current = false;
    if (phaseRef.current !== "gone") finishOut();
  }, [pathname, finishOut]);

  useEffect(() => {
    if (phase !== "leave") return;
    const t = setTimeout(() => setPhase("gone"), FADE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === "gone") return null;
  return (
    // Decoration only: screen readers go straight to the page. A fresh element per cover restarts the CSS safety net.
    <div key={run} aria-hidden className={`haven-intro${phase === "leave" ? " haven-intro-leave" : ""}`} onClick={leave}>
      <div ref={wrap} className="absolute inset-0" />
    </div>
  );
}
