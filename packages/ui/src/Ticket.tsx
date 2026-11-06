"use client";

import type { Role, Timestamp } from "@cloakroom/types";
import type { ReactNode } from "react";
import { cx, formatDate, formatUntil, ROLE_LABEL, ticketSerial } from "./format";

/**
 * An access ticket: a coat-check stub for one person's access to one folder.
 * The serial is the random address the chain shows for them, so what you see on the stub is exactly what anyone
 * can look up, and nothing more.
 */
export function Ticket({
  address,
  title,
  subtitle,
  role,
  until,
  now,
  tags,
  actions,
}: {
  address: string;
  title: ReactNode;
  subtitle?: ReactNode;
  role: Role | "owner";
  until: Timestamp | null;
  now: Timestamp;
  tags?: ReactNode;
  actions?: ReactNode;
}) {
  const ended = until !== null && until <= now;
  return (
    <div className={cx("ticket flex min-h-[88px] items-stretch text-ink", ended && "ticket-ended")}>
      <div className="flex w-[72px] shrink-0 flex-col items-center justify-center px-1 text-stamp" title={address}>
        <span className="text-[10px] leading-none">No.</span>
        <span className="font-display text-[22px] font-bold leading-none tracking-wide [font-variant-numeric:tabular-nums]">
          {ticketSerial(address)}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 pl-4 pr-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{title}</p>
          {subtitle && <p className="truncate text-sm text-ink/70">{subtitle}</p>}
          {tags && <div className="mt-1.5 flex flex-wrap gap-1.5">{tags}</div>}
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-medium">{ROLE_LABEL[role]}</p>
            <p
              className={cx("text-sm", ended ? "text-stamp" : "text-ink/70")}
              title={until === null ? undefined : formatDate(until)}
            >
              <time dateTime={until === null ? undefined : new Date(until * 1000).toISOString()}>{formatUntil(until, now)}</time>
            </p>
          </div>
          {actions}
        </div>
      </div>
    </div>
  );
}

export function Tag({ tone = "plain", children, title }: { tone?: "plain" | "warn" | "danger"; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs",
        tone === "plain" && "bg-ink/8 text-ink",
        tone === "warn" && "bg-warn-soft text-warn",
        tone === "danger" && "bg-danger-soft text-danger",
      )}
    >
      {children}
    </span>
  );
}
