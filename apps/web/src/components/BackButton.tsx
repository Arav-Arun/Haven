"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

/**
 * Back to the page you came from, or to `fallback` when this page was opened on its own (a new tab, a shared link).
 * Styled like the folder page's Back.
 */
export function BackButton({ fallback, className = "" }: { fallback: string; className?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? router.back() : router.push(fallback))}
      className={`inline-flex min-h-9 items-center gap-1.5 self-start rounded-full bg-white/70 py-1.5 pl-2.5 pr-3.5 text-sm font-medium text-muted ring-1 ring-ink/[0.06] transition-colors hover:bg-white hover:text-ink ${className}`}
    >
      <ArrowLeft size={16} aria-hidden /> Back
    </button>
  );
}
