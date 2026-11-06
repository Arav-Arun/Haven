"use client";

// A small pill at the bottom of the screen while an action is running: a spinner, what is being done, the step it's on
// in plain words, and the seconds so far. It is a popover, so it shows above an open dialog too.

import type { Receipt, ReceiptStep, Timestamp } from "@haven/types";
import { LoaderCircle } from "lucide-react";
import { useEffect, useRef } from "react";

/** The step a receipt is on, said plainly. Route steps are logged as each request starts, so the latest is current. */
export function describeStep(step: ReceiptStep | undefined): string {
  if (!step) return "Starting";
  const l = step.label;
  if (step.kind === "route") {
    if (l.includes("/room")) return "Creating the room on Sepolia";
    if (l.includes("/claim")) return "Registering your name on Sepolia";
    if (l.includes("/drip")) return "Getting free test gas";
    if (l.includes("/keylog")) return "Publishing your public key on Arkiv";
    if (l.includes("/doorbell")) return "Telling members something changed";
    if (/upload/i.test(l)) return "Uploading the encrypted file to Swarm";
    if (/download/i.test(l)) return "Downloading from Swarm";
    if (/arkiv transactions/i.test(l)) return "Writing encrypted records to Arkiv";
    if (/sepolia transactions/i.test(l)) return "Sending a transaction on Sepolia";
    if (/arkiv/i.test(l)) return "Reading from Arkiv";
    if (/sepolia/i.test(l)) return "Reading from Sepolia";
    return l;
  }
  if (step.kind === "check") {
    if (/gas requested/i.test(l)) return "Waiting for free test gas";
    if (/proof of work/i.test(l)) return "Solving a small proof of work";
    return l;
  }
  if (step.kind === "sepolia-tx") return `Confirmed on Sepolia: ${l}`;
  if (step.kind === "arkiv-tx") return `Saved on Arkiv: ${l}`;
  return "Stored on Swarm";
}

export function ActivityPill({ receipts, now }: { receipts: Receipt[]; now: Timestamp }) {
  const ref = useRef<HTMLDivElement>(null);
  const running = receipts.filter((r) => !r.done);
  const current = running.sort((a, b) => b.startedAt - a.startedAt)[0];

  // Shown as a manual popover: the top layer, above any open <dialog>. Raised again when a new action starts.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.showPopover !== "function") return;
    if (current) {
      if (el.matches(":popover-open")) el.hidePopover();
      el.showPopover();
    } else if (el.matches(":popover-open")) el.hidePopover();
  }, [current?.id]);

  const secs = current ? Math.max(0, now - current.startedAt) : 0;
  return (
    <div ref={ref} popover="manual" role="status" aria-live="polite" className="activity-pill">
      {current && (
        <div className="flex items-center gap-3 rounded-full bg-ink py-2.5 pl-3.5 pr-4 text-sm text-white shadow-[0_18px_40px_-16px_rgb(13_27_51/0.7)]">
          <LoaderCircle size={18} className="shrink-0 animate-spin text-white/80" aria-hidden />
          <span className="min-w-0">
            <span className="block truncate font-semibold">{current.action}</span>
            <span className="block truncate text-white/70">{describeStep(current.steps.at(-1))}…</span>
          </span>
          <span className="ml-1 shrink-0 tabular-nums text-white/60">{secs} s</span>
          {running.length > 1 && <span className="shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-xs">+{running.length - 1}</span>}
        </div>
      )}
    </div>
  );
}
