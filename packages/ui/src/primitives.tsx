"use client";

import { LoaderCircle, TriangleAlert, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { CloudSummon, prepareSummon } from "./CloudSummon";
import { SkyTile } from "./Clouds";
import { describeError } from "./errors";
import { cx } from "./format";

type Variant = "primary" | "secondary" | "quiet" | "danger";

// Clay pills (styles.css) with the rising-circle hover (.fx): blue fills white, white fills blue. "quiet" stays flat.
const VARIANT: Record<Variant, string> = {
  primary: "btn-action fx",
  secondary: "btn-clay fx",
  quiet: "text-ink hover:bg-ink/5",
  danger: "btn-danger fx",
};

/**
 * The inside of an .fx pill: the circle that rises on hover, the label, and a copy of the label that rolls in.
 * The copy is hidden from screen readers, so the name is read once.
 */
export function FxLabel({ children }: { children: ReactNode }) {
  return (
    <>
      <span className="fx-circle" aria-hidden />
      <span className="fx-stack">
        <span className="fx-label">{children}</span>
        <span className="fx-hover" aria-hidden>
          {children}
        </span>
      </span>
    </>
  );
}

const BUTTON_BASE =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-4.5 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-55";

/** A Button's look, for links that should match the buttons beside them. */
export function buttonClass(variant: Variant = "secondary", className?: string): string {
  return cx(BUTTON_BASE, VARIANT[variant], className);
}

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
      className={buttonClass(variant, className)}
    >
      {pending && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
      {variant === "quiet" ? children : <FxLabel>{children}</FxLabel>}
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
  summon = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  /** Arrive out of cloud (CloudSummon) instead of just appearing. */
  summon?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [clouds, setClouds] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      const play = summon && !matchMedia("(prefers-reduced-motion: reduce)").matches;
      // Hide the surface and the form before the first frame shows, so only the clouds appear.
      if (play) prepareSummon(d, body.current);
      d.showModal();
      setClouds(play);
    }
    if (!open && d.open) d.close();
    if (!open) setClouds(false);
  }, [open, summon]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby={titleId}
      data-summon={summon ? "" : undefined}
      className={cx(
        "m-auto w-[calc(100%-2rem)] rounded-3xl border border-white bg-card p-0 text-ink shadow-[0_30px_70px_-24px_rgb(13_27_51/0.5)]",
        wide ? "max-w-3xl" : "max-w-lg",
      )}
    >
      {open && clouds && <CloudSummon dialog={ref} content={body} onDone={() => setClouds(false)} />}
      {open && (
        <div ref={body} className="relative flex flex-col gap-4 p-6">
          <div className="flex items-start justify-between gap-4">
            <h2 id={titleId} className="text-xl font-bold tracking-[-0.02em]">
              {title}
            </h2>
            <button onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-ink/5 hover:text-ink" aria-label="Close">
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
    <div role="alert" className={cx("flex gap-2 rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger", className)}>
      <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
      <p>
        <span className="font-medium">{e.title}.</span> {e.detail}
      </p>
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-[#c4d5f2] bg-white/60 px-6 py-8">
      <SkyTile>{icon}</SkyTile>
      <h3 className="font-semibold">{title}</h3>
      {children && <div className="flex max-w-prose flex-col items-start gap-3 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-xl bg-white/70" />
      ))}
    </div>
  );
}

export const inputClass =
  "w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-muted/70 focus:border-action focus:outline-none focus:ring-4 focus:ring-action/10";
