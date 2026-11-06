"use client";

import type { Address, DriveClient, Folder } from "@haven/types";
import { Button, Dialog, ErrorNote, formatBytes, inputClass } from "@haven/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { readSharedFiles, removeSharedFile, type SharedFile } from "@/lib/pwa";

/**
 * Files shared into Haven from another app (Android's share sheet). The service worker parked them on this
 * device; here the user picks a folder, and each is encrypted and uploaded like any other file.
 */
export function SharedInbox({ client, onDone }: { client: DriveClient; onDone: () => void }) {
  const router = useRouter();
  const [files, setFiles] = useState<SharedFile[] | null>(null);
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [target, setTarget] = useState<Address | "">("");
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    readSharedFiles().then(setFiles, setError);
    Promise.all([client.listFolders("root"), client.listFolders("rooms")]).then(
      ([a, b]) => setFolders([...a, ...b].filter((f) => f.myAccess && f.myAccess.role !== "viewer" && !f.refreshPending)),
      setError,
    );
  }, [client]);

  if (files && files.length === 0) return null;

  const upload = async () => {
    if (!target || !files) return;
    setError(null);
    try {
      for (const [i, f] of files.entries()) {
        setProgress(`Encrypting and uploading ${i + 1} of ${files.length}: ${f.name}`);
        await client.upload(target, f.blob, f.name);
        await removeSharedFile(f.id);
      }
      onDone();
      router.push(`/drive?f=${target}`);
    } catch (e) {
      setError(e);
    } finally {
      setProgress(null);
    }
  };

  return (
    <Dialog open onClose={onDone} title="Save shared files">
      <div className="flex flex-col gap-4 text-sm">
        {files && (
          <ul className="flex flex-col gap-1">
            {files.map((f) => (
              <li key={String(f.id)} className="flex justify-between gap-3">
                <span className="truncate">{f.name}</span>
                <span className="shrink-0 text-muted">{formatBytes(f.blob.size)}</span>
              </li>
            ))}
          </ul>
        )}
        <label className="flex flex-col gap-1.5">
          Folder
          <select className={inputClass} value={target} onChange={(e) => setTarget(e.target.value as Address)}>
            <option value="">{folders ? "Choose a folder" : "Loading your folders…"}</option>
            {folders?.map((f) => (
              <option key={f.registry} value={f.registry}>
                {f.displayName}
                {f.kind === "room" ? " (room)" : ""}
              </option>
            ))}
          </select>
        </label>
        {progress && <p className="text-muted">{progress}</p>}
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={onDone}>
            Later
          </Button>
          <Button variant="primary" disabled={!target || !files} pending={!!progress} onClick={upload}>
            Encrypt and save
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
