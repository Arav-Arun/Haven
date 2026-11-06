"use client";

// The landing page's clouds, for the app: soft white shapes pushed around by turbulence, drawn in SVG so nothing
// loads from elsewhere. Decoration only: hidden from screen readers and never in the way of clicks.

import { useId, type ReactNode } from "react";
import { cx } from "./format";

/** useId can contain characters that break url(#...) references. */
function useSvgId(prefix: string) {
  return `${prefix}${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

/** A low bank of cloud along the top of a page. Place it inside a positioned parent. */
export function CloudBank({ className }: { className?: string }) {
  const id = useSvgId("cloud-bank");
  return (
    <svg
      aria-hidden
      className={cx(
        "pointer-events-none absolute inset-x-0 top-0 h-[340px] w-full mask-[linear-gradient(to_bottom,#000_55%,transparent)]",
        className,
      )}
      viewBox="0 0 1440 340"
      preserveAspectRatio="xMidYMin slice"
    >
      <defs>
        <filter id={`${id}-far`} x="-20%" y="-60%" width="140%" height="220%">
          <feTurbulence type="fractalNoise" baseFrequency="0.008" numOctaves="4" seed="5" />
          <feDisplacementMap in="SourceGraphic" scale="110" />
          <feGaussianBlur stdDeviation="12" />
        </filter>
        <filter id={`${id}-near`} x="-20%" y="-60%" width="140%" height="220%">
          <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="5" seed="9" />
          <feDisplacementMap in="SourceGraphic" scale="130" />
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
      <g filter={`url(#${id}-far)`} fill="#f4f8ff" opacity="0.8">
        <ellipse cx="260" cy="70" rx="300" ry="60" />
        <ellipse cx="900" cy="50" rx="340" ry="55" />
        <ellipse cx="1360" cy="90" rx="260" ry="60" />
      </g>
      <g filter={`url(#${id}-near)`} fill="#ffffff" opacity="0.95">
        <ellipse cx="80" cy="170" rx="230" ry="70" />
        <ellipse cx="620" cy="190" rx="200" ry="50" />
        <ellipse cx="1180" cy="160" rx="250" ry="72" />
      </g>
    </svg>
  );
}

/** A small square of sky with a cloud at its base, holding an icon: the landing's little scenes, in miniature. */
export function SkyTile({ children, className }: { children: ReactNode; className?: string }) {
  const id = useSvgId("sky-tile");
  return (
    <span
      aria-hidden
      className={cx(
        "relative flex size-14 items-center justify-center overflow-hidden rounded-2xl text-white",
        "bg-[radial-gradient(90%_60%_at_30%_0%,rgb(255_255_255/0.25),transparent_60%),linear-gradient(180deg,#4a82ea_0%,#79a7f1_45%,#b8d0f6_100%)]",
        "shadow-[inset_0_1px_0_rgb(255_255_255/0.5),0_12px_24px_-12px_rgb(31_79_209/0.6)]",
        className,
      )}
    >
      <svg aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 w-full" viewBox="0 0 56 28" preserveAspectRatio="none">
        <defs>
          <filter id={id} x="-20%" y="-60%" width="140%" height="220%">
            <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="3" seed="4" />
            <feDisplacementMap in="SourceGraphic" scale="9" />
            <feGaussianBlur stdDeviation="0.8" />
          </filter>
        </defs>
        <g filter={`url(#${id})`} fill="#ffffff" opacity="0.92">
          <ellipse cx="10" cy="26" rx="16" ry="9" />
          <ellipse cx="30" cy="27" rx="15" ry="7" />
          <ellipse cx="48" cy="25" rx="14" ry="9" />
        </g>
      </svg>
      <span className="relative drop-shadow-[0_2px_6px_rgb(20_60_150/0.45)]">{children}</span>
    </span>
  );
}
