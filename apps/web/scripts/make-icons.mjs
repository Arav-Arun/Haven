// Draws Haven's app icon (an arched doorway with a keyhole, on a blue tile) as SVG and as PNGs for the PWA, iOS and
// the extension. Same shapes as components/landing/Logo.tsx. Run: node apps/web/scripts/make-icons.mjs. Outputs are committed.
import { writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";

const out = new URL("../public/", import.meta.url);
const TOP = [0x5b, 0x93, 0xff];
const BOTTOM = [0x1f, 0x4f, 0xd1];
const WHITE = [0xff, 0xff, 0xff];

// Geometry on the logo's 64 grid.
const ARCH = { left: 17, right: 47, cx: 32, cy: 30, r: 15, foot: 50, half: 3.25 };
const HOLE = { cx: 32, cy: 32, r: 5, top: 34.5, bottom: 44, topHalf: 2.4, bottomHalf: 4 };

function inRoundRect(x, y, { x0, y0, x1, y1, r }) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function onMark(x, y) {
  const d = (ax, ay) => Math.hypot(x - ax, y - ay);
  const nearLeg = (lx) => (y >= ARCH.cy && y <= ARCH.foot ? Math.abs(x - lx) : Math.min(d(lx, ARCH.cy), d(lx, ARCH.foot)));
  const nearCurve = y <= ARCH.cy ? Math.abs(d(ARCH.cx, ARCH.cy) - ARCH.r) : Infinity;
  if (Math.min(nearLeg(ARCH.left), nearLeg(ARCH.right), nearCurve) <= ARCH.half) return true;
  if (d(HOLE.cx, HOLE.cy) <= HOLE.r) return true;
  if (y >= HOLE.top && y <= HOLE.bottom) {
    const t = (y - HOLE.top) / (HOLE.bottom - HOLE.top);
    return Math.abs(x - HOLE.cx) <= HOLE.topHalf + t * (HOLE.bottomHalf - HOLE.topHalf);
  }
  return false;
}

/** Colour at (x, y) on a 512 grid. Maskable icons fill the square and shrink the mark into the safe zone. */
function paint(x, y, maskable) {
  if (!maskable && !inRoundRect(x, y, { x0: 0, y0: 0, x1: 512, y1: 512, r: 144 })) return null;
  const t = y / 512;
  const bg = TOP.map((v, i) => Math.round(v + (BOTTOM[i] - v) * t));
  const k = maskable ? 0.78 : 1;
  const gx = ((x - 256) / k + 256) / 8;
  const gy = ((y - 256) / k + 256) / 8;
  return onMark(gx, gy) ? WHITE : bg;
}

function png(size, maskable) {
  const S = 4; // 4x4 samples per pixel for smooth edges
  const scale = 512 / size;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const c = paint((px + (sx + 0.5) / S) * scale, (py + (sy + 0.5) / S) * scale, maskable);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a++;
        }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      raw[o] = a ? Math.round(r / a) : 0;
      raw[o + 1] = a ? Math.round(g / a) : 0;
      raw[o + 2] = a ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round((a / (S * S)) * 255);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b93ff"/><stop offset="1" stop-color="#1f4fd1"/></linearGradient></defs>
  <rect width="64" height="64" rx="18" fill="url(#g)"/>
  <path d="M17 50V30a15 15 0 0 1 30 0v20" fill="none" stroke="#fff" stroke-width="6.5" stroke-linecap="round"/>
  <circle cx="32" cy="32" r="5" fill="#fff"/><path d="M29.6 34.5h4.8l1.6 9.5h-8z" fill="#fff"/>
</svg>
`;

writeFileSync(new URL("icon.svg", out), svg);
writeFileSync(new URL("icon-192.png", out), png(192, false));
writeFileSync(new URL("icon-512.png", out), png(512, false));
writeFileSync(new URL("icon-maskable-512.png", out), png(512, true));
writeFileSync(new URL("apple-touch-icon.png", out), png(180, true));
// The browser extension's toolbar and store icons.
const ext = new URL("../../extension/public/icon/", import.meta.url);
for (const size of [16, 32, 48, 128]) writeFileSync(new URL(`${size}.png`, ext), png(size, false));
console.log("icons written");
