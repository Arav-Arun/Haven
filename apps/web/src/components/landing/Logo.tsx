// Haven's mark: a shield holding a database over linked blocks, your files kept safe onchain, in white on a blue clay
// tile. The shield is public/haven-mark.webp (19 KB) used as a mask; the tile, its shine and its soft clay shadows are
// CSS. The app icons are the same tile (scripts/make-icons.py).

import type { CSSProperties } from "react";

const MASK = "url(/haven-mark.webp) center / contain no-repeat";

/** The shield alone, as line art in the text colour: for the navigation bars, where the tile would be too loud. */
export function HavenLine({ size = 36, className = "", style }: { size?: number; className?: string; style?: CSSProperties }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 bg-current ${className}`}
      style={{ width: size, height: size, WebkitMask: MASK, mask: MASK, ...style }}
    />
  );
}

export function HavenMark({ size = 36, className = "", style }: { size?: number; className?: string; style?: CSSProperties }) {
  const k = size / 36;
  const px = (v: number) => `${(v * k).toFixed(2)}px`;
  return (
    <span
      aria-hidden
      className={`relative inline-grid shrink-0 place-items-center overflow-hidden ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: "linear-gradient(180deg, #5b93ff, #1f4fd1)",
        boxShadow: `inset 0 ${px(1.5)} ${px(2)} rgb(255 255 255 / 0.55), inset 0 ${px(-2.5)} ${px(5)} rgb(13 27 51 / 0.28), 0 ${px(6)} ${px(14)} ${px(-5)} rgb(31 79 209 / 0.55)`,
        ...style,
      }}
    >
      <span className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgb(255 255 255 / 0.45), rgb(255 255 255 / 0) 50%)" }} />
      <span className="relative bg-white" style={{ width: size * 0.66, height: size * 0.66, WebkitMask: MASK, mask: MASK }} />
    </span>
  );
}

/** The mark and the word. `line` swaps the clay tile for the line-art shield (the navigation bars use it). */
export function HavenLogo({ tone = "dark", size = 34, line = false }: { tone?: "dark" | "light"; size?: number; line?: boolean }) {
  return (
    <span className={`inline-flex items-center ${tone === "light" ? "text-white" : "text-[#0d1b33]"}`} style={{ gap: Math.round(size * 0.24) }}>
      {line ? <HavenLine size={Math.round(size * 0.85)} /> : <HavenMark size={Math.round(size * 0.85)} />}
      {/* The word is sized from the mark, so the two read as one height at any size. */}
      <span className="font-bold leading-none tracking-[-0.03em]" style={{ fontSize: Math.round(size * 0.66) }}>
        Haven
      </span>
    </span>
  );
}
