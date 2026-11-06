"use client";

// A dialog summoned out of cloud: 34 small cumulus puffs drift in from the sky, gather, then press out onto the
// dialog's walls and corners, swell, bleach to pure white and flatten against its rounded edge until they are one
// solid white card. Only then does the real dialog surface take over underneath and the form glide in.
//
// The dialog stays fully transparent (no surface, border or shadow) until the clouds have fused, so there is never a
// faint box behind them. Everything is driven by one animation frame loop; nothing animates afterwards.

import { useEffect, useId, useRef, type RefObject } from "react";

const DURATION = 1300;
/** The dialog's own corner radius (rounded-3xl), so the fused clouds hand over to exactly its shape. */
const RADIUS = 24;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const eo = (x: number) => 1 - (1 - x) ** 3;
const eio = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);

/** A small deterministic random source, so the sky is the same on every open. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Three cumulus shapes, as lobes [x, y, r] around the puff's centre (about 150 x 100 px at scale 1): flat-ish
// underneath, heaped on top.
const LOBES: [number, number, number][][] = [
  [[-46, 10, 27], [-14, -12, 36], [28, 0, 31], [-24, 20, 25], [16, 22, 26], [52, 16, 20]],
  [[-50, 14, 22], [-22, -6, 31], [10, -16, 35], [42, 4, 27], [-6, 20, 27], [30, 22, 22]],
  [[-40, 6, 30], [-6, -14, 30], [26, -6, 33], [56, 14, 19], [-18, 22, 26], [20, 22, 26]],
];

interface Puff {
  shape: number;
  start: [number, number];
  cluster: [number, number];
  final: [number, number];
  delay: number;
  s0: number;
}

/** Points spaced evenly round a rectangle inset `d` from the dialog's edge, starting at its top-left corner. */
function perimeter(w: number, h: number, d: number, n: number, phase: number): [number, number][] {
  const iw = Math.max(1, w - 2 * d);
  const ih = Math.max(1, h - 2 * d);
  const total = 2 * (iw + ih);
  return Array.from({ length: n }, (_, i) => {
    let s = ((i + phase) / n) * total;
    if (s < iw) return [d + s, d];
    s -= iw;
    if (s < ih) return [w - d, d + s];
    s -= ih;
    if (s < iw) return [w - d - s, h - d];
    s -= iw;
    return [d, h - d - s];
  });
}

const angleOf = (p: [number, number], w: number, h: number) => Math.atan2(p[1] - h / 2, p[0] - w / 2);

/** The page's edges, in the dialog's own coordinates (its top-left is 0, 0). */
interface Page {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where every puff starts, where it sits in the gathered cluster, and where it ends on the card. Each starts just off
 * the page, straight out from the dialog on its own side, so the sky fills in from every edge of the screen at once.
 */
function plan(w: number, h: number, page: Page): Puff[] {
  const r = rng(7);
  const cx = w / 2;
  const cy = h / 2;
  const rings: { n: number; rx: number; ry: number; finals: [number, number][] }[] = [
    // 6 in the core fill the middle of the card; 12 mid and 16 outer press onto its walls and corners.
    {
      n: 6,
      rx: w * 0.12,
      ry: h * 0.1,
      finals: [0.25, 0.5, 0.75].flatMap((fx) => [0.34, 0.66].map((fy) => [w * fx, h * fy] as [number, number])),
    },
    { n: 12, rx: w * 0.3, ry: h * 0.28, finals: perimeter(w, h, 96, 12, 0.5) },
    { n: 16, rx: w * 0.46, ry: h * 0.43, finals: perimeter(w, h, 36, 16, 0) },
  ];
  const puffs: Puff[] = [];
  for (const ring of rings) {
    const finals = [...ring.finals].sort((a, b) => angleOf(a, w, h) - angleOf(b, w, h));
    for (let i = 0; i < ring.n; i++) {
      // Cluster and sky positions go round in the same order as the walls they end on, so no paths cross.
      const a = -Math.PI + ((i + 0.5) / ring.n) * Math.PI * 2 + (r() - 0.5) * 0.35 + 0.01;
      const j = 0.9 + r() * 0.2;
      const cluster: [number, number] = [cx + Math.cos(a) * ring.rx * j, cy + Math.sin(a) * ring.ry * j];
      // Out from the dialog's centre along this puff's direction (a little scattered) to just past the page's edge.
      const sa = a + (r() - 0.5) * 0.5;
      const dx = Math.cos(sa);
      const dy = Math.sin(sa);
      const toX = dx > 0 ? (page.right - cx) / dx : dx < 0 ? (page.left - cx) / dx : Infinity;
      const toY = dy > 0 ? (page.bottom - cy) / dy : dy < 0 ? (page.top - cy) / dy : Infinity;
      const out = Math.min(toX, toY) + 110 + r() * 160;
      const start: [number, number] = [cx + dx * out, cy + dy * out];
      puffs.push({ shape: Math.floor(r() * LOBES.length), start, cluster, final: finals[i]!, delay: r() * 0.12, s0: 0.55 + r() * 0.25 });
    }
  }
  return puffs;
}

/** Before the dialog is shown: no surface, border or shadow, and the form hidden, so nothing shows ahead of the clouds. */
export function prepareSummon(dialog: HTMLDialogElement, content: HTMLElement | null) {
  Object.assign(dialog.style, { background: "transparent", borderColor: "transparent", boxShadow: "none", overflow: "visible" });
  if (content) Object.assign(content.style, { opacity: "0", transform: "translateY(8px)" });
}

function release(dialog: HTMLDialogElement | null, content: HTMLElement | null) {
  if (dialog) Object.assign(dialog.style, { background: "", borderColor: "", boxShadow: "", overflow: "", transition: "" });
  if (content) Object.assign(content.style, { opacity: "", transform: "" });
}

export function CloudSummon({
  dialog,
  content,
  onDone,
}: {
  dialog: RefObject<HTMLDialogElement | null>;
  content: RefObject<HTMLDivElement | null>;
  onDone: () => void;
}) {
  const id = `summon${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const layer = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const d = dialog.current;
    const c = content.current;
    const root = svg.current;
    const lay = layer.current;
    if (!d || !root || !lay) return;
    // Again here, not only before the dialog opened: a cleanup (React runs effects twice in development) restores it.
    prepareSummon(d, c);
    const w = d.clientWidth;
    const h = d.clientHeight;
    const box = d.getBoundingClientRect();
    const vw = innerWidth;
    const vh = innerHeight;
    const page = { left: -box.left, top: -box.top, right: vw - box.left, bottom: vh - box.top };
    const puffs = plan(w, h, page);
    // The clouds are drawn on a layer over the whole screen, in the dialog's own coordinates.
    root.querySelector<SVGGElement>(`#${id}-origin`)!.setAttribute("transform", `translate(${box.left.toFixed(1)} ${box.top.toFixed(1)})`);

    // Draw the puffs once; the loop only moves, scales and bleaches them.
    const ns = "http://www.w3.org/2000/svg";
    const group = root.querySelector<SVGGElement>(`#${id}-puffs`)!;
    const nodes = puffs.map((p) => {
      const g = document.createElementNS(ns, "g");
      for (const [x, y, rr] of LOBES[p.shape]!) {
        const circle = document.createElementNS(ns, "circle");
        circle.setAttribute("cx", String(x));
        circle.setAttribute("cy", String(y));
        circle.setAttribute("r", String(rr));
        circle.setAttribute("fill", `url(#${id}-lobe)`);
        g.appendChild(circle);
      }
      group.appendChild(g);
      return g;
    });
    const shade = root.querySelector<SVGStopElement>(`#${id}-shade`)!;
    const displace = root.querySelector<SVGFEDisplacementMapElement>(`#${id}-displace`)!;
    const blur = root.querySelector<SVGFEGaussianBlurElement>(`#${id}-blur`)!;

    let raf = 0;
    let handed = false;
    const t0 = performance.now();
    const frame = (now: number) => {
      const p = Math.min(1, (now - t0) / DURATION);

      // Phase 2 fusion: swell, bleach, smooth and press flat against the tightening rounded edge.
      const fuse = eio(seg(p, 0.56, 0.84));
      const under = [211, 224, 248].map((v) => Math.round(lerp(v, 255, fuse)));
      shade.setAttribute("stop-color", `rgb(${under.join(",")})`);
      displace.setAttribute("scale", (26 * (1 - fuse)).toFixed(2));
      blur.setAttribute("stdDeviation", (2.6 * (1 - fuse) + 0.2).toFixed(2));
      // Nothing is clipped while the clouds gather. As they fuse, an edge closes in from 260 px out to the card's own
      // rounded edge and presses them flat against it.
      if (p < 0.56) lay.style.clipPath = "none";
      else {
        const m = 260 * (1 - fuse);
        lay.style.clipPath = `inset(${(box.top - m).toFixed(1)}px ${(vw - box.right - m).toFixed(1)}px ${(vh - box.bottom - m).toFixed(1)}px ${(box.left - m).toFixed(1)}px round ${lerp(160, RADIUS, fuse).toFixed(1)}px)`;
      }

      const move = eio(seg(p, 0.52, 0.84));
      const swell = lerp(1.02, 1.88, eio(seg(p, 0.56, 0.84)));
      puffs.forEach((pf, i) => {
        // Phase 1: drift in from the sky to the cluster, each on its own slight delay.
        const g1 = eo(seg(p, pf.delay, 0.52));
        const x = lerp(lerp(pf.start[0], pf.cluster[0], g1), pf.final[0], move);
        const y = lerp(lerp(pf.start[1], pf.cluster[1], g1), pf.final[1], move);
        const s = p < 0.56 ? lerp(pf.s0, 1.02, g1) : swell;
        const n = nodes[i]!;
        n.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(3)})`);
        n.setAttribute("opacity", eo(seg(p, pf.delay * 0.5, pf.delay * 0.5 + 0.16)).toFixed(3));
      });

      // Phase 3: the clouds are one solid white card now; the real surface takes over underneath them.
      if (p >= 0.82 && !handed) {
        handed = true;
        Object.assign(d.style, { transition: "box-shadow 260ms ease, border-color 260ms ease", background: "", borderColor: "", boxShadow: "" });
      }
      lay.style.opacity = (1 - seg(p, 0.86, 0.95)).toFixed(3);
      if (c) {
        const k = eo(seg(p, 0.82, 1));
        c.style.opacity = k.toFixed(3);
        c.style.transform = `translateY(${(8 * (1 - k)).toFixed(2)}px)`;
      }

      if (p < 1) raf = requestAnimationFrame(frame);
      else {
        release(d, c);
        done.current();
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      nodes.forEach((n) => n.remove());
      release(d, c);
    };
  }, [dialog, content, id]);

  return (
    // Fixed to the screen, not the dialog, so clouds can come in from the page's edges without being cut off.
    <div ref={layer} aria-hidden className="pointer-events-none fixed inset-0" style={{ clipPath: "none" }}>
      <svg ref={svg} className="absolute inset-0 h-full w-full overflow-visible">
        <defs>
          {/* Each lobe: a pure white core with a soft periwinkle shadow underneath, bleached to white as they fuse. */}
          <radialGradient id={`${id}-lobe`} cx="0.45" cy="0.32" r="0.78">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.5" stopColor="#ffffff" />
            <stop id={`${id}-shade`} offset="1" stopColor="#d3e0f8" />
          </radialGradient>
          <filter id={`${id}-wisp`} x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.018 0.024" numOctaves={3} seed={11} result="noise" />
            <feDisplacementMap id={`${id}-displace`} in="SourceGraphic" in2="noise" scale={26} xChannelSelector="R" yChannelSelector="G" />
            <feGaussianBlur id={`${id}-blur`} stdDeviation={2.6} />
          </filter>
        </defs>
        <g id={`${id}-origin`}>
          <g id={`${id}-puffs`} filter={`url(#${id}-wisp)`} />
        </g>
      </svg>
    </div>
  );
}
