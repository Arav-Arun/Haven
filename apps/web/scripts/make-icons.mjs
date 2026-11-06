// Draws the app icon (a coat-check ticket on spruce) as SVG and as PNGs for the PWA and iOS.
// Run: node apps/web/scripts/make-icons.mjs. Outputs go to apps/web/public and are committed.
import { writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";

const out = new URL("../public/", import.meta.url);
const INK = [0x16, 0x30, 0x2a];
const TICKET = [0xf3, 0xdd, 0xb0];
const EDGE = [0xd8, 0xb9, 0x7f];
const STAMP = [0x9c, 0x2b, 0x21];

// Geometry on a 512 grid. The ticket fits inside the maskable safe zone (a circle of radius 204.8).
const T = { x0: 96, y0: 160, x1: 416, y1: 352, r: 18 };
const NOTCH_X = 192;
const NOTCH_R = 22;
const DOTS = Array.from({ length: 6 }, (_, i) => 200 + i * 22);
const BARS = [
  { x0: 232, y0: 206, x1: 384, y1: 236, c: STAMP },
  { x0: 232, y0: 258, x1: 360, y1: 272, c: INK },
  { x0: 232, y0: 290, x1: 330, y1: 304, c: INK },
];

function inRoundRect(x, y, { x0, y0, x1, y1, r }) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function paint(x, y, maskable) {
  if (!maskable && !inRoundRect(x, y, { x0: 0, y0: 0, x1: 512, y1: 512, r: 112 })) return null;
  let c = INK;
  if (inRoundRect(x, y, T) && (x - NOTCH_X) ** 2 + (y - T.y0) ** 2 > NOTCH_R ** 2 && (x - NOTCH_X) ** 2 + (y - T.y1) ** 2 > NOTCH_R ** 2) {
    c = TICKET;
    if (DOTS.some((dy) => (x - NOTCH_X) ** 2 + (y - dy) ** 2 <= 25)) c = EDGE;
    for (const b of BARS) if (inRoundRect(x, y, { ...b, r: 4 })) c = b.c;
  }
  return c;
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

const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="${hex(INK)}"/>
  <mask id="m"><rect x="${T.x0}" y="${T.y0}" width="${T.x1 - T.x0}" height="${T.y1 - T.y0}" rx="${T.r}" fill="#fff"/>
    <circle cx="${NOTCH_X}" cy="${T.y0}" r="${NOTCH_R}"/><circle cx="${NOTCH_X}" cy="${T.y1}" r="${NOTCH_R}"/></mask>
  <rect x="${T.x0}" y="${T.y0}" width="${T.x1 - T.x0}" height="${T.y1 - T.y0}" fill="${hex(TICKET)}" mask="url(#m)"/>
  ${DOTS.map((y) => `<circle cx="${NOTCH_X}" cy="${y}" r="5" fill="${hex(EDGE)}"/>`).join("")}
  ${BARS.map((b) => `<rect x="${b.x0}" y="${b.y0}" width="${b.x1 - b.x0}" height="${b.y1 - b.y0}" rx="4" fill="${hex(b.c)}"/>`).join("")}
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
