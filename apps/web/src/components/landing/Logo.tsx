// Haven's mark: a shield holding a database over linked blocks: your files, kept safe onchain. Drawn from
// public/haven-mark.webp (19 KB) as a mask, so it takes the text colour. The app icons come from the same file
// (scripts/make-icons.py).

import type { CSSProperties } from "react";

const MASK = "url(/haven-mark.webp) center / contain no-repeat";

export function HavenMark({ size = 36, className = "", style }: { size?: number; className?: string; style?: CSSProperties }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 bg-current ${className}`}
      style={{ width: size, height: size, WebkitMask: MASK, mask: MASK, ...style }}
    />
  );
}

export function HavenLogo({ tone = "dark", size = 34 }: { tone?: "dark" | "light"; size?: number }) {
  return (
    <span className={`inline-flex items-center gap-2 ${tone === "light" ? "text-white" : "text-[#0d1b33]"}`}>
      <HavenMark size={Math.round(size * 0.85)} />
      <span className="text-[21px] font-bold tracking-[-0.03em]">Haven</span>
    </span>
  );
}
