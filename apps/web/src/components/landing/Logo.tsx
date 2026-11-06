// Haven's mark: an arched doorway with a keyhole: a safe place you hold the key to. Drawn here, so nothing loads.

import type { SVGProps } from "react";

/** The mark on a blue tile (the app icon uses the same shapes; see scripts/make-icons.mjs). */
export function HavenMark({ size = 36, ...p }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden {...p}>
      <defs>
        <linearGradient id="haven-tile" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5b93ff" />
          <stop offset="1" stopColor="#1f4fd1" />
        </linearGradient>
        <linearGradient id="haven-shine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.45" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill="url(#haven-tile)" />
      <rect width="64" height="64" rx="18" fill="url(#haven-shine)" />
      {/* the arch: a doorway with rounded feet */}
      <path d="M17 50V30a15 15 0 0 1 30 0v20" fill="none" stroke="#fff" strokeWidth="6.5" strokeLinecap="round" />
      {/* the keyhole */}
      <circle cx="32" cy="32" r="5" fill="#fff" />
      <path d="M29.6 34.5h4.8l1.6 9.5h-8z" fill="#fff" />
    </svg>
  );
}

export function HavenLogo({ tone = "dark", size = 34 }: { tone?: "dark" | "light"; size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <HavenMark size={size} className="drop-shadow-[0_6px_14px_rgb(31_79_209_/_0.35)]" />
      <span className={`text-[21px] font-bold tracking-[-0.03em] ${tone === "light" ? "text-white" : "text-[#0d1b33]"}`}>Haven</span>
    </span>
  );
}
