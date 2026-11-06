// A glass tower drawn as vectors, so the camera can fly right up to a single pane and it stays sharp.
// Returned as SVG markup for a static <g>: it holds no user data.

import { rng } from "./textures";

export interface TowerSpec {
  /** prefix for every id inside, unique per tower */
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  cols: number;
  rows: number;
  /** width of the shaded side face */
  side: number;
  seed: number;
  /** the frosted pane, [column, row] */
  frost: [number, number];
  /** panes you can see into, as "column,row" */
  rooms: string[];
  /** a cloud texture reflected in the glass */
  reflect?: string;
}

const f = (n: number) => n.toFixed(1);

export function paneRect(o: TowerSpec, c: number, row: number) {
  const pw = o.w / o.cols;
  const fh = o.h / o.rows;
  return { x: o.x + c * pw + 2.2, y: o.y + row * fh + fh * 0.2, w: pw - 2.2, h: fh * 0.8 };
}

function room(id: string, x: number, y: number, w: number, h: number) {
  const body = "#5b4740";
  return (
    `<g><rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="url(#${id}-room)"/>` +
    `<rect x="${f(x + w * 0.56)}" y="${f(y + h * 0.3)}" width="${f(w * 0.24)}" height="${f(h * 0.26)}" fill="#9db6ef"/>` +
    `<circle cx="${f(x + w * 0.3)}" cy="${f(y + h * 0.36)}" r="${f(h * 0.1)}" fill="${body}" opacity=".8"/>` +
    `<path d="M${f(x + w * 0.18)} ${f(y + h * 0.66)} Q${f(x + w * 0.18)} ${f(y + h * 0.47)} ${f(x + w * 0.3)} ${f(y + h * 0.47)} Q${f(x + w * 0.42)} ${f(y + h * 0.47)} ${f(x + w * 0.42)} ${f(y + h * 0.66)} Z" fill="${body}" opacity=".8"/>` +
    `<rect x="${f(x + w * 0.08)}" y="${f(y + h * 0.64)}" width="${f(w * 0.84)}" height="${f(h * 0.07)}" fill="#6b5148"/>` +
    `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="url(#${id}-sheen)"/></g>`
  );
}

export function tower(o: TowerSpec): string {
  const pw = o.w / o.cols;
  const fh = o.h / o.rows;
  const { id, x: X, y: Y } = o;
  const r = rng(o.seed);
  let s =
    `<defs>` +
    `<linearGradient id="${id}-face" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b3c7f0"/><stop offset=".4" stop-color="#6f8fe0"/><stop offset="1" stop-color="#1f3a80"/></linearGradient>` +
    `<linearGradient id="${id}-side" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a4486"/><stop offset="1" stop-color="#14234a"/></linearGradient>` +
    `<linearGradient id="${id}-sheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".42" stop-color="#fff" stop-opacity=".32"/><stop offset=".56" stop-color="#fff" stop-opacity=".05"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="${id}-room" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbe9dc"/><stop offset="1" stop-color="#a7826f"/></linearGradient>` +
    `<radialGradient id="${id}-frost" cx=".5" cy=".45" r=".72"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#e8effc"/><stop offset="1" stop-color="#bcd0f4"/></radialGradient>` +
    `<radialGradient id="${id}-glow"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
    `<pattern id="${id}-grid" x="${X}" y="${Y}" width="${pw}" height="${fh}" patternUnits="userSpaceOnUse"><rect width="${pw}" height="${f(fh * 0.2)}" fill="#1c3062" opacity=".6"/><rect width="2.2" height="${fh}" fill="#c9d8f5" opacity=".55"/></pattern>` +
    `<clipPath id="${id}-clip"><rect x="${X}" y="${Y}" width="${o.w}" height="${o.h}"/></clipPath></defs>`;
  // crown and mast, then the shaded side, then the glass front
  s += `<rect x="${X + 46}" y="${Y - 64}" width="${o.w - 92}" height="66" fill="url(#${id}-side)"/><rect x="${X + o.w / 2 - 2}" y="${Y - 190}" width="4" height="128" fill="#2a4486"/>`;
  s += `<path d="M${X + o.w} ${Y} L${X + o.w + o.side} ${Y + 22} V${Y + o.h} H${X + o.w} Z" fill="url(#${id}-side)"/>`;
  s += `<rect x="${X}" y="${Y}" width="${o.w}" height="${o.h}" fill="url(#${id}-face)"/>`;
  if (o.reflect) {
    s += `<g clip-path="url(#${id}-clip)"><image href="${o.reflect}" x="${X - 420}" y="${Y - 80}" width="1300" height="760" preserveAspectRatio="none" opacity=".42"/></g>`;
  }
  for (let c = 0; c < o.cols; c++) {
    for (let row = 0; row < o.rows; row++) {
      const q = r();
      const p = paneRect(o, c, row);
      if (o.frost[0] === c && o.frost[1] === row) continue;
      if (o.rooms.includes(`${c},${row}`)) {
        s += room(id, p.x, p.y, p.w, p.h);
        continue;
      }
      if (q < 0.55) {
        s += `<rect x="${f(p.x)}" y="${f(p.y)}" width="${f(p.w)}" height="${f(p.h)}" fill="${q < 0.3 ? "#ffffff" : "#0d1b33"}" opacity="${(0.03 + r() * 0.1).toFixed(3)}"/>`;
      }
    }
  }
  s +=
    `<rect x="${X}" y="${Y}" width="${o.w}" height="${o.h}" fill="url(#${id}-grid)"/>` +
    `<rect x="${X}" y="${Y}" width="${o.w}" height="${o.h}" fill="url(#${id}-sheen)"/>` +
    `<rect x="${X}" y="${Y}" width="3" height="${o.h}" fill="#fff" opacity=".65"/>`;
  const fp = paneRect(o, o.frost[0], o.frost[1]);
  const MARK = 15;
  const mx = fp.x + fp.w / 2 - MARK / 2;
  const my = fp.y + fp.h / 2 - MARK / 2;
  s +=
    `<rect class="${id}-halo" x="${f(fp.x - fp.w * 1.6)}" y="${f(fp.y - fp.h * 1.6)}" width="${f(fp.w * 4.2)}" height="${f(fp.h * 4.2)}" fill="url(#${id}-glow)"/>` +
    `<rect x="${f(fp.x)}" y="${f(fp.y)}" width="${f(fp.w)}" height="${f(fp.h)}" fill="url(#${id}-frost)"/>` +
    // Haven's mark, etched faintly into the frost: the logo file as a mask over a fill, so it takes the frost's blue
    `<mask id="${id}-mark" maskUnits="userSpaceOnUse"><image href="/haven-mark.webp" x="${f(mx)}" y="${f(my)}" width="${MARK}" height="${MARK}"/></mask>` +
    `<rect x="${f(mx)}" y="${f(my)}" width="${MARK}" height="${MARK}" fill="#1f4fd1" opacity=".2" mask="url(#${id}-mark)"/>` +
    `<rect x="${f(fp.x)}" y="${f(fp.y)}" width="${f(fp.w)}" height="${f(fp.h)}" fill="none" stroke="#fff" stroke-width=".9"/>`;
  return s;
}
