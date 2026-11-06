"use client";

import { Camera, Check, TriangleAlert, Upload } from "lucide-react";
import { useId, useRef, useState } from "react";
import { describeError } from "./errors";
import { cx, formatBytes } from "./format";

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  fraction: number;
  state: "uploading" | "done" | "failed";
  /** Read from the upload's Swarm receipt step: the size anyone can see. */
  paddedBytes?: number;
  error?: unknown;
}

/** Drop files, pick them, or take a photo. Shows per-file progress and the padded size once it's known. */
export function UploadDropzone({
  onFiles,
  uploads,
  disabled,
  disabledReason,
}: {
  onFiles: (files: File[]) => void;
  uploads: UploadItem[];
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [over, setOver] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const take = (list: FileList | null) => {
    if (!disabled && list?.length) onFiles(Array.from(list));
  };
  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files);
        }}
        className={cx(
          "flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-6 text-center text-sm transition-colors",
          over ? "border-action bg-action-soft" : "border-[#c4d5f2] bg-white/60",
          disabled && "opacity-60",
        )}
      >
        <p id={hintId} className="text-muted">
          {disabled
            ? disabledReason
            : "Drop files here. Each is encrypted on this device and padded to a standard size, so its real size stays private."}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            onClick={() => pick.current?.click()}
            disabled={disabled}
            aria-describedby={hintId}
            className="inline-flex items-center gap-2 btn-action rounded-full px-4 py-2 font-semibold disabled:opacity-55"
          >
            <Upload size={16} aria-hidden /> Choose files
          </button>
          <button
            onClick={() => camera.current?.click()}
            disabled={disabled}
            className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-4 py-2 font-medium sm:hidden"
          >
            <Camera size={16} aria-hidden /> Take a photo
          </button>
        </div>
        <input ref={pick} type="file" multiple hidden onChange={(e) => (take(e.target.files), (e.target.value = ""))} />
        <input
          ref={camera}
          type="file"
          accept="image/*,video/*"
          capture="environment"
          hidden
          onChange={(e) => (take(e.target.files), (e.target.value = ""))}
        />
      </div>

      {uploads.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Uploads">
          {uploads.map((u) => (
            <li key={u.id} className="rounded-xl border border-line bg-card px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate font-medium">{u.name}</span>
                <span className="shrink-0 text-muted">
                  {u.state === "done" && (
                    <span className="inline-flex items-center gap-1 text-private">
                      <Check size={14} aria-hidden /> Uploaded
                    </span>
                  )}
                  {u.state === "uploading" && `${Math.round(u.fraction * 100)}%`}
                  {u.state === "failed" && (
                    <span className="inline-flex items-center gap-1 text-danger">
                      <TriangleAlert size={14} aria-hidden /> Failed
                    </span>
                  )}
                </span>
              </div>
              {u.state === "uploading" && (
                <progress className="mt-2 h-1.5 w-full accent-action" value={u.fraction} max={1} aria-label={`Uploading ${u.name}`} />
              )}
              <p className="mt-1 text-xs text-muted">
                {formatBytes(u.size)}
                {u.paddedBytes !== undefined && `. Padded to ${formatBytes(u.paddedBytes)}: that's all anyone else can see`}
                {u.state === "failed" && `. ${describeError(u.error).title}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
