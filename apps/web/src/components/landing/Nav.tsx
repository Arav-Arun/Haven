"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { HavenLogo } from "./Logo";

export const NAV = [
  ["How it works", "#how"],
  ["Features", "#features"],
  ["Tracks", "#tracks"],
  ["Privacy", "#privacy"],
  ["FAQ", "#faq"],
] as const;

/** On the sky at the top of the page; a floating white pill once you scroll past the hero's first screen. */
export function Nav({ cta }: { cta: { href: string; label: string } }) {
  const [floating, setFloating] = useState(false);
  useEffect(() => {
    const on = () => setFloating(window.scrollY > 120);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-6 sm:pt-5">
      <header
        data-floating={floating}
        className={`nav-bar pointer-events-auto mx-auto flex items-center justify-between gap-4 rounded-full px-4 py-2.5 sm:px-5 ${floating ? "max-w-5xl" : "max-w-[calc(100%-1rem)]"}`}
      >
        <Link href="/" aria-label="Haven home">
          <HavenLogo tone={floating ? "dark" : "light"} size={32} />
        </Link>
        <nav aria-label="Sections" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {NAV.map(([label, href]) => (
              <li key={href}>
                <a
                  href={href}
                  className={`rounded-full px-3.5 py-2 text-[15px] transition-colors ${floating ? "text-[#0d1b33]/70 hover:text-[#0d1b33]" : "text-white/85 hover:bg-white/15 hover:text-white"}`}
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <Link
          href={cta.href}
          className={`rounded-full px-5 py-2.5 text-[15px] font-semibold transition-colors ${floating ? "bg-[#1f4fd1] text-white hover:bg-[#1a43b3]" : "bg-white text-[#1f4fd1] hover:bg-white/90"}`}
        >
          {cta.label}
        </Link>
      </header>
    </div>
  );
}
