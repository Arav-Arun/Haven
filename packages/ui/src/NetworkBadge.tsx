"use client";

import type { AnonStatus } from "@haven/types";
import { ShieldAlert, ShieldCheck, ShieldEllipsis } from "lucide-react";
import { networkName } from "./format";

/** The live Anon-RPC status: green when private, grey while connecting, red whenever requests are not private. */
export function NetworkBadge({ status, compact = false }: { status: AnonStatus | null; compact?: boolean }) {
  if (!status) return null;
  const name = networkName(status.network);
  if (status.state === "ready")
    return (
      <span title={status.detail} className="inline-flex items-center gap-1.5 rounded-full bg-private-soft px-2.5 py-1 text-sm text-private">
        <ShieldCheck size={16} aria-hidden /> Private{compact ? "" : `: ${name}`}
      </span>
    );
  if (status.state === "connecting")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-line px-2.5 py-1 text-sm text-muted">
        <ShieldEllipsis size={16} className="animate-pulse" aria-hidden /> {compact ? "Connecting" : `Connecting privately (${name})…`}
      </span>
    );
  return (
    <span
      title={status.detail}
      role="alert"
      className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-danger-soft px-2.5 py-1 text-sm text-danger"
    >
      <ShieldAlert size={16} className="shrink-0" aria-hidden />
      <span className="truncate">
        Not private{!compact && status.detail ? `: ${status.detail}` : ""}
      </span>
    </span>
  );
}
