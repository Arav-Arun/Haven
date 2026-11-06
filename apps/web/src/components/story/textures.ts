// Textures for the scroll story, painted once in the browser and kept as images, so nothing loads from elsewhere.
// Clouds are drawn the way the landing page's hero draws them (soft shapes pushed about by SVG turbulence, then
// blurred); skylines are glass towers painted pane by pane. Painting happens on canvases that never reach the page.

export const INK = "#0d1b33";
export const ACTION = "#1f4fd1";
export const PAGE = "#eef3fa";

/** Seeded random numbers, so a texture looks the same on every visit. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let q = a;
    q = Math.imul(q ^ (q >>> 15), q | 1);
    q ^= q + Math.imul(q ^ (q >>> 7), q | 61);
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
  };
}

function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

async function load(url: string) {
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    // drawn as far as it got
  }
  return img;
}

const cache = new Map<string, Promise<string>>();

export interface CloudSpec {
  /** pixel size of the painted image */
  w: number;
  h: number;
  /** drawing units of `shapes` */
  vw: number;
  vh: number;
  freq: number;
  octaves: number;
  seed: number;
  displace: number;
  blur: number;
  opacity?: number;
  lit: string;
  shade: string;
  /** SVG ellipses and rects, in drawing units */
  shapes: string;
}

/** A cloud texture as a data URL. Falls back to the SVG itself if the browser won't paint it to a canvas. */
export function clouds(key: string, o: CloudSpec): Promise<string> {
  const hit = cache.get(key);
  if (hit) return hit;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${o.w}" height="${o.h}" viewBox="0 0 ${o.vw} ${o.vh}" preserveAspectRatio="none"><defs>` +
    `<filter id="f" x="-30%" y="-60%" width="160%" height="220%"><feTurbulence type="fractalNoise" baseFrequency="${o.freq}" numOctaves="${o.octaves}" seed="${o.seed}"/>` +
    `<feDisplacementMap in="SourceGraphic" scale="${o.displace}"/><feGaussianBlur stdDeviation="${o.blur}"/></filter>` +
    `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${o.lit}"/><stop offset="1" stop-color="${o.shade}"/></linearGradient></defs>` +
    `<g filter="url(#f)" fill="url(#g)" opacity="${o.opacity ?? 1}">${o.shapes}</g></svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const job = (async () => {
    try {
      const img = await load(url);
      const c = document.createElement("canvas");
      c.width = o.w;
      c.height = o.h;
      c.getContext("2d")!.drawImage(img, 0, 0, o.w, o.h);
      const out = c.toDataURL("image/webp", 0.86);
      return out.length > 200 ? out : url;
    } catch {
      return url;
    }
  })();
  cache.set(key, job);
  return job;
}

export interface CitySpec {
  w: number;
  h: number;
  /** y of the street */
  base: number;
  seed: number;
  wMin: number;
  wMax: number;
  hMin: number;
  hMax: number;
  pane: number;
  floor: number;
  /** where towers stand, as [from, to] x ranges; the whole width if left out */
  ranges?: [number, number][];
  glassTop: string;
  glassMid: string;
  glassLow: string;
  sideTop: string;
  sideLow: string;
  frame: string;
  sheen: string;
  lit: string;
  /** share of panes lit from inside */
  litP: number;
  /** share of panes that are Haven's frosted glass, glowing evenly */
  havenP?: number;
  haven?: string;
  gridA: number;
  haze: string;
  hazeTop: number;
  hazeLow: number;
  /** cloud texture reflected in the glass */
  reflect?: Promise<string>;
  reflectA?: number;
}

/** A skyline of glass towers: sky held in the glass, clouds reflected, a lit edge, a shaded side, haze in front. */
export function city(key: string, o: CitySpec): Promise<string> {
  const hit = cache.get(key);
  if (hit) return hit;
  const job = (async () => {
    try {
      const c = document.createElement("canvas");
      c.width = o.w;
      c.height = o.h;
      const x = c.getContext("2d")!;
      const r = rng(o.seed);
      let refl: HTMLImageElement | null = null;
      if (o.reflect) {
        const u = await o.reflect;
        if (/^data:image\/(webp|png)/.test(u)) refl = await load(u);
      }
      const towers: { x: number; w: number; h: number; side: number; crown: number; off: number; z: number }[] = [];
      for (const [a, b] of o.ranges ?? [[-20, o.w + 20]]) {
        for (let px = a; px < b; ) {
          const w = o.wMin + r() * (o.wMax - o.wMin);
          towers.push({ x: px, w, h: o.hMin + r() * (o.hMax - o.hMin), side: 0.14 + r() * 0.14, crown: r(), off: r(), z: r() });
          px += w * (0.7 + r() * 0.45);
        }
      }
      towers.sort((p, q) => p.z - q.z);
      for (const t of towers) {
        const top = o.base - t.h;
        const sw = t.w * t.side;
        const R = t.x + t.w;
        let g = x.createLinearGradient(0, top, 0, o.base);
        g.addColorStop(0, o.sideTop);
        g.addColorStop(1, o.sideLow);
        x.globalAlpha = 1;
        x.fillStyle = g;
        x.beginPath();
        x.moveTo(R, top);
        x.lineTo(R + sw, top + sw * 0.2);
        x.lineTo(R + sw, o.base);
        x.lineTo(R, o.base);
        x.closePath();
        x.fill();
        g = x.createLinearGradient(0, top, 0, o.base);
        g.addColorStop(0, o.glassTop);
        g.addColorStop(0.5, o.glassMid);
        g.addColorStop(1, o.glassLow);
        x.fillStyle = g;
        x.fillRect(t.x, top, t.w, t.h);
        x.save();
        x.beginPath();
        x.rect(t.x, top, t.w, t.h);
        x.clip();
        if (refl) {
          x.globalAlpha = o.reflectA ?? 0.3;
          x.drawImage(refl, t.x - 200 - t.off * 500, top - 60 - t.off * 120, 1300, 760);
        }
        x.globalAlpha = 0.14;
        x.fillStyle = o.sheen;
        x.beginPath();
        x.moveTo(t.x, top + t.h * 0.3);
        x.lineTo(t.x + t.w * 0.8, top);
        x.lineTo(t.x + t.w * 1.2, top);
        x.lineTo(t.x, top + t.h * 0.62);
        x.closePath();
        x.fill();
        const pw = o.pane;
        const fh = o.floor;
        for (let yy = top + 2; yy < o.base; yy += fh) {
          for (let xx = t.x + 1; xx < R - 1; xx += pw) {
            const q = r();
            if (q < o.litP) {
              x.globalAlpha = 0.5 + r() * 0.45;
              x.fillStyle = o.lit;
              x.fillRect(xx + 1, yy + fh * 0.2, pw - 2, fh * 0.7);
            } else if (o.havenP && o.haven && q > 1 - o.havenP) {
              x.globalAlpha = 0.95;
              x.fillStyle = o.haven;
              x.shadowColor = o.haven;
              x.shadowBlur = 10;
              x.fillRect(xx + 1, yy + fh * 0.2, pw - 2, fh * 0.7);
              x.shadowBlur = 0;
            } else if (q < o.litP + 0.3) {
              x.globalAlpha = 0.05 + r() * 0.1;
              x.fillStyle = q < o.litP + 0.15 ? o.sheen : o.frame;
              x.fillRect(xx, yy, pw, fh);
            }
          }
        }
        x.globalAlpha = o.gridA;
        x.fillStyle = o.frame;
        for (let xx = t.x; xx < R; xx += pw) x.fillRect(xx, top, 1, t.h);
        for (let yy = top; yy < o.base; yy += fh) x.fillRect(t.x, yy, t.w, Math.max(1, fh * 0.18));
        x.restore();
        x.globalAlpha = 0.55;
        x.fillStyle = o.sheen;
        x.fillRect(t.x, top, Math.max(1, t.w * 0.008), t.h);
        x.globalAlpha = 1;
        x.fillStyle = o.sideTop;
        x.fillRect(t.x - 2, top - 5, t.w + sw + 2, 6);
        if (t.crown > 0.72) x.fillRect(t.x + t.w * 0.48, top - 30 - t.crown * 40, Math.max(2, t.w * 0.012), 30 + t.crown * 40);
      }
      x.globalCompositeOperation = "source-atop";
      x.globalAlpha = 1;
      const hz = x.createLinearGradient(0, 0, 0, o.h);
      hz.addColorStop(0, rgba(o.haze, o.hazeTop));
      hz.addColorStop(1, rgba(o.haze, o.hazeLow));
      x.fillStyle = hz;
      x.fillRect(0, 0, o.w, o.h);
      x.globalCompositeOperation = "source-over";
      return c.toDataURL("image/webp", 0.88);
    } catch {
      return "";
    }
  })();
  cache.set(key, job);
  return job;
}

// ---- The textures the story uses -------------------------------------------------------------------------------

const WHITE = "#ffffff";
const SHADE = "#dbe5f7";

/** The hero's near bank: the same shapes and turbulence as the landing page's clouds. */
export const bank = () =>
  clouds("bank", {
    w: 1200, h: 700, vw: 1200, vh: 700, freq: 0.013, octaves: 5, seed: 3, displace: 150, blur: 5, lit: WHITE, shade: "#dfe9fb",
    shapes:
      '<ellipse cx="80" cy="470" rx="280" ry="130"/><ellipse cx="330" cy="520" rx="260" ry="110"/><ellipse cx="600" cy="500" rx="330" ry="120"/><ellipse cx="880" cy="520" rx="270" ry="115"/><ellipse cx="1130" cy="460" rx="270" ry="140"/><rect x="-100" y="560" width="1400" height="200"/>',
  });

/** The hero's far bank. */
export const farBank = () =>
  clouds("farbank", {
    w: 1200, h: 700, vw: 1200, vh: 700, freq: 0.009, octaves: 4, seed: 7, displace: 120, blur: 10, opacity: 0.75, lit: "#f4f8ff", shade: "#f4f8ff",
    shapes: '<ellipse cx="120" cy="300" rx="230" ry="80"/><ellipse cx="1090" cy="270" rx="240" ry="90"/><ellipse cx="600" cy="330" rx="300" ry="60"/>',
  });

/** A big soft mass of cloud heaped on the left of the frame; mirrored, it is the right half. Flown through, pairs part. */
export const mass = (seed: number) =>
  clouds(`mass${seed}`, {
    w: 1000, h: 700, vw: 2000, vh: 1400, freq: 0.0075, octaves: 5, seed, displace: 260, blur: 14, lit: WHITE, shade: SHADE,
    shapes:
      '<ellipse cx="380" cy="700" rx="620" ry="520"/><ellipse cx="900" cy="520" rx="420" ry="300"/><ellipse cx="760" cy="1020" rx="520" ry="300"/><ellipse cx="1240" cy="760" rx="300" ry="220"/><ellipse cx="200" cy="260" rx="380" ry="220"/>',
  });

/** Thin streaks for the air between layers. */
export const wisps = (key: string, seed: number, lit: string, shade: string) =>
  clouds(key, {
    w: 900, h: 500, vw: 1800, vh: 1000, freq: 0.0075, octaves: 4, seed, displace: 240, blur: 10, opacity: 0.9, lit, shade,
    shapes:
      '<ellipse cx="420" cy="240" rx="520" ry="36"/><ellipse cx="1200" cy="380" rx="600" ry="46"/><ellipse cx="760" cy="600" rx="520" ry="32"/><ellipse cx="1500" cy="170" rx="320" ry="26"/><ellipse cx="300" cy="780" rx="340" ry="28"/>',
  });

const day = {
  glassTop: "#b9cdf2", glassMid: "#7d9be6", glassLow: "#2d4a93", sideTop: "#26407f", sideLow: "#16264a", frame: "#1f3263",
  sheen: PAGE, lit: "#f6c9ae", haze: "#dbe6f8", litP: 0.015, gridA: 0.32, reflectA: 0.3,
};
const dusk = {
  glassTop: "#f5c3a6", glassMid: "#9c7aa8", glassLow: "#2e2f5e", sideTop: "#2a2d57", sideLow: "#151a36", frame: "#24284d",
  sheen: "#ffd9bf", lit: "#ffd59a", haze: "#f3b393", litP: 0.08, gridA: 0.4, reflectA: 0.45,
};
const night = {
  glassTop: "#253a6b", glassMid: "#1a2a52", glassLow: "#0f1a36", sideTop: "#121d3a", sideLow: INK, frame: "#0f1830",
  sheen: "#7c96d0", lit: "#ffd08a", haze: "#1b2a55", litP: 0.34, gridA: 0.45, reflectA: 0, havenP: 0.016, haven: "#e9f0fd",
};

export const skyline = (tone: "day" | "dusk" | "night", layer: "far" | "mid" | "near") => {
  const base = tone === "day" ? day : tone === "dusk" ? dusk : night;
  const reflect = tone === "day" ? bank() : tone === "dusk" ? wisps("sunwisp", 41, "#ffd2b4", "#9a6f9e") : undefined;
  // Dusk and night share a skyline, so night falls on the same towers and their windows light up.
  const seed = tone === "day" ? 0 : 50;
  const shape =
    layer === "far"
      ? { w: 2600, h: 800, base: 800, seed: seed + 11, wMin: 50, wMax: 120, hMin: 140, hMax: 420, pane: 6, floor: 8, hazeTop: tone === "night" ? 0.35 : 0.6, hazeLow: tone === "night" ? 0.55 : 0.8 }
      : layer === "mid"
        ? { w: 2400, h: 1000, base: 1000, seed: seed + 23, wMin: 90, wMax: 210, hMin: 260, hMax: 640, pane: 9, floor: 12, hazeTop: tone === "night" ? 0.08 : 0.28, hazeLow: tone === "night" ? 0.3 : 0.52 }
        : { w: 2200, h: 1500, base: 1500, seed: seed + 31, wMin: 220, wMax: 300, hMin: 1360, hMax: 1500, pane: 18, floor: 26, hazeTop: 0.04, hazeLow: 0.2, ranges: [[0, 520], [1690, 2200]] as [number, number][] };
  return city(`${tone}-${layer}`, { ...base, ...shape, reflect });
};
