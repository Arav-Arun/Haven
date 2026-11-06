"use client";

import type { FileEntry } from "@haven/types";
import { ErrorNote, FilePreview, Skeleton, Wordmark, saveBlob } from "@haven/ui";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ClientUnavailable } from "@/components/Gate";
import { useDrive } from "@/lib/drive";

/**
 * Opens a file link without a wallet. The key is in the URL's #fragment, which browsers never send to a server;
 * it's read here, on this device only.
 */
export default function OpenLink() {
  const { client, unavailable, restoring } = useDrive();
  const [result, setResult] = useState<{ file: FileEntry; blob: Blob } | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!client) return;
    let live = true;
    client.openLink(window.location.href).then(
      (r) => live && setResult(r),
      (e) => live && setError(e),
    );
    return () => {
      live = false;
    };
  }, [client]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-5">
      <header className="flex items-center justify-between gap-3 py-5">
        <Link href="/">
          <Wordmark />
        </Link>
      </header>
      <main className="flex flex-col gap-4 pb-16 pt-4">
        {restoring && <Skeleton rows={4} />}
        {!restoring && !client && <ClientUnavailable reason={unavailable ?? "No client."} />}
        <ErrorNote error={error} />
        {client && !result && !error && (
          <>
            <p className="text-sm text-muted">Opening the file and decrypting it on this device…</p>
            <Skeleton rows={4} />
          </>
        )}
        {result && (
          <>
            <h1 className="text-3xl font-bold tracking-[-0.035em]">{result.file.name}</h1>
            <FilePreview
              blob={result.blob}
              name={result.file.name ?? "file"}
              mime={result.file.mime ?? result.blob.type}
              onDownload={() => saveBlob(result.blob, result.file.name ?? "file")}
            />
          </>
        )}
      </main>
    </div>
  );
}
