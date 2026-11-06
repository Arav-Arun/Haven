"use client";

import type { Receipt, ReceiptStep, Timestamp } from "@cloakroom/types";
import { Check, ExternalLink, LoaderCircle, ShieldCheck, ShieldOff, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { describeError } from "./errors";
import { formatAgo, formatBytes, networkName, shortAddress } from "./format";

function Step({ step }: { step: ReceiptStep }) {
  if (step.kind === "route")
    return (
      <li className="flex items-center gap-2">
        {step.route === "anon" ? (
          <ShieldCheck size={14} className="shrink-0 text-private" aria-hidden />
        ) : (
          <ShieldOff size={14} className="shrink-0 text-danger" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate">{step.label}</span>
        <span className={step.route === "anon" ? "text-private" : "text-danger"}>
          {step.route === "anon" ? `Private (${networkName(step.network)})` : "Direct"}
        </span>
      </li>
    );
  const ok = step.ok ? <Check size={14} className="shrink-0 text-private" aria-hidden /> : <X size={14} className="shrink-0 text-danger" aria-hidden />;
  if (step.kind === "check")
    return (
      <li className="flex items-start gap-2">
        <span className="mt-0.5">{ok}</span>
        <span className="min-w-0 flex-1">
          {step.label} <span className="text-muted">{step.detail}</span>
        </span>
      </li>
    );
  if (step.kind === "swarm")
    return (
      <li className="flex items-center gap-2">
        {ok}
        <span className="min-w-0 flex-1 truncate">{step.label}</span>
        <span className="text-muted" title={step.ref}>
          {shortAddress(step.ref)}, {formatBytes(step.paddedBytes)}
        </span>
      </li>
    );
  return (
    <li className="flex items-center gap-2">
      {ok}
      <span className="min-w-0 flex-1 truncate">{step.label}</span>
      <a
        href={step.explorerUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-1 underline decoration-line underline-offset-2"
        title={step.hash}
      >
        {step.kind === "sepolia-tx" ? "Sepolia" : "Arkiv"} {shortAddress(step.hash)}
        <ExternalLink size={12} aria-hidden />
      </a>
    </li>
  );
}

/** One receipt's steps, for showing progress inline (for example while claiming a name). */
export function ReceiptSteps({ receipt }: { receipt: Receipt }) {
  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {receipt.steps.map((s, i) => (
        <Step key={i} step={s} />
      ))}
    </ul>
  );
}

/** Every action's steps, newest first: transactions with explorer links, uploads, checks, and how each request was routed. */
export function ReceiptsDrawer({
  open,
  onClose,
  receipts,
  now,
}: {
  open: boolean;
  onClose: () => void;
  receipts: Receipt[];
  now: Timestamp;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label="Receipts"
      className="ml-auto mr-0 mt-0 h-dvh max-h-dvh w-full max-w-md border-l border-line bg-card p-0 text-ink"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold">Receipts</h2>
          <button onClick={onClose} className="rounded p-1 text-muted hover:text-ink" aria-label="Close">
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {receipts.length === 0 ? (
            <p className="text-sm text-muted">
              Nothing yet. Every action you take shows up here, with its transactions and how each request was routed.
            </p>
          ) : (
            <ol className="flex flex-col gap-5">
              {receipts.map((r) => (
                <li key={r.id} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="flex items-center gap-2 font-medium">
                      {!r.done && <LoaderCircle size={14} className="animate-spin" aria-label="In progress" />}
                      {r.done && r.error && <TriangleAlert size={14} className="text-danger" aria-label="Failed" />}
                      {r.action}
                    </h3>
                    <span className="text-xs text-muted">{formatAgo(r.startedAt, now)}</span>
                  </div>
                  <ReceiptSteps receipt={r} />
                  {r.error && <p className="text-sm text-danger">{describeError({ code: r.error }).title}.</p>}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </dialog>
  );
}
