"use client";

// The loading cover: on every page load and every move to another page, soft blue ink splashes out from the middle of
// the screen with no edges, Haven's shield and name settle in its centre, and the cover fades into the page. If the
// next page is still loading by then, the logo stays until it arrives (up to MAX_WAIT_MS). Clicking a link starts it
// at once, so it covers the load instead of following it. Opening a folder inside the same page and #section links
// don't trigger it. A click or Escape skips it; reduced motion gets the still logo instead.

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import "./intro.css";

/** How long the splash plays before the cover may leave. */
const REVEAL_MS = 1100;
/** The longest the finished logo waits for a slow page before fading anyway. */
const MAX_WAIT_MS = 10_000;
const FADE_MS = 700;
const MARK = "url(/haven-mark.webp) center / contain no-repeat";

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
  const start = useCallback((pageLoading: boolean) => {
    waiting.current = pageLoading;
    revealed.current = false;
    setPhase("show");
    setRun((r) => r + 1);
  }, []);

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
  }, [run, leave]);

  // Start on the click, before the next page loads; back and forward start as the history entry changes.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (linkTarget(e)) start(true);
    };
    // Back/forward between #sections of the same page isn't a page change.
    const onPop = () => pathOf(location.pathname) !== pathOf(shownPath.current) && start(true);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && leave();
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
    };
  }, [start, leave]);

  // The page changed: it has arrived. A change nothing announced (the app moving you after creating a room) gets a
  // cover of its own.
  useEffect(() => {
    if (shownPath.current === pathname) return;
    shownPath.current = pathname;
    if (phaseRef.current === "gone") {
      start(false);
      return;
    }
    waiting.current = false;
    if (revealed.current) leave();
  }, [pathname, start, leave]);

  useEffect(() => {
    if (phase !== "leave") return;
    const t = setTimeout(() => setPhase("gone"), FADE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === "gone") return null;
  return (
    // Decoration only: screen readers go straight to the page. A fresh element per cover restarts the CSS safety net.
    <div key={run} aria-hidden className={`haven-intro${phase === "leave" ? " haven-intro-leave" : ""}`} onClick={leave}>
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
