"use client";

// The front page as one continuous shot, driven by scroll. The camera starts on the landing page's sky, dives
// through the cloud as it parts, flies at one glass tower and through its single frosted pane, follows a claim
// ticket out into a sky of identical tickets, watches the city through sunset into night, and rises back above the
// cloud at dawn. Scroll is the clock: the sky turns with it.
//
// One sticky stage holds two planes. The world (sky, cloud, city) is drawn at 1920x1080 and scaled to cover the
// screen, sliding sideways on narrow screens to keep what matters in view. The words sit on top in normal, responsive
// layout. A single animation frame loop reads the scroll position, eases toward it and writes styles; nothing on the
// page animates on its own.

import { encryptPadded, paddedSize, randomBytes, utf8 } from "@haven/core";
import { FxLabel } from "@haven/ui";
import Lenis from "lenis";
import "lenis/dist/lenis.css";
import { ArrowRight, Check, Lock } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { HavenLogo, HavenMark } from "@/components/landing/Logo";
import { PullUpFooter } from "@/components/SiteFooter";
import { useDrive } from "@/lib/drive";
import { bank, farBank, mass, rng, skyline, wisps } from "./textures";
import { paneRect, tower, type TowerSpec } from "./tower";
import "./story.css";

const W = 1920;
const H = 1080;
/** Length of the story in "beats"; the track is DUR * BEAT_VH of scroll. */
const DUR = 40;
const BEAT_VH = 16;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const eo = (x: number) => 1 - (1 - x) ** 3;
const ei = (x: number) => x ** 3;
const eio = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
/** In over [a, b], out over [c, d]. */
const win = (t: number, a: number, b: number, c: number, d: number) => eo(seg(t, a, b)) * (1 - ei(seg(t, c, d)));

const HERO_TOWER: TowerSpec = { id: "st-hero", x: 820, y: 150, w: 360, h: 1100, cols: 8, rows: 32, side: 92, seed: 5, frost: [4, 10], rooms: ["1,6", "6,8", "2,14", "5,4", "0,11"] };
const VC_TOWER: TowerSpec = { id: "st-vc", x: 1180, y: 120, w: 420, h: 1100, cols: 8, rows: 30, side: 100, seed: 9, frost: [3, 9], rooms: ["1,5", "6,7", "2,12", "5,14", "0,8"] };
const hp = paneRect(HERO_TOWER, 4, 10);
/** The frosted pane the camera flies into. */
const DT = { x: hp.x + hp.w / 2, y: hp.y + hp.h / 2 };
const vp = paneRect(VC_TOWER, 3, 9);
/** vc.eth's window at sunset. */
const SP = { x: vp.x + vp.w / 2, y: vp.y + vp.h / 2 };

/** Windows you can see straight into, and what anyone walking past can read there. */
const PEEKS: [string, number, number][] = [
  ["maya.eth · payroll.xlsx", 1, 6],
  ["raj.eth · medical.pdf", 6, 8],
  ["zoe.eth · board-deck.pdf", 2, 14],
];
const MiB = 1024 * 1024;
/** The folder being sealed: example names and sizes. Each pads up to Haven's 4 MB bucket. */
const FILES: [string, number][] = [
  ["term-sheet.pdf", Math.round(2.4 * MiB)],
  ["cap-table.xlsx", Math.round(3.1 * MiB)],
  ["office-photo.jpg", Math.round(1.2 * MiB)],
];
const mb = (bytes: number) => `${(bytes / MiB).toFixed(bytes % MiB ? 1 : 0)} MB`;
/** The folder's editors (examples), and which of them adds the file in chapter 06. */
const EDITORS = ["maya.eth", "dev.eth", "lena.eth", "raj.eth"];
const WRITER = 1;
const NAMES = ["maya.eth", "dev.eth", "lena.eth", "raj.eth", "kai.eth", "noor.eth", "ola.eth", "sam.eth", "iris.eth", "theo.eth", "zoe.eth", "arun.eth", "mei.eth", "ben.eth", "ana.eth", "leo.eth", "ivy.eth", "omar.eth", "eve.eth", "jay.eth"];
const SPARKS: [number, number, number][] = [[14, 22, 0], [27, 9, 1.2], [71, 14, 0.6], [83, 31, 2.1], [62, 7, 2.8], [38, 18, 1.7], [90, 12, 3.3], [8, 40, 2.4]];
const RELAYS: [number, number][] = [[560, 640], [980, 520], [1320, 620]];
const PATH_KEYS: [number, number, number][] = [[16.6, -260, 820], [17.3, 560, 640], [17.95, 980, 520], [18.6, 1320, 620], [19.4, 1500, 520]];

interface Tex {
  bank: string;
  farBank: string;
  massA: string;
  massB: string;
  dayFar: string;
  dayMid: string;
  dayNear: string;
  duskFar: string;
  duskMid: string;
  nightFar: string;
  nightMid: string;
  sunWisp: string;
}

/** A random-looking address made in this browser, never sent anywhere. */
function freshAddress() {
  const b = new Uint8Array(20);
  crypto.getRandomValues(b);
  return `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}

function at(t: number) {
  const k = PATH_KEYS;
  const first = k[0]!;
  if (t <= first[0]) return { x: first[1], y: first[2] };
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i]!;
    const b = k[i + 1]!;
    if (t <= b[0]) {
      const f = eio(seg(t, a[0], b[0]));
      return { x: lerp(a[1], b[1], f), y: lerp(a[2], b[2], f) };
    }
  }
  const l = k[k.length - 1]!;
  return { x: l[1], y: l[2] };
}

export function Story() {
  const { identity, restoring } = useDrive();
  const signedIn = !restoring && !!identity;
  const primary = signedIn ? { href: "/drive", label: "Open my drive" } : { href: "/onboarding", label: "Start sharing" };

  const [tex, setTex] = useState<Tex | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const els = useRef<Record<string, HTMLElement | SVGElement | null>>({});
  const reg = (k: string) => (n: HTMLElement | SVGElement | null) => {
    els.current[k] = n;
  };

  // The crowd of tickets: where each one floats. Fixed, so the sky looks the same on every visit.
  const crowd = useMemo(() => {
    const r = rng(64);
    const rows = [
      { n: 8, y: 370, w: 220, op: 0.72, x0: 980, step: 240 },
      { n: 7, y: 500, w: 300, op: 0.9, x0: 40, step: 290 },
      { n: 5, y: 690, w: 380, op: 1, x0: 20, step: 400 },
    ];
    const out: { x: number; y: number; w: number; cx: number; op: number; ph: number; tilt: number; name: string }[] = [];
    rows.forEach((row, ri) => {
      for (let i = 0; i < row.n; i++) {
        const x = row.x0 + i * row.step + r() * 40;
        const y = row.y + r() * 40;
        const cx = x + row.w / 2;
        if (ri === 0 && x > 1880) continue;
        if (ri === 1 && Math.abs(cx - 1500) < 230) continue;
        out.push({ x, y, w: row.w, cx, op: row.op, ph: r() * 6.28, tilt: (r() - 0.5) * 6, name: NAMES[out.length % NAMES.length]! });
      }
    });
    return out;
  }, []);

  const heroTower = useMemo(() => tower({ ...HERO_TOWER, reflect: tex?.bank }), [tex]);
  const vcTower = useMemo(() => tower({ ...VC_TOWER, reflect: tex?.sunWisp }), [tex]);

  // Paint the textures once.
  useEffect(() => {
    let live = true;
    // One texture at a time, each when the browser is idle: painting them all at once on load blocked the first
    // screen and made the first scroll stutter.
    const idle = () =>
      new Promise<void>((ok) =>
        "requestIdleCallback" in window ? (window as Window & typeof globalThis).requestIdleCallback(() => ok(), { timeout: 400 }) : setTimeout(ok, 30),
      );
    const paint = async <T,>(f: () => Promise<T>) => {
      await idle();
      return f();
    };
    void (async () => {
      const b = await paint(bank);
      const fb = await paint(farBank);
      const ma = await paint(() => mass(31));
      const mb = await paint(() => mass(47));
      const sunWisp = await paint(() => wisps("sunwisp", 41, "#ffd2b4", "#9a6f9e"));
      const dayFar = await paint(() => skyline("day", "far"));
      const dayMid = await paint(() => skyline("day", "mid"));
      const dayNear = await paint(() => skyline("day", "near"));
      const duskFar = await paint(() => skyline("dusk", "far"));
      const duskMid = await paint(() => skyline("dusk", "mid"));
      const nightFar = await paint(() => skyline("night", "far"));
      const nightMid = await paint(() => skyline("night", "mid"));
      if (live) setTex({ bank: b, farBank: fb, massA: ma, massB: mb, dayFar, dayMid, dayNear, duskFar, duskMid, nightFar, nightMid, sunWisp });
    })();
    return () => {
      live = false;
    };
  }, []);

  // Seal each file name with Haven's own padded encryption and a fresh key, here in the browser, and show the start
  // of what comes out.
  useEffect(() => {
    let live = true;
    void Promise.all(FILES.map(([name]) => encryptPadded(randomBytes(32), utf8(name)))).then((blobs) => {
      if (!live) return;
      blobs.forEach((b, i) => {
        const hex = Array.from(b.subarray(0, 12), (x) => x.toString(16).padStart(2, "0")).join("");
        const n = els.current[`sealCipher${i}`];
        if (n) n.textContent = `${hex.match(/.{4}/g)!.join(" ")} …`;
      });
    });
    return () => {
      live = false;
    };
  }, []);

  // The scroll clock.
  useEffect(() => {
    const e = els.current;
    const address = freshAddress();
    const hexes = crowd.map(() => {
      const a = freshAddress();
      return `${a.slice(0, 6)}…${a.slice(-4)}`;
    });
    const ours = `${address.slice(0, 6)}…${address.slice(-4)}`;
    if (e.oursLabel) e.oursLabel.textContent = ours;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const layout = { s: 1, ox: 0, oy: 0, vw: 1, vh: 1 };
    const measure = () => {
      const st = stage.current;
      if (!st) return;
      layout.vw = st.clientWidth;
      layout.vh = st.clientHeight;
      layout.s = Math.max(layout.vw / W, layout.vh / H);
      layout.oy = (layout.vh - H * layout.s) / 2;
    };
    measure();
    window.addEventListener("resize", measure);

    const set = (k: string, css: Partial<CSSStyleDeclaration>) => {
      const n = e[k];
      if (n) Object.assign((n as HTMLElement).style, css);
    };
    const op = (k: string, v: number) => set(k, { opacity: v.toFixed(3) });

    const render = (t: number) => {
      // Where the camera looks, sideways, on screens narrower than the world.
      const focus = lerp(lerp(960, SP.x, eio(seg(t, 24.5, 26.5))), 960, eio(seg(t, 34.6, 36.4)));
      const spare = Math.max(0, (W * layout.s - layout.vw) / 2);
      layout.ox = (layout.vw - W * layout.s) / 2 + Math.max(-spare, Math.min(spare, (960 - focus) * layout.s));
      set("world", { transform: `translate(${layout.ox.toFixed(1)}px,${layout.oy.toFixed(1)}px) scale(${layout.s.toFixed(5)})` });
      const toScreen = (x: number, y: number) => ({ x: layout.ox + x * layout.s, y: layout.oy + y * layout.s });

      // ---- Sky: the day turns with the scroll ----
      const dusk = eio(seg(t, 23.8, 26)) * (1 - eio(seg(t, 30, 33)));
      const night = eio(seg(t, 29.4, 32.6)) * (1 - eio(seg(t, 34.6, 36.8)));
      op("skyDusk", dusk);
      op("skyNight", night);
      op("stars", night);
      op("moon", night);
      op("sun", dusk);
      set("sun", { transform: `translateY(${lerp(0, 230, eio(seg(t, 25.5, 29.6))).toFixed(1)}px)` });
      op("duskWisps", dusk * 0.9);
      set("duskWisps", { transform: `translateX(${(-t * 6).toFixed(1)}px)` });
      const sparks = (1 - seg(t, 2.0, 2.6)) + 0.8 * seg(t, 16.2, 17) * (1 - seg(t, 23.4, 24)) + seg(t, 35, 36);
      (e.sparks?.childNodes ?? []).forEach((n, i) => {
        (n as HTMLElement).style.opacity = (sparks * (0.25 + 0.65 * (0.5 + 0.5 * Math.sin((t * 0.6 + (SPARKS[i]?.[2] ?? 0)) * Math.PI)))).toFixed(3);
      });

      // ---- The cloud banks of the landing page ----
      const dv = eio(seg(t, 2.2, 3.6));
      let bY: number, bS: number, bO: number, fY: number, fS: number;
      if (t < 15.9) {
        bY = -lerp(0, 760, dv); bS = lerp(1, 3.4, dv); bO = 1 - eio(seg(t, 2.9, 3.4));
        fY = -lerp(0, 420, dv); fS = lerp(1, 1.9, dv);
      } else if (t < 34.6) {
        const k = eio(seg(t, 23.5, 24.9));
        bY = 280 - lerp(0, 1040, k); bS = lerp(1, 3.4, k); bO = seg(t, 15.9, 16.6) * (1 - eio(seg(t, 23.6, 24.15)));
        fY = 160 - lerp(0, 580, k); fS = lerp(1, 1.9, k);
      } else {
        const k = eo(seg(t, 34.6, 36.4));
        bY = lerp(760, 0, k); bS = 1; bO = seg(t, 34.6, 35);
        fY = lerp(420, 0, k); fS = 1;
      }
      set("bank", { transform: `translate(${(30 * Math.sin(t * 0.15)).toFixed(1)}px,${bY.toFixed(1)}px) scale(${bS.toFixed(4)})`, opacity: bO.toFixed(3) });
      set("farBank", { transform: `translate(${(-24 * Math.sin(t * 0.12)).toFixed(1)}px,${fY.toFixed(1)}px) scale(${fS.toFixed(4)})`, opacity: bO.toFixed(3) });

      // ---- Flying through the cloud: masses of it part to either side as the camera passes ----
      for (let i = 0; i < 3; i++) {
        const base = t < 13 ? 2.45 : 23.55;
        const k = seg(t, base + i * 0.42, base + i * 0.42 + 1.7);
        const o = k <= 0 || k >= 1 ? 0 : seg(k, 0, 0.16) * (1 - seg(k, 0.5, 1));
        const sc = lerp(1, 2.5, ei(k));
        const dx = lerp(0, 1150, ei(k));
        const dy = lerp(30, -90, k) + (i - 1) * 50;
        set(`mL${i}`, { opacity: o.toFixed(3), transform: `translate(${(-dx).toFixed(1)}px,${dy.toFixed(1)}px) scale(${sc.toFixed(4)})` });
        set(`mR${i}`, { opacity: o.toFixed(3), transform: `translate(${dx.toFixed(1)}px,${(dy + 30).toFixed(1)}px) scale(${sc.toFixed(4)})` });
      }
      op("veil", 0.38 * (seg(t, 2.6, 3.1) * (1 - seg(t, 3.6, 4.6)) + seg(t, 23.7, 24.2) * (1 - seg(t, 24.7, 25.7))));

      // ---- The glass city, and one camera flying straight at the frosted pane ----
      const u = seg(t, 5.0, 10.0);
      const sh = Math.exp(Math.log(60) * (0.35 * u + 0.65 * u ** 3));
      const cz = 1000 * (1 - 1 / sh);
      const kk = eio(seg(t, 5.0, 9.4));
      const px = lerp(DT.x, 960, kk);
      const py = lerp(DT.y, 540, kk);
      const off = (K: number) => K * (1 - eo(seg(t, 3.2, 5.4)));
      const place = (k: string, Z: number, o: number) => {
        const s = Z / Math.max(1, Z - cz);
        set(k, { transform: `translate(${(px - DT.x * s).toFixed(2)}px,${(py + o - DT.y * s).toFixed(2)}px) scale(${s.toFixed(4)})` });
        return s;
      };
      const showCity = t < 10.7 ? eio(seg(t, 3.0, 3.7)) : 0;
      op("descent", showCity);
      if (showCity) {
        place("dFar", 3200, off(160));
        place("dMid", 1600, off(320));
        place("dDrift", 1300, off(380));
        place("dHero", 1000, off(520));
        const sn = place("dNear", 640, off(700));
        op("dNear", 1 - seg(sn, 2, 3.4));
        op("dDrift", 0.38 * (1 - seg(t, 6, 7.2)));
        set("dDriftImg", { transform: `translateX(${(t * 40).toFixed(1)}px)` });
        const halo = stage.current?.querySelector<SVGElement>(".st-hero-halo");
        if (halo) halo.style.opacity = (0.55 + 0.25 * Math.sin(t * 2.4) + 0.2 * seg(t, 7.5, 9.5)).toFixed(3);
      }
      PEEKS.forEach((p, i) => {
        const ax = HERO_TOWER.x + (p[1] + 0.5) * (HERO_TOWER.w / HERO_TOWER.cols);
        const ay = HERO_TOWER.y + p[2] * (HERO_TOWER.h / HERO_TOWER.rows) + 4;
        const sp = toScreen(px + (ax - DT.x) * sh, py + off(520) + (ay - DT.y) * sh);
        const v = win(t, 5.7 + i * 0.2, 6.1 + i * 0.2, 7.3, 7.7) * showCity;
        set(`peek${i}`, { opacity: v.toFixed(3), transform: `translate(${sp.x.toFixed(1)}px,${sp.y.toFixed(1)}px)` });
      });
      op("scrim", 0.85 * win(t, 5.3, 5.8, 9.6, 10.0) + 0.7 * win(t, 25.8, 26.4, 34.3, 34.8));
      op("bloom", Math.max(ei(seg(t, 9.7, 10.3)) * (1 - eo(seg(t, 10.4, 11))), ei(seg(t, 15.5, 16)) * (1 - eo(seg(t, 16, 16.6)))));

      // ---- Inside the frosted room ----
      op("room", seg(t, 10.2, 10.5) * (1 - seg(t, 15.9, 16.4)));
      set("room", { transform: `scale(${lerp(1.06, 1, eo(seg(t, 10.3, 11.8))).toFixed(4)})` });
      // The city outside, blurred by the frosted glass, drifting as the camera turns about the room.
      set("roomOut", { transform: `translateX(${lerp(60, -60, seg(t, 10.2, 16.4)).toFixed(1)}px)` });
      const beam = seg(t, 11.4, 12.6);
      set("sealBeam", { top: `${lerp(8, 100, beam).toFixed(2)}%`, opacity: Math.sin(Math.PI * beam).toFixed(3) });
      // As the beam passes a file, its name turns to cipher text and its size pads up to the bucket.
      FILES.forEach(([, bytes], i) => {
        const ts = 11.65 + i * 0.35;
        const k = eo(seg(t, ts - 0.1, ts + 0.25));
        set(`sealName${i}`, { opacity: (1 - k).toFixed(3), transform: `translateY(${(-10 * k).toFixed(1)}px)`, filter: `blur(${(3 * k).toFixed(1)}px)` });
        set(`sealCipher${i}`, { opacity: k.toFixed(3), transform: `translateY(${(10 * (1 - k)).toFixed(1)}px)` });
        op(`sealLock${i}`, k);
        set(`sealPad${i}`, { transform: `scaleX(${k.toFixed(3)})` });
        const sz = e[`sealSize${i}`];
        if (sz) sz.textContent = mb(t < ts ? bytes : paddedSize(bytes));
      });
      const sent = eio(seg(t, 12.3, 12.7));
      op("sealHeadMine", 1 - sent);
      op("sealHeadSent", sent);
      op("sealLegend", eo(seg(t, 11.8, 12.4)));

      // The ticket: the name is written on the half that stays with you, the address prints on the stub, and the
      // stub tears off and rises into the sky of tickets.
      const rise = eo(seg(t, 13.5, 14.1));
      set("ticketObj", {
        opacity: rise.toFixed(3),
        transform: `translateY(${(lerp(90, 0, rise) + 4 * Math.sin(t * 1.4)).toFixed(1)}px) rotate(${lerp(-3, -1.2, seg(t, 13.5, 15)).toFixed(2)}deg)`,
      });
      if (e.tName) e.tName.textContent = "vc.eth".slice(0, Math.ceil(6 * seg(t, 13.75, 14.05)));
      op("tCaret", t > 13.6 && t < 14.25 && Math.floor(t * 12) % 2 === 0 ? 1 : 0);
      const tear = eio(seg(t, 14.75, 15.25));
      const away = ei(seg(t, 15.2, 16));
      set("ticketStub", {
        transform: `translate(${(30 * tear + 40 * away).toFixed(1)}px,${(-24 * tear - 300 * away).toFixed(1)}px) rotate(${(7 * tear).toFixed(2)}deg)`,
      });
      set("ticketMain", { transform: `translateY(${(10 * tear).toFixed(1)}px) rotate(${(-1.5 * tear).toFixed(2)}deg)`, opacity: (1 - 0.4 * away).toFixed(3) });
      op("noteKept", eo(seg(t, 15.0, 15.35)));
      op("noteChain", eo(seg(t, 15.0, 15.35)) * (1 - seg(t, 15.4, 15.8)));
      if (e.tAddr) {
        const hx = "0123456789abcdef";
        const tick = Math.floor(t * 10);
        let txt = "0x";
        for (let i = 0; i < 40; i++) {
          const when = 14.0 + i * 0.018;
          if (t >= when) txt += address[i + 2];
          else if (t >= 13.9) txt += hx[(i * 7 + tick * 5) % 16];
        }
        e.tAddr.textContent = txt;
      }

      // ---- A sky full of identical tickets ----
      const crowdOn = seg(t, 16, 16.6) * (1 - seg(t, 20.5, 21.3));
      op("crowd", crowdOn);
      if (crowdOn > 0) {
        const wx = lerp(-300, 2300, seg(t, 17.2, 19.2));
        const leave = eio(seg(t, 20.4, 21.3));
        crowd.forEach((c, i) => {
          const k = eo(seg(t, 16.1 + i * 0.03, 16.9 + i * 0.03));
          const d = wx - c.cx;
          const lab = e[`tkl${i}`];
          if (lab) {
            lab.textContent = d < 0 ? c.name : (hexes[i] ?? "");
            (lab as HTMLElement).style.opacity = Math.abs(d) < 60 ? (Math.abs(d) / 60).toFixed(3) : "1";
          }
          set(`tk${i}`, {
            opacity: (c.op * k).toFixed(3),
            transform: `translate(${c.x.toFixed(1)}px,${(c.y + lerp(140, 0, k) + 8 * Math.sin(t * 0.9 + c.ph) - leave * (220 + i * 6)).toFixed(1)}px) rotate(${c.tilt.toFixed(2)}deg)`,
          });
        });
        const p = at(t);
        const glow = 1 - seg(t, 19.4, 20);
        set("tkOurs", {
          transform: `translate(${(p.x - 170).toFixed(1)}px,${(p.y - 60 + 5 * Math.sin(t * 1.4) - leave * 240).toFixed(1)}px) rotate(${lerp(-6, -1, seg(t, 16.6, 19.4)).toFixed(2)}deg)`,
          boxShadow: `0 0 0 ${(3 * glow).toFixed(2)}px rgb(31 79 209 / ${(0.8 * glow).toFixed(2)}), 0 30px 70px -20px rgb(31 79 209 / ${(0.2 + 0.4 * glow).toFixed(2)})`,
        });
        set("tkPath", { strokeDashoffset: (1 - eio(seg(t, 16.6, 19.4))).toFixed(4), opacity: (0.6 * (1 - seg(t, 19.6, 20.2))).toFixed(3) } as Partial<CSSStyleDeclaration>);
        RELAYS.forEach((_, i) => {
          const hit = Math.max(0, 1 - Math.abs(t - PATH_KEYS[i + 1]![0]) / 0.35);
          set(`orb${i}`, { transform: `scale(${(0.9 + 0.08 * Math.sin(t * 2 + i) + 0.35 * hit).toFixed(3)})`, opacity: (0.75 + 0.25 * hit).toFixed(3) });
        });
      }

      // ---- Proof, not names: one editor adds a file, then every name frosts over the same ----
      EDITORS.forEach((_, i) => {
        const k = eo(seg(t, 20.9 + i * 0.08, 21.35 + i * 0.08));
        set(`pRow${i}`, { opacity: k.toFixed(3), transform: `translateY(${lerp(16, 0, k).toFixed(1)}px)` });
        const fz = eio(seg(t, 22.0 + i * 0.04, 22.35 + i * 0.04));
        set(`pName${i}`, { opacity: (1 - 0.9 * fz).toFixed(3), filter: `blur(${(6 * fz).toFixed(1)}px)` });
        set(`pFrost${i}`, { opacity: fz.toFixed(3), transform: `scaleX(${lerp(0.55, 1, fz).toFixed(3)})` });
        op(`pDot${i}`, eo(seg(t, 22.3, 22.5)));
      });
      const writing = eo(seg(t, 21.45, 21.7)) * (1 - eio(seg(t, 21.9, 22.1)));
      op("pWrite", writing);
      op("pMark", writing);
      set("pBracket", { transform: `scaleY(${eio(seg(t, 22.35, 22.65)).toFixed(3)})` });
      const res = eo(seg(t, 22.6, 22.95));
      set("pResult", { opacity: res.toFixed(3), transform: `translateY(${lerp(12, 0, res).toFixed(1)}px)` });
      // The proof itself: a seal where the bracket closes, popping as it lands.
      const sk = seg(t, 22.5, 22.8);
      set("pSeal", { opacity: eo(sk).toFixed(3), transform: `translateY(-50%) scale(${(sk > 0 ? lerp(0.6, 1, eo(sk)) + 0.18 * Math.sin(Math.PI * sk) : 0.6).toFixed(3)})` });
      const halo = seg(t, 22.7, 23.3);
      set("pSeal", { boxShadow: `0 0 0 ${(14 * halo).toFixed(1)}px rgb(31 79 209 / ${(0.35 * (1 - halo)).toFixed(3)}), 0 10px 24px -8px rgb(31 79 209 / 0.6)` });
      op("pClaims", eo(seg(t, 22.8, 23.1)));

      // ---- The city at evening: sunset into night ----
      const evening = t < 37 ? eio(seg(t, 23.9, 24.8)) * (1 - seg(t, 36, 36.6)) : 0;
      op("evening", evening);
      if (evening) {
        const offE = 420 * (1 - eo(seg(t, 24, 26.2))) + lerp(0, 700, eio(seg(t, 34.6, 36.6)));
        const sc = lerp(1, 1.08, eio(seg(t, 25, 34)));
        set("evening", { transform: `translate(${(SP.x - SP.x * sc).toFixed(1)}px,${(SP.y - SP.y * sc + offE).toFixed(1)}px) scale(${sc.toFixed(4)})` });
        set("eFar", { transform: `translateY(${(-offE * 0.5).toFixed(1)}px)` });
        const n = eio(seg(t, 29.4, 32.4));
        op("eNightFar", n);
        op("eNightMid", n);
        op("eWarm", 1 - n);
        op("eDark", 0.65 * n);
        const vh = stage.current?.querySelector<SVGElement>(".st-vc-halo");
        if (vh) vh.style.opacity = (0.55 + 0.25 * Math.sin(t * 2.2)).toFixed(3);
        // A file sent after sunset reaches the glass and goes no further.
        const fly = seg(t, 28.5, 29.1);
        const bounce = seg(t, 29.1, 29.8);
        let lx = lerp(-320, SP.x - 300, ei(fly));
        let ly = lerp(760, SP.y - 40, eo(fly));
        let rot = lerp(-8, 0, fly);
        if (t > 29.1) {
          lx = SP.x - 300 - 120 * eo(bounce);
          ly = SP.y - 40 + 160 * ei(bounce) - 50 * Math.sin(Math.PI * bounce);
          rot = lerp(0, -10, bounce);
        }
        set("late", { opacity: t < 28.5 ? "0" : (1 - seg(t, 29.9, 30.4)).toFixed(3), transform: `translate(${lx.toFixed(1)}px,${ly.toFixed(1)}px) rotate(${rot.toFixed(2)}deg)` });
        op("lateSealed", eo(seg(t, 29.15, 29.45)));
        op("kept", win(t, 26.8, 27.3, 29.9, 30.4));
      }
      const left = Math.max(0, Math.ceil(28.4 - t));
      if (e.clock) e.clock.textContent = `00:00:0${Math.min(9, left)}`;
      if (e.clockLabel) e.clockLabel.textContent = t < 28.4 ? "Access ends in" : "Access ended";

      // ---- The words ----
      const chapters: [string, number][] = [
        ["chHero", 1 - eo(seg(t, 2.0, 2.7))],
        ["chCity", win(t, 5.4, 5.9, 7.6, 8.0)],
        ["chWindow", win(t, 8.0, 8.4, 9.6, 9.95)],
        ["chSeal", win(t, 10.7, 11.2, 12.9, 13.3)],
        ["chTicket", win(t, 13.2, 13.7, 15.5, 15.9)],
        ["chCrowd", win(t, 16.6, 17.1, 20.2, 20.6)],
        ["chProof", win(t, 20.8, 21.3, 23.4, 23.8)],
        ["chSunset", win(t, 26, 26.5, 29.9, 30.4)],
        ["chNight", win(t, 30.8, 31.3, 34.2, 34.6)],
        ["chEnd", eo(seg(t, 36, 36.8))],
      ];
      for (const [k, v] of chapters) {
        set(k, { opacity: v.toFixed(3), transform: `translateY(${((1 - v) * 24).toFixed(1)}px)`, visibility: v > 0.01 ? "visible" : "hidden" });
      }
      op("cue", 1 - seg(t, 0.3, 1.2));
    };

    // Wheel and trackpad scrolling is smoothed by Lenis. Touch keeps the phone's own scrolling, so the loop below
    // eases toward it instead.
    const lenis = reduce ? null : new Lenis({ autoRaf: false, lerp: 0.09 });
    let touch = false;
    const onTouch = () => (touch = true);
    const onWheel = () => (touch = false);
    window.addEventListener("touchstart", onTouch, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: true });

    let raf = 0;
    let cur = -1;
    let shown = -1;
    let last = performance.now();
    const frame = (now: number) => {
      lenis?.raf(now);
      const tr = track.current;
      if (tr) {
        const span = Math.max(1, tr.offsetHeight - window.innerHeight);
        const target = clamp01(-tr.getBoundingClientRect().top / span);
        const dt = Math.min(0.1, (now - last) / 1000);
        cur = cur < 0 || reduce || (lenis && !touch) ? target : cur + (target - cur) * (1 - Math.exp(-dt * 7));
        if (Math.abs(cur - shown) > 0.00002) {
          shown = cur;
          render(cur * DUR);
        }
      }
      last = now;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      window.removeEventListener("touchstart", onTouch);
      window.removeEventListener("wheel", onWheel);
      lenis?.destroy();
    };
    // Textures arriving replace images in place; the loop keeps running.
  }, [crowd]);

  const img = (src: string | undefined, style: CSSProperties, k?: string) =>
    src ? <img ref={k ? reg(k) : undefined} src={src} alt="" draggable={false} className="story-tex" style={style} /> : null;

  return (
    <div className="story landing">
      <StoryNav cta={primary} />
      <PullUpFooter surface="bg-[#eef3fa]">
        <div ref={track} className="story-track" style={{ height: `calc(${DUR * BEAT_VH}vh + 100svh)` }}>
          <div ref={stage} className="story-stage">
            {/* ---------------- the world ---------------- */}
            <div ref={reg("world")} className="story-world" aria-hidden>
              <div className="story-sky story-sky-day" />
              <div ref={reg("skyDusk")} className="story-sky story-sky-dusk" />
              <div ref={reg("skyNight")} className="story-sky story-sky-night" />
              <div ref={reg("stars")} className="story-stars" />
              <div ref={reg("moon")} className="story-moon" />
              <div ref={reg("sun")} className="story-sun" />
              <div ref={reg("duskWisps")} className="story-abs">
                {img(tex?.sunWisp, { left: -200, top: 40, width: 2300, height: 1290 })}
              </div>
              <div ref={reg("sparks")}>
                {SPARKS.map(([x, y]) => (
                  <span key={`${x}-${y}`} className="story-spark" style={{ left: x * 19.2, top: y * 10.8 }} />
                ))}
              </div>

              {/* the city the camera flies into */}
              <div ref={reg("descent")} className="story-abs" style={{ opacity: 0 }}>
                <div ref={reg("dFar")} className="story-layer">
                  <div className="story-street story-street-far" />
                  {img(tex?.dayFar, { left: -340, top: 20, width: 2600, height: 780 })}
                </div>
                <div ref={reg("dMid")} className="story-layer">
                  <div className="story-street" />
                  {img(tex?.dayMid, { left: -240, top: 0, width: 2400, height: 980 })}
                </div>
                <div ref={reg("dDrift")} className="story-layer">{img(tex?.massB, { left: -200, top: 160, width: 2300, height: 700, opacity: 0.5 }, "dDriftImg")}</div>
                <div ref={reg("dHero")} className="story-layer">
                  <svg className="story-svg" viewBox={`0 0 ${W} ${H}`}>
                    <g dangerouslySetInnerHTML={{ __html: heroTower }} />
                  </svg>
                </div>
                <div ref={reg("dNear")} className="story-layer">{img(tex?.dayNear, { left: -140, top: -280, width: 2200, height: 1500 })}</div>
              </div>

              {/* the city at evening */}
              <div ref={reg("evening")} className="story-layer" style={{ opacity: 0 }}>
                <div ref={reg("eFar")} className="story-abs">
                  {img(tex?.duskFar, { left: -340, top: 190, width: 2600, height: 800 })}
                  {img(tex?.nightFar, { left: -340, top: 190, width: 2600, height: 800, opacity: 0 }, "eNightFar")}
                </div>
                {img(tex?.duskMid, { left: -300, top: 210, width: 2400, height: 1000 })}
                {img(tex?.nightMid, { left: -300, top: 210, width: 2400, height: 1000, opacity: 0 }, "eNightMid")}
                <svg className="story-svg" viewBox={`0 0 ${W} ${H}`}>
                  <defs>
                    <linearGradient id="st-warm" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" stopColor="#ff8f5e" stopOpacity=".55" />
                      <stop offset=".6" stopColor="#ff8f5e" stopOpacity=".12" />
                      <stop offset="1" stopColor="#0d1b33" stopOpacity=".45" />
                    </linearGradient>
                  </defs>
                  <g dangerouslySetInnerHTML={{ __html: vcTower }} />
                  <rect ref={reg("eWarm")} clipPath="url(#st-vc-clip)" x={VC_TOWER.x} y={VC_TOWER.y} width={VC_TOWER.w} height={VC_TOWER.h} fill="url(#st-warm)" />
                  <rect ref={reg("eDark")} clipPath="url(#st-vc-clip)" x={VC_TOWER.x} y={VC_TOWER.y} width={VC_TOWER.w} height={VC_TOWER.h} fill="#0b1430" opacity={0} />
                </svg>
                <div ref={reg("kept")} className="story-pin" style={{ left: SP.x + 60, top: SP.y - 150, opacity: 0 }}>
                  <span className="story-pin-dot" />
                  <span className="story-pin-text">
                    <b>term-sheet.pdf</b>
                    <br />
                    opened before sunset, theirs to keep
                  </span>
                </div>
                <div ref={reg("late")} className="story-late" style={{ opacity: 0 }}>
                  <Lock size={22} strokeWidth={1.8} />
                  <span>
                    <b>q4-update.pdf</b>
                    <span ref={reg("lateSealed")} className="story-late-note" style={{ opacity: 0 }}>
                      sealed to them
                    </span>
                  </span>
                </div>
              </div>

              {/* the landing page's own cloud */}
              <div ref={reg("farBank")} className="story-layer story-bank">{img(tex?.farBank, { left: -60, top: -120, width: 2040, height: 1190 })}</div>

              {/* a sky full of claim tickets */}
              <div ref={reg("crowd")} className="story-abs" style={{ opacity: 0 }}>
                <svg className="story-svg" viewBox={`0 0 ${W} ${H}`}>
                  <path ref={reg("tkPath")} pathLength={1} d="M-260 820 C100 760 380 660 560 640 S860 520 980 520 S1200 640 1320 620 S1460 540 1500 520" className="story-route" />
                </svg>
                {RELAYS.map(([x, y], i) => (
                  <span key={x} ref={reg(`orb${i}`)} className="story-orb" style={{ left: x - 70, top: y - 70 }} />
                ))}
                {crowd.map((c, i) => (
                  <div key={i} ref={reg(`tk${i}`)} className="story-ticket" style={{ width: c.w, fontSize: c.w / 10 }}>
                    <span className="story-ticket-head">
                      <HavenMark size={c.w * 0.09} /> CLAIM TICKET
                    </span>
                    <span ref={reg(`tkl${i}`)} className="story-ticket-label">
                      {c.name}
                    </span>
                    <span className="story-ticket-perf" />
                  </div>
                ))}
                <div ref={reg("tkOurs")} className="story-ticket" style={{ width: 340, fontSize: 34 }}>
                  <span className="story-ticket-head">
                    <HavenMark size={30} /> CLAIM TICKET
                  </span>
                  <span ref={reg("oursLabel")} className="story-ticket-label">
                    0x
                  </span>
                  <span className="story-ticket-perf" />
                </div>
              </div>

              <div ref={reg("bank")} className="story-layer story-bank">
                {img(tex?.bank, { left: -60, top: -120, width: 2040, height: 1190 })}
                <div className="story-bank-fade" />
              </div>

              {/* masses of cloud that part as the camera flies through */}
              {[0, 1, 2].map((i) => (
                <div key={i}>
                  <div ref={reg(`mL${i}`)} className="story-mass" style={{ left: -260, transformOrigin: "1400px 490px" }}>
                    {img(i % 2 ? tex?.massB : tex?.massA, { left: 0, top: 0, width: 1400, height: 980 })}
                  </div>
                  <div ref={reg(`mR${i}`)} className="story-mass" style={{ left: 780, transformOrigin: "0px 490px" }}>
                    {img(i % 2 ? tex?.massA : tex?.massB, { left: 0, top: 0, width: 1400, height: 980, transform: "scaleX(-1)" })}
                  </div>
                </div>
              ))}
              <div ref={reg("veil")} className="story-veil" />

              {/* inside the frosted room */}
              <div ref={reg("room")} className="story-room" style={{ opacity: 0 }}>
                <div ref={reg("roomOut")} className="story-room-out">
                  {/* Blurred once on its own layer; only the outer layer moves, so the blur isn't redrawn per frame. */}
                  <div className="story-room-out-blur">
                    {img(tex?.dayFar, { left: -340, top: 120, width: 2600, height: 780 })}
                    {img(tex?.dayMid, { left: -240, top: 180, width: 2400, height: 980 })}
                  </div>
                </div>
                <span className="story-room-frost" />
                <span className="story-room-light" />
                <span className="story-room-mullion" style={{ left: 640 }} />
                <span className="story-room-mullion" style={{ left: 1290 }} />
                <span className="story-room-floor" />
                <span className="story-bokeh" style={{ left: 1500, top: 180, width: 180, height: 180 }} />
                <span className="story-bokeh" style={{ left: 260, top: 640, width: 120, height: 120 }} />
              </div>

              <div ref={reg("scrim")} className="story-scrim" />
              <div ref={reg("bloom")} className="story-bloom" />
            </div>

            {/* ---------------- the words ---------------- */}
            {PEEKS.map(([label], i) => (
              <div key={label} ref={reg(`peek${i}`)} className="story-peek" aria-hidden>
                <span className="story-peek-text">{label}</span>
                <span className="story-peek-line" />
                <span className="story-peek-dot" />
              </div>
            ))}

            <section ref={reg("chHero")} className="story-ch story-ch-center">
              <h1 className="display story-h1">
                Share any file by name.
                <br />
                <span className="text-[#0d1b33]">Nobody learns who.</span>
              </h1>
              <p className="story-lede">
                Haven encrypts files on your device and shares them with any ENS name. Each person gets a private ticket, and their access ends on the date you pick.
              </p>
              <div className="story-actions">
                <Link href={primary.href} className="btn-clay fx inline-flex items-center gap-3 rounded-full py-2 pl-7 pr-2 text-[17px] font-semibold">
                  <FxLabel>
                    {primary.label}
                    <span className="flex size-10 items-center justify-center rounded-full bg-[#1f4fd1] text-white [.fx-hover_&]:bg-white [.fx-hover_&]:text-[#1f4fd1]">
                      <ArrowRight size={18} />
                    </span>
                  </FxLabel>
                </Link>
              </div>
              <p ref={reg("cue")} className="story-cue">
                Scroll to follow a file
              </p>
            </section>

            <section ref={reg("chCity")} className="story-ch story-ch-bottom">
              <p className="story-kicker">01 · The city</p>
              <h2 className="display story-h2 text-white">Down here, every window is see-through.</h2>
              <p className="story-body text-white/80">Cloud drives read every file. Onchain access lists name everyone you let in.</p>
            </section>

            <section ref={reg("chWindow")} className="story-ch story-ch-bottom">
              <p className="story-kicker">02 · Haven</p>
              <h2 className="display story-h2 text-white">Haven is the one window you can’t see into.</h2>
              <p className="story-body text-white/80">A folder in your drive, or an unlinked room that can’t be traced back to you.</p>
            </section>

            <section ref={reg("chSeal")} className="story-ch story-ch-split">
              <div>
                <p className="story-kicker story-kicker-ink">03 · Sealed</p>
                <h2 className="display story-h2">Sealed on your device.</h2>
                <p className="story-body">Encrypted in your browser before it goes anywhere, and padded so even its size gives nothing away.</p>
              </div>
              <div className="story-seal">
                <p className="story-seal-head">
                  <HavenMark size={22} /> Series A data room
                  <span className="story-seal-where">
                    <span ref={reg("sealHeadMine")}>on your device</span>
                    <span ref={reg("sealHeadSent")} style={{ opacity: 0 }}>
                      what leaves it
                    </span>
                  </span>
                </p>
                {FILES.map(([name, bytes], i) => (
                  <div key={name} className="story-seal-row">
                    <span className="story-seal-name">
                      <span ref={reg(`sealName${i}`)}>{name}</span>
                      <span ref={reg(`sealCipher${i}`)} className="story-seal-cipher" style={{ opacity: 0 }} />
                    </span>
                    <span ref={reg(`sealLock${i}`)} className="story-seal-lock" style={{ opacity: 0 }}>
                      <Lock size={18} strokeWidth={1.8} />
                    </span>
                    <span ref={reg(`sealSize${i}`)} className="story-seal-size">
                      {mb(bytes)}
                    </span>
                    <span className="story-seal-bar">
                      <span className="story-seal-data" style={{ width: `${(100 * bytes) / paddedSize(bytes)}%` }} />
                      <span
                        ref={reg(`sealPad${i}`)}
                        className="story-seal-pad"
                        style={{ left: `${(100 * bytes) / paddedSize(bytes)}%`, transform: "scaleX(0)" }}
                      />
                    </span>
                  </div>
                ))}
                <p ref={reg("sealLegend")} className="story-seal-legend" style={{ opacity: 0 }}>
                  <span className="story-seal-key story-seal-key-data" /> file
                  <span className="story-seal-key story-seal-key-pad" /> padding
                  <span className="story-seal-legend-note">sealed in this browser just now</span>
                </p>
                <span ref={reg("sealBeam")} className="story-seal-beam" />
              </div>
            </section>

            <section ref={reg("chTicket")} className="story-ch story-ch-split">
              <div>
                <p className="story-kicker story-kicker-ink">04 · The ticket</p>
                <h2 className="display story-h2">Their name never touches the chain.</h2>
                <p className="story-body">
                  vc.eth gets a fresh address made just for this share, here in your browser a moment ago. Only that stub goes onchain. The name stays with you.
                </p>
              </div>
              <div ref={reg("ticketObj")} className="story-claim" style={{ opacity: 0 }}>
                <div ref={reg("ticketMain")} className="story-claim-half">
                  <div className="story-claim-main">
                    <p className="story-claim-head">
                      <HavenMark size={24} /> Claim ticket
                    </p>
                    <p className="story-claim-label">Share with</p>
                    <p className="story-claim-name">
                      <span ref={reg("tName")}>vc.eth</span>
                      <span ref={reg("tCaret")} className="story-claim-caret" style={{ opacity: 0 }} />
                    </p>
                    <p className="story-claim-foot">Viewer · until 30 Nov</p>
                  </div>
                  <p ref={reg("noteKept")} className="story-claim-note" style={{ opacity: 0 }}>
                    Stays with you and vc.eth
                  </p>
                </div>
                <div ref={reg("ticketStub")} className="story-claim-half story-claim-half-stub">
                  <p ref={reg("noteChain")} className="story-claim-note story-claim-note-up" style={{ opacity: 0 }}>
                    Goes onchain
                  </p>
                  <div className="story-claim-stub">
                    <p className="story-claim-label">Member</p>
                    <p ref={reg("tAddr")} className="story-claim-addr">
                      0x
                    </p>
                    <p className="story-claim-foot">no name</p>
                  </div>
                </div>
              </div>
            </section>

            <section ref={reg("chCrowd")} className="story-ch story-ch-top">
              <p className="story-kicker">05 · The crowd</p>
              <h2 className="display story-h2 text-white">
                The best place to hide <span className="text-[#0d1b33]">is a crowd.</span>
              </h2>
              <p className="story-body text-[#0d1b33]/80">Every lookup goes through Anon-RPC relays, on its own route, so nobody can join your shares together.</p>
            </section>

            <section ref={reg("chProof")} className="story-ch story-ch-split">
              <div>
                <p className="story-kicker">06 · Zero-knowledge proof</p>
                <h2 className="display story-h2 text-white">
                  Proof it’s an editor. <span className="text-[#0d1b33]">Not which one.</span>
                </h2>
                <p className="story-body text-[#0d1b33]/80">
                  Editors add files with a <strong className="font-semibold text-[#0d1b33]">zero-knowledge proof</strong>. It shows the writer is one of the folder’s editors, and nothing else. Haven checks it once, and nobody learns which editor wrote.
                </p>
              </div>
              <div className="story-proof">
                <p className="story-proof-head">
                  Editors · Series A data room <span>{EDITORS.length} members</span>
                </p>
                <div className="story-proof-list">
                  {EDITORS.map((name, i) => (
                    <div key={name} ref={reg(`pRow${i}`)} className="story-proof-row" style={{ opacity: 0 }}>
                      {i === WRITER && <span ref={reg("pMark")} className="story-proof-mark" style={{ opacity: 0 }} />}
                      <span className="story-proof-name">
                        <span ref={reg(`pName${i}`)}>{name}</span>
                        <span ref={reg(`pFrost${i}`)} className="story-proof-frost" style={{ opacity: 0 }} />
                      </span>
                      {i === WRITER && (
                        <span ref={reg("pWrite")} className="story-proof-write" style={{ opacity: 0 }}>
                          adds q4-update.pdf
                        </span>
                      )}
                      <span ref={reg(`pDot${i}`)} className="story-proof-dot" style={{ opacity: 0 }} />
                    </div>
                  ))}
                  <span ref={reg("pBracket")} className="story-proof-bracket" style={{ transform: "scaleY(0)" }} />
                  <span ref={reg("pSeal")} className="story-proof-seal" style={{ opacity: 0 }}>
                    ZK
                  </span>
                </div>
                <p ref={reg("pResult")} className="story-proof-result" style={{ opacity: 0 }}>
                  <span className="story-proof-file">q4-update.pdf</span>
                  <span>added by one of {EDITORS.length} editors</span>
                  <span className="story-proof-ok">
                    <Check size={14} strokeWidth={3} /> zero-knowledge proof checked
                  </span>
                </p>
                <p ref={reg("pClaims")} className="story-proof-claims" style={{ opacity: 0 }}>
                  <span>
                    proves <b>one of {EDITORS.length} editors wrote this</b>
                  </span>
                  <span>
                    reveals <b>nothing else</b>
                  </span>
                </p>
              </div>
            </section>

            <section ref={reg("chSunset")} className="story-ch story-ch-top">
              <p className="story-kicker">07 · Time runs out</p>
              <h2 className="display story-h2 text-white">Access ends at sunset. New files stay sealed.</h2>
              <p className="story-body text-white/85">No transaction. Files added after the end use keys vc.eth never gets. What they already opened, they keep.</p>
              <p className="story-clock">
                <span ref={reg("clockLabel")}>Access ends in</span>
                <span ref={reg("clock")} className="story-clock-time">
                  00:00:03
                </span>
              </p>
            </section>

            <section ref={reg("chNight")} className="story-ch story-ch-top">
              <p className="story-kicker">08 · From outside</p>
              <h2 className="display story-h2 text-white">Every Haven window looks the same.</h2>
              <p className="story-body text-white/80">Lit windows give everything away. Haven’s show a random address, a padded size and an end date. No names, no files.</p>
            </section>

            <section ref={reg("chEnd")} className="story-ch story-ch-center">
              <HavenLogo tone="light" size={56} />
              <h2 className="display story-h1">
                Your files. Their names.
                <br />
                <span className="text-[#0d1b33]">Nobody else.</span>
              </h2>
              <div className="story-actions">
                <Link href={primary.href} className="btn-clay fx inline-flex items-center gap-3 rounded-full py-2 pl-7 pr-2 text-[17px] font-semibold">
                  <FxLabel>
                    {primary.label}
                    <span className="flex size-10 items-center justify-center rounded-full bg-[#1f4fd1] text-white [.fx-hover_&]:bg-white [.fx-hover_&]:text-[#1f4fd1]">
                      <ArrowRight size={18} />
                    </span>
                  </FxLabel>
                </Link>
                <Link href="/home" className="btn-action fx inline-flex items-center rounded-full px-6 py-3.5 text-[17px] font-semibold">
                  <FxLabel>See how it works</FxLabel>
                </Link>
              </div>
            </section>
          </div>
        </div>
      </PullUpFooter>
    </div>
  );
}

/** The site's floating nav pill, here from the start. */
function StoryNav({ cta }: { cta: { href: string; label: string } }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-6 sm:pt-5">
      <header data-floating="true" className="nav-bar pointer-events-auto mx-auto flex max-w-5xl items-center justify-between gap-4 rounded-full px-4 py-2.5 sm:px-5">
        <Link href="/" aria-label="Haven home">
          <HavenLogo tone="dark" size={32} line />
        </Link>
        <nav aria-label="Pages" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {(
              [
                ["How it works", "/home#how"],
                ["Features", "/home#features"],
                ["Privacy", "/home#privacy"],
                ["FAQ", "/home#faq"],
              ] as const
            ).map(([label, href]) => (
              <li key={href}>
                <Link href={href} className="fx inline-flex rounded-full px-3.5 py-2 text-[15px] text-[#0d1b33]/70 [--fx-fill:#1f4fd1]">
                  <FxLabel>{label}</FxLabel>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <Link href={cta.href} className="btn-action fx rounded-full px-5 py-2.5 text-[15px] font-semibold">
          <FxLabel>{cta.label}</FxLabel>
        </Link>
      </header>
    </div>
  );
}
