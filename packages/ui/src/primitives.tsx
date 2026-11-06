"use client";

import { LoaderCircle, TriangleAlert, X } from "lucide-react";
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { describeError } from "./errors";
import { cx } from "./format";

type Variant = "primary" | "secondary" | "quiet" | "danger";

const VARIANT: Record<Variant, string> = {
  primary: "bg-ink text-paper hover:bg-ink/90",
  secondary: "border border-line bg-card text-ink hover:border-ink/40",
  quiet: "text-ink hover:bg-line/60",
  danger: "bg-danger text-paper hover:bg-danger/90",
};

export function Button({
  variant = "secondary",
  pending = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; pending?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cx(
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55",
        VARIANT[variant],
        className,
      )}
    >
      {pending && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/** A modal built on the native <dialog>: focus trapping, Escape and the backdrop come from the browser. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
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
      aria-labelledby={titleId}
      className={cx(
        "m-auto w-[calc(100%-2rem)] rounded-lg border border-line bg-card p-0 text-ink shadow-[0_18px_50px_-20px_rgb(22_48_42/0.45)]",
        wide ? "max-w-3xl" : "max-w-lg",
      )}
    >
      {open && (
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-4">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            <button onClick={onClose} className="rounded p-1 text-muted hover:text-ink" aria-label="Close">
              <X size={18} aria-hidden />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

/** An error shown next to the action that failed, in the interface's words. */
export function ErrorNote({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  const e = describeError(error);
  return (
    <div role="alert" className={cx("flex gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger", className)}>
      <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
      <p>
        <span className="font-medium">{e.title}.</span> {e.detail}
      </p>
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-line px-5 py-8">
      <span className="text-muted" aria-hidden>
        {icon}
      </span>
      <h3 className="font-medium">{title}</h3>
      {children && <div className="flex max-w-prose flex-col items-start gap-3 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-md bg-line/60" />
      ))}
    </div>
  );
}

export const inputClass =
  "w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:border-ink focus:outline-none";
