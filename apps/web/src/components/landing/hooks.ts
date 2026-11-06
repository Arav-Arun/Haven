"use client";

import { useEffect, useRef, useState } from "react";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(q.matches);
    const on = () => setReduced(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** True once the element has scrolled into view (stays true), or always when motion is reduced. */
export function useInView<T extends Element>(threshold = 0.25) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const o = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setInView(true);
          o.disconnect();
        }
      },
      { threshold },
    );
    o.observe(el);
    return () => o.disconnect();
  }, [threshold]);
  return { ref, inView };
}

/**
 * Steps through 0…count-1 every `ms` once `run` is true, then holds the last step for `holdMs` and starts over.
 * With reduced motion it shows the last (finished) step and never moves.
 */
export function useSteps(count: number, run: boolean, ms = 1100, holdMs = 2600): number {
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (reduced) {
      setStep(count - 1);
      return;
    }
    if (!run) return;
    const t = setTimeout(() => setStep((s) => (s + 1) % count), step === count - 1 ? holdMs : ms);
    return () => clearTimeout(t);
  }, [run, step, count, ms, holdMs, reduced]);
  return step;
}
