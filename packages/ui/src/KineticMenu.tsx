"use client";

// The app's main menu, in place of a sidebar: a "Menu" button opens a panel that slides in from the right in three
// layers (sky, deep blue, then the page), the screens roll up into place, and hovering one wakes its own shape in
// the background. Motion is CSS (styles.css, "Kinetic menu"); the states are:
//   closed  → hidden, everything reset to its starting place without animating
//   open    → layers slide in, links roll up, the rest fades in
//   closing → the whole panel slides out together, then it's closed again
// It is a modal <dialog>: the browser's top layer puts it above everything (even a page that's mid pull-up), keeps
// focus inside, makes the page behind inert and turns Escape into a cancel we animate.

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { LinkLike, NavItem } from "./AppShell";
import { cx } from "./format";

type State = "closed" | "open" | "closing";
const CLOSE_MS = 700;

/** Delay index for staggered CSS transitions. */
const at = (i: number) => ({ "--i": i }) as CSSProperties;

// One background shape per screen, in the sky palette, in nav order: My drive, Rooms, Shared, Groups, Settings.
// Each piece pops in on its own delay.
const SHAPES: ReactNode[] = [
  // My drive: clouds (where the files live)
  <>
    {[
      [110, 120, 70, 0.35],
      [170, 100, 60, 0.3],
      [230, 125, 55, 0.35],
      [270, 290, 80, 0.25],
      [340, 270, 55, 0.3],
      [80, 320, 45, 0.22],
    ].map(([cx, cy, r, o], i) => (
      <circle key={i} className="shape-el" style={at(i)} cx={cx} cy={cy} r={r} fill={`rgb(143 181 242 / ${o})`} />
    ))}
  </>,
  // Rooms: Haven's doorway and keyhole
  <>
    <path className="shape-el" style={at(0)} d="M110 340V200a100 100 0 0 1 200 0v140" fill="none" stroke="rgb(31 79 209 / 0.14)" strokeWidth="44" strokeLinecap="round" />
    <circle className="shape-el" style={at(1)} cx="210" cy="215" r="30" fill="rgb(63 120 227 / 0.22)" />
    <path className="shape-el" style={at(2)} d="M196 232h28l10 70h-48z" fill="rgb(63 120 227 / 0.22)" />
  </>,
  // Shared: access tickets (rotation on an outer group, so the animated transform doesn't replace it)
  <>
    {[
      [60, 70, -12],
      [190, 160, 8],
      [90, 260, -4],
    ].map(([x, y, rot], i) => (
      <g key={i} transform={`rotate(${rot} ${x! + 90} ${y! + 45})`}>
        <g className="shape-el" style={at(i)}>
          <rect x={x} y={y} width="180" height="90" rx="16" fill="rgb(31 79 209 / 0.1)" />
          <line x1={x! + 52} y1={y! + 12} x2={x! + 52} y2={y! + 78} stroke="rgb(31 79 209 / 0.25)" strokeWidth="3" strokeDasharray="4 6" />
        </g>
      </g>
    ))}
  </>,
  // Groups: orbit rings
  <>
    {[150, 110, 70, 30].map((r, i) => (
      <circle key={r} className="shape-el" style={at(i)} cx="220" cy="200" r={r} stroke={`rgb(63 120 227 / ${0.12 + i * 0.05})`} strokeWidth="14" fill="none" />
    ))}
  </>,
  // Settings: a grid of dots
  <>
    {Array.from({ length: 16 }, (_, i) => (
      <circle
        key={i}
        className="shape-el"
        style={at(i)}
        cx={70 + (i % 4) * 90}
        cy={70 + Math.floor(i / 4) * 90}
        r={6 + ((i * 7) % 4) * 3}
        fill={`rgb(${i % 2 ? "63 120 227" : "143 181 242"} / 0.35)`}
      />
    ))}
  </>,
];

/** The "Menu" button and the panel it opens. `footer` sits at the bottom of the panel (the account, the network). */
export function KineticMenu({ items, Link, footer }: { items: NavItem[]; Link: LinkLike; footer?: ReactNode }) {
  const [state, setState] = useState<State>("closed");
  const [shape, setShape] = useState<number | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const open = state === "open";

  const show = () => {
    const d = dialog.current;
    if (!d || d.open) return;
    d.showModal();
    // One frame in the starting positions, then the open state animates from them.
    requestAnimationFrame(() => requestAnimationFrame(() => setState("open")));
  };
  const close = useCallback(() => setState((s) => (s === "open" ? "closing" : s)), []);

  useEffect(() => {
    if (state !== "closing") return;
    const t = setTimeout(() => {
      setState("closed");
      setShape(null);
      dialog.current?.close();
      button.current?.focus();
    }, CLOSE_MS);
    return () => clearTimeout(t);
  }, [state]);

  // While open: no page scroll behind it, and focus on the screen you're on.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    const focus = setTimeout(
      () => (dialog.current?.querySelector<HTMLElement>('[aria-current="page"]') ?? dialog.current?.querySelector<HTMLElement>(".kinetic-link"))?.focus(),
      450,
    );
    return () => {
      root.style.overflow = before;
      clearTimeout(focus);
    };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        onClick={show}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="kinetic-toggle inline-flex items-center gap-2 rounded-lg px-1 py-2 text-[15px] font-semibold text-ink transition-colors hover:text-action"
      >
        <span className="kinetic-toggle-text" aria-hidden>
          <span>Menu</span>
          <span>Close</span>
        </span>
        <span className="sr-only">Menu</span>
        <svg viewBox="0 0 16 16" className="kinetic-toggle-icon size-3.5" aria-hidden>
          <path d="M7.33 16V0h1.34v16z M16 8.67H0V7.33h16z" fill="currentColor" />
        </svg>
      </button>

      <dialog
        ref={dialog}
        aria-label="Menu"
        className="kinetic-dialog"
        onCancel={(e) => {
          // Escape: animate out instead of vanishing.
          e.preventDefault();
          close();
        }}
        onClose={() => setState("closed")}
      >
        <div className="kinetic-menu" data-state={state}>
          <div className="kinetic-overlay" onClick={close} />
          <div className="kinetic-panel">
            <div className="kinetic-layer" style={at(0)} />
            <div className="kinetic-layer" style={at(1)} />
            <div className="kinetic-layer kinetic-layer-page" style={at(2)}>
              {SHAPES.map((s, i) => (
                <svg key={i} viewBox="0 0 400 400" className="kinetic-shape" data-active={shape === i || undefined} aria-hidden>
                  {s}
                </svg>
              ))}
            </div>

            <nav aria-label="Main" className="kinetic-content">
              <div className="kinetic-fade flex items-center justify-between" style={at(0)}>
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-action">Menu</span>
                <button onClick={close} aria-label="Close menu" className="btn-clay inline-flex size-10 items-center justify-center rounded-full">
                  <X size={18} aria-hidden />
                </button>
              </div>
              <ul className="mt-8 flex flex-col">
                {items.map((n, i) => (
                  <li
                    key={n.href}
                    className="kinetic-item"
                    style={at(i)}
                    onMouseEnter={() => setShape(i % SHAPES.length)}
                    onMouseLeave={() => setShape(null)}
                    onFocus={() => setShape(i % SHAPES.length)}
                    onBlur={() => setShape(null)}
                    onClick={close}
                  >
                    <Link href={n.href} aria-current={n.active ? "page" : undefined} className={cx("kinetic-link", n.active && "is-current")}>
                      <span className="kinetic-link-index">0{i + 1}</span>
                      <span className="kinetic-link-text">{n.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {footer && (
                <div className="kinetic-fade mt-auto pt-10" style={at(1)}>
                  {footer}
                </div>
              )}
            </nav>
          </div>
        </div>
      </dialog>
    </>
  );
}
