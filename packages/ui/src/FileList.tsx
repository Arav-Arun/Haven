"use client";

import type { FileEntry, Folder, Timestamp } from "@haven/types";
import { ChevronRight, Download, Eye, FileText, Folder as FolderIcon, History, Link2, Lock, ShieldCheck, Trash2, Users } from "lucide-react";
import type { ReactNode } from "react";
import { cx, formatAgo, formatBytes, formatDate, formatUntil, ROLE_LABEL } from "./format";

function Row({ children, locked = false }: { children: ReactNode; locked?: boolean }) {
  return (
    <li className={cx("flex min-h-14 items-center gap-3 border-b border-line px-1 py-2 last:border-b-0", locked && "text-muted")}>
      {children}
    </li>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="rounded-xl p-2 text-muted hover:bg-line/60 hover:text-ink">
      {children}
    </button>
  );
}

/** Folders, rooms or groups. `onOpen` gets the folder's registry address. */
export function FolderRows({ folders, onOpen, now }: { folders: Folder[]; onOpen: (f: Folder) => void; now: Timestamp }) {
  if (!folders.length) return null;
  return (
    <ul className="surface rounded-2xl px-3">
      {folders.map((f) => (
        <Row key={f.registry}>
          <button onClick={() => onOpen(f)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
            <FolderIcon size={20} className="shrink-0 text-ink/70" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{f.displayName}</span>
              <span className="block truncate text-xs text-muted">
                {f.myAccess ? ROLE_LABEL[f.myAccess.role] : "No access"}
                {f.myAccess?.via === "group" && ", through a group"}
                {f.myAccess?.via === "parent" && ", from the folder above"}
                {f.myAccess && f.myAccess.until !== null && `. ${formatUntil(f.myAccess.until, now)}`}
                {f.refreshPending && ". Waiting for a key refresh"}
              </span>
            </span>
            <ChevronRight size={18} className="text-muted" aria-hidden />
          </button>
        </Row>
      ))}
    </ul>
  );
}

export interface FileActions {
  onPreview?: (f: FileEntry) => void;
  onDownload?: (f: FileEntry) => void;
  onVersions?: (f: FileEntry) => void;
  onLink?: (f: FileEntry) => void;
  onDelete?: (f: FileEntry) => void;
  /** Shows the zero-knowledge proof behind an anonymous file (add-on Z1). */
  onProof?: (f: FileEntry) => void;
}

/**
 * Files in a folder. Files you have no key for are shown, locked, with the reason. `proved` holds the Arkiv keys of
 * anonymous files, whose entries carry a zero-knowledge proof instead of the writer's signature.
 */
export function FileRows({
  files,
  now,
  proved,
  accessUntil,
  ...actions
}: {
  files: FileEntry[];
  now: Timestamp;
  proved?: ReadonlySet<string>;
  /** When your access here ends or ended, if known: says why a file is locked only when it's true. */
  accessUntil?: Timestamp | null;
} & FileActions) {
  if (!files.length) return null;
  return (
    <ul className="surface rounded-2xl px-3">
      {files.map((f) =>
        f.readable ? (
          <Row key={f.fileId}>
            <button
              onClick={() => actions.onPreview?.(f)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
              disabled={!actions.onPreview}
            >
              <FileText size={20} className="shrink-0 text-ink/70" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{f.name}</span>
                <span className="block truncate text-xs text-muted">
                  {f.size !== null && `${formatBytes(f.size)}, `}added by {f.uploadedBy.label}{" "}
                  <time title={formatDate(f.uploadedAt)}>{formatAgo(f.uploadedAt, now)}</time>
                  {f.version > 1 && `, version ${f.version}`}
                </span>
              </span>
            </button>
            <div className="flex shrink-0 items-center">
              {actions.onProof && proved?.has(f.arkivKey.toLowerCase()) && (
                <IconButton label={`Proof behind ${f.name}`} onClick={() => actions.onProof!(f)}>
                  <ShieldCheck size={18} aria-hidden />
                </IconButton>
              )}
              {actions.onPreview && (
                <span className="hidden sm:inline">
                  <IconButton label={`Open ${f.name}`} onClick={() => actions.onPreview!(f)}>
                    <Eye size={18} aria-hidden />
                  </IconButton>
                </span>
              )}
              {actions.onDownload && (
                <IconButton label={`Download ${f.name}`} onClick={() => actions.onDownload!(f)}>
                  <Download size={18} aria-hidden />
                </IconButton>
              )}
              {actions.onVersions && f.version > 1 && (
                <IconButton label={`Versions of ${f.name}`} onClick={() => actions.onVersions!(f)}>
                  <History size={18} aria-hidden />
                </IconButton>
              )}
              {actions.onLink && (
                <IconButton label={`Make a link to ${f.name}`} onClick={() => actions.onLink!(f)}>
                  <Link2 size={18} aria-hidden />
                </IconButton>
              )}
              {actions.onDelete && (
                <IconButton label={`Delete ${f.name}`} onClick={() => actions.onDelete!(f)}>
                  <Trash2 size={18} aria-hidden />
                </IconButton>
              )}
            </div>
          </Row>
        ) : (
          <Row key={f.fileId} locked>
            <Lock size={20} className="shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">Locked file</span>
              <span className="block truncate text-xs">
                {accessUntil != null && f.uploadedAt > accessUntil ? "Added after your access ended" : "You don't hold the key it was sealed with"}, added by{" "}
                {f.uploadedBy.label}{" "}
                <time title={formatDate(f.uploadedAt)}>{formatAgo(f.uploadedAt, now)}</time>
              </span>
            </span>
          </Row>
        ),
      )}
    </ul>
  );
}

/** A small header for a folder: name, my role, and the folder-level actions. */
export function FolderHeader({
  folder,
  now,
  badge,
  children,
}: {
  folder: Folder;
  now: Timestamp;
  /** Sits beside the title (the live-updates pill). */
  badge?: ReactNode;
  children?: ReactNode;
}) {
  const chip = "inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2.5 py-1 ring-1 ring-ink/[0.06]";
  return (
    <div className="flex flex-col gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="min-w-0 truncate text-3xl font-bold tracking-[-0.035em]">{folder.displayName}</h1>
          {badge}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[13px] text-muted">
          {folder.kind === "room" && <span className={chip}>Unlinked room</span>}
          {folder.kind === "group" && (
            <span className={chip}>
              <Users size={13} aria-hidden /> Group
            </span>
          )}
          {folder.myAccess && (
            <span className={chip}>
              {folder.myAccess.role === "owner" ? "You're the owner" : `You're a ${ROLE_LABEL[folder.myAccess.role].toLowerCase()}`}
            </span>
          )}
          {folder.myAccess && folder.myAccess.until !== null && <span className={chip}>{formatUntil(folder.myAccess.until, now)}</span>}
          <span className={cx(chip, "min-w-0 max-w-full truncate font-mono text-[12px]")} title={folder.ensName}>
            {folder.ensName}
          </span>
        </div>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
