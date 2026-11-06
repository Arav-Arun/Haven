"use client";

import type { Address, DriveClient, FileEntry, Folder, Receipt, Timestamp } from "@cloakroom/types";
import {
  Button,
  Dialog,
  ErrorNote,
  FileRows,
  FilePreview,
  FolderHeader,
  FolderRows,
  MembersPanel,
  NewFolderDialog,
  RefreshPendingBanner,
  saveBlob,
  ShareDialog,
  Skeleton,
  UploadDropzone,
  formatDate,
  makeZip,
  nowSeconds,
  useNow,
  type UploadItem,
} from "@cloakroom/ui";
import { ArrowLeft, Copy, Eye, FolderDown, FolderPlus, Share2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { config } from "@/lib/config";
import { useDrive, useLoad } from "@/lib/drive";

/** The padded size anyone can see for an upload, read from its Swarm receipt step. */
function paddedFor(receipts: Receipt[], ref: string): number | undefined {
  for (const r of receipts)
    for (const s of r.steps) if (s.kind === "swarm" && s.ref.toLowerCase() === ref.toLowerCase()) return s.paddedBytes;
  return undefined;
}

function backHref(f: Folder): string {
  if (f.parent) return `/drive?f=${f.parent}`;
  return f.kind === "room" ? "/rooms" : f.kind === "group" ? "/groups" : "/drive";
}

function LinkDialog({ client, file, onClose }: { client: DriveClient; file: FileEntry; onClose: () => void }) {
  const [hours, setHours] = useState(24);
  const [link, setLink] = useState<{ url: string; expiresAt: Timestamp } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open onClose={onClose} title={`Link to ${file.name}`}>
      {link ? (
        <div className="flex flex-col gap-3 text-sm">
          <p>Anyone with this link can open the file until {formatDate(link.expiresAt)}. The key is in the part after #, which is never sent to a server.</p>
          <div className="flex gap-2">
            <input readOnly value={link.url} className="w-full rounded-md border border-line bg-paper px-3 py-2" onFocus={(e) => e.target.select()} />
            <Button
              onClick={() => navigator.clipboard.writeText(link.url).then(() => setCopied(true))}
              aria-label="Copy link"
            >
              <Copy size={16} aria-hidden /> {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <p>Make a link that opens this one file without a wallet. It stops working at the time you pick.</p>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Link works for">
            {[
              [1, "1 hour"],
              [24, "1 day"],
              [168, "1 week"],
            ].map(([h, label]) => (
              <button
                key={h}
                role="radio"
                aria-checked={hours === h}
                onClick={() => setHours(h as number)}
                className={`rounded-md border px-2.5 py-1 ${hours === h ? "border-ink bg-ink text-paper" : "border-line bg-card"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <ErrorNote error={error} />
          <div className="flex justify-end">
            <Button
              variant="primary"
              pending={pending}
              onClick={async () => {
                setPending(true);
                setError(null);
                try {
                  const l = await client.createLink(file, nowSeconds() + hours * 3600);
                  setLink({ url: l.url, expiresAt: l.expiresAt });
                } catch (e) {
                  setError(e);
                } finally {
                  setPending(false);
                }
              }}
            >
              Make link
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function VersionsDialog({ client, file, onClose }: { client: DriveClient; file: FileEntry; onClose: () => void }) {
  const versions = useLoad((c) => c.listVersions(file.folder, file.fileId), [file.folder, file.fileId]);
  const [error, setError] = useState<unknown>(null);
  return (
    <Dialog open onClose={onClose} title={`Versions of ${file.name}`}>
      {versions.loading && <Skeleton rows={2} />}
      <ErrorNote error={versions.error} />
      {versions.data && (
        <ul className="flex flex-col divide-y divide-line text-sm">
          {versions.data.map((v) => (
            <li key={`${v.fileId}-${v.version}`} className="flex items-center justify-between gap-3 py-2">
              <span>
                Version {v.version}, {formatDate(v.uploadedAt)}, by {v.uploadedBy.label}
                {!v.readable && <span className="text-muted"> (locked: added after your access ended)</span>}
              </span>
              {v.readable && (
                <Button
                  variant="quiet"
                  onClick={() => client.download(v).then((b) => saveBlob(b, v.name ?? "file"), setError)}
                >
                  Download
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ErrorNote error={error} />
    </Dialog>
  );
}

export function FolderView({ client, folder }: { client: DriveClient; folder: Address }) {
  const router = useRouter();
  const { receipts } = useDrive();
  const now = useNow(1000);
  const info = useLoad((c) => c.getFolder(folder), [folder]);
  const subfolders = useLoad((c) => c.listFolders(folder), [folder]);
  const files = useLoad((c) => c.listFiles(folder), [folder]);
  const members = useLoad((c) => c.listMembers(folder), [folder]);
  const [shareOpen, setShareOpen] = useState(false);
  const groups = useLoad(shareOpen ? (c) => c.listFolders("groups") : null, [shareOpen]);
  const [newOpen, setNewOpen] = useState(false);
  const [uploads, setUploads] = useState<(UploadItem & { ref?: string })[]>([]);
  const [preview, setPreview] = useState<{ file: FileEntry; blob: Blob | null; error: unknown } | null>(null);
  const [versionsOf, setVersionsOf] = useState<FileEntry | null>(null);
  const [linkFor, setLinkFor] = useState<FileEntry | null>(null);
  const [deleting, setDeleting] = useState<FileEntry | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const [zipProgress, setZipProgress] = useState<number | null>(null);
  const [zipError, setZipError] = useState<unknown>(null);
  const [fileError, setFileError] = useState<unknown>(null);

  const onFiles = useCallback(
    async (list: File[]) => {
      for (const file of list) {
        const id = crypto.randomUUID();
        setUploads((u) => [{ id, name: file.name, size: file.size, fraction: 0, state: "uploading" }, ...u]);
        try {
          const entry = await client.upload(folder, file, file.name, (fraction) =>
            setUploads((u) => u.map((x) => (x.id === id ? { ...x, fraction } : x))),
          );
          setUploads((u) => u.map((x) => (x.id === id ? { ...x, fraction: 1, state: "done", ref: entry.swarmRef } : x)));
          files.reload();
        } catch (error) {
          setUploads((u) => u.map((x) => (x.id === id ? { ...x, state: "failed", error } : x)));
        }
      }
    },
    [client, folder, files],
  );

  const open = async (file: FileEntry) => {
    setPreview({ file, blob: null, error: null });
    try {
      const blob = await client.download(file);
      setPreview({ file, blob, error: null });
    } catch (error) {
      setPreview({ file, blob: null, error });
    }
  };

  if (info.error) return <ErrorNote error={info.error} />;
  const f = info.data;
  if (!f) return <Skeleton />;
  const role = f.myAccess?.role;
  const canWrite = role === "owner" || role === "manager" || role === "editor";
  const canManage = role === "owner" || role === "manager";
  const readable = (files.data ?? []).filter((x) => x.readable).length;

  return (
    <div className="flex flex-col gap-6">
      <Link href={backHref(f)} className="inline-flex items-center gap-1 self-start text-sm text-muted hover:text-ink">
        <ArrowLeft size={16} aria-hidden /> Back
      </Link>

      <FolderHeader folder={f} now={now}>
        {canManage && (
          <Button variant="primary" onClick={() => setShareOpen(true)}>
            <Share2 size={16} aria-hidden /> {f.kind === "group" ? "Add to group" : "Share"}
          </Button>
        )}
        {canManage && f.kind !== "group" && (
          <Button onClick={() => setNewOpen(true)}>
            <FolderPlus size={16} aria-hidden /> New folder
          </Button>
        )}
        {readable > 0 && (
          <Button
            pending={zipProgress !== null}
            onClick={async () => {
              setZipError(null);
              setZipProgress(0);
              try {
                const all = await client.downloadFolder(folder, setZipProgress);
                saveBlob(await makeZip(all), `${f.displayName}.zip`);
              } catch (e) {
                setZipError(e);
              } finally {
                setZipProgress(null);
              }
            }}
          >
            <FolderDown size={16} aria-hidden />
            {zipProgress === null ? "Download folder" : `Downloading ${Math.round(zipProgress * 100)}%`}
          </Button>
        )}
        <Link href={`/public?f=${folder}`} className="inline-flex min-h-10 items-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium hover:bg-line/60">
          <Eye size={16} aria-hidden /> Public view
        </Link>
      </FolderHeader>
      <ErrorNote error={zipError} />

      {f.refreshPending && <RefreshPendingBanner />}

      {canWrite && f.kind !== "group" && (
        <UploadDropzone
          onFiles={onFiles}
          uploads={uploads.map((u) => ({ ...u, paddedBytes: u.ref ? paddedFor(receipts, u.ref) : undefined }))}
          disabled={f.refreshPending}
          disabledReason="Uploads are paused until the keys are refreshed."
        />
      )}

      {subfolders.data && subfolders.data.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted">Folders</h2>
          <FolderRows folders={subfolders.data} now={now} onOpen={(s) => router.push(`/drive?f=${s.registry}`)} />
        </section>
      )}

      {f.kind !== "group" && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted">Files</h2>
          {files.loading && !files.data && <Skeleton />}
          <ErrorNote error={files.error} />
          <ErrorNote error={fileError} />
          {files.data?.length === 0 && <p className="text-sm text-muted">No files yet.{canWrite ? " Drop some above." : ""}</p>}
          {files.data && (
            <FileRows
              files={files.data}
              now={now}
              onPreview={open}
              onDownload={(file) => {
                setFileError(null);
                client.download(file).then((b) => saveBlob(b, file.name ?? "file"), setFileError);
              }}
              onVersions={setVersionsOf}
              onLink={canManage ? setLinkFor : undefined}
              onDelete={canManage ? setDeleting : undefined}
            />
          )}
        </section>
      )}

      {!(members.error && (members.error as { code?: string }).code === "NOT_AUTHORIZED") && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted">{f.kind === "group" ? "In this group" : "Who holds a ticket"}</h2>
          {members.loading && !members.data && <Skeleton rows={2} />}
          <ErrorNote error={members.error} />
          {members.data && (
            <MembersPanel
              members={members.data}
              now={now}
              canManage={canManage}
              onRemove={async (m) => {
                await client.removeMember(folder, m.address);
                members.reload();
                info.reload();
              }}
            />
          )}
        </section>
      )}

      {shareOpen && (
        <ShareDialog
          open
          onClose={() => setShareOpen(false)}
          folder={f}
          groups={(groups.data ?? []).filter((g) => g.registry !== folder)}
          demoMode={config.demoMode}
          lookupRecipient={client.lookupRecipient.bind(client)}
          onShare={async (recipient, opts) => {
            const m = await client.share(folder, recipient, opts);
            members.reload();
            return m;
          }}
        />
      )}
      <NewFolderDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        parent={f}
        onCreate={async (choice) => {
          if (choice.kind !== "subfolder") return;
          const sub = await client.createFolder(folder, choice.name, { inherit: choice.inherit });
          router.push(`/drive?f=${sub.registry}`);
        }}
      />
      {preview && (
        <Dialog open wide onClose={() => setPreview(null)} title={preview.file.name ?? "File"}>
          {!preview.blob && !preview.error && <Skeleton rows={4} />}
          <ErrorNote error={preview.error} />
          {preview.blob && (
            <FilePreview
              blob={preview.blob}
              name={preview.file.name ?? "file"}
              mime={preview.file.mime ?? preview.blob.type}
              onDownload={() => saveBlob(preview.blob!, preview.file.name ?? "file")}
            />
          )}
        </Dialog>
      )}
      {versionsOf && <VersionsDialog client={client} file={versionsOf} onClose={() => setVersionsOf(null)} />}
      {linkFor && <LinkDialog client={client} file={linkFor} onClose={() => setLinkFor(null)} />}
      {deleting && (
        <Dialog open onClose={() => (setDeleting(null), setDeleteError(null))} title={`Delete ${deleting.name}?`}>
          <p className="text-sm">
            It disappears from this folder for everyone. People who already downloaded it keep their copy.
          </p>
          <ErrorNote error={deleteError} />
          <div className="flex justify-end gap-2">
            <Button variant="quiet" onClick={() => (setDeleting(null), setDeleteError(null))}>
              Cancel
            </Button>
            <Button
              variant="danger"
              pending={deletePending}
              onClick={async () => {
                setDeletePending(true);
                setDeleteError(null);
                try {
                  await client.deleteFile(deleting);
                  setDeleting(null);
                  files.reload();
                } catch (e) {
                  setDeleteError(e);
                } finally {
                  setDeletePending(false);
                }
              }}
            >
              Delete file
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
