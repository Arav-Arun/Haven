"use client";

// The loading cover, on the first load of the site only: soft blue ink splashes out from the middle of the screen with
// no edges, Haven's shield and name settle in its centre, and the cover fades into the page. Moving between pages
// inside the app doesn't replay it. A click or Escape skips it; reduced motion gets the still logo instead.

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import "./intro.css";

/** How long the splash plays before the cover may leave. */
const REVEAL_MS = 1100;
/** The longest the finished logo waits for a slow page before fading anyway. */
const MAX_WAIT_MS = 10_000;
const FADE_MS = 700;
const MARK = "url(/haven-mark.webp) center / contain no-repeat";

export function Intro() {
  const pathname = usePathname();
  const [phase, setPhase] = useState<"show" | "leave" | "gone">("show");
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  /** A page change is under way and hasn't arrived yet. */
  const waiting = useRef(false);
  /** The reveal has finished. */
  const revealed = useRef(false);
  /** The page on screen, as the router last reported it. */
  const shownPath = useRef(pathname);

  const leave = useCallback(() => setPhase((p) => (p === "show" ? "leave" : p)), []);

  // Each cover: play the splash, then leave once the page underneath is there.
  useEffect(() => {
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let beat: ReturnType<typeof setTimeout> | undefined;
    const done = setTimeout(
      () => {
        revealed.current = true;
        // A short beat on the finished logo, then the fade. Still waiting: the page change below ends it.
        if (!waiting.current) beat = setTimeout(leave, still ? 600 : 200);
      },
      still ? 0 : REVEAL_MS,
    );
    const cap = setTimeout(leave, MAX_WAIT_MS);
    return () => {
      clearTimeout(done);
      clearTimeout(beat);
      clearTimeout(cap);
    };
  }, [leave]);

  // Escape skips it. Moving between pages inside the app never replays it: the app navigates without reloading, so
  // the cover is only for the very first load.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && leave();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leave]);

  // The first page changed while the cover was still up (a quick click): let it go.
  useEffect(() => {
    if (shownPath.current === pathname) return;
    shownPath.current = pathname;
    waiting.current = false;
    leave();
  }, [pathname, leave]);

  useEffect(() => {
    if (phase !== "leave") return;
    const t = setTimeout(() => setPhase("gone"), FADE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === "gone") return null;
  return (
    // Decoration only: screen readers go straight to the page. A fresh element per cover restarts the CSS safety net.
    <div aria-hidden className={`haven-intro${phase === "leave" ? " haven-intro-leave" : ""}`} onClick={leave}>
      <div className="haven-splash">
        <span className="splash-ink splash-ink-1" />
        <span className="splash-ink splash-ink-2" />
        <span className="splash-ink splash-ink-3" />
        <span className="splash-ink splash-ink-4" />
      </div>
      <div className="haven-intro-logo">
        <span className="haven-intro-mark" style={{ WebkitMask: MARK, mask: MARK }} />
        <span className="haven-intro-word">Haven</span>
      </div>
    </div>
  );
}
