"use client";

import { Download } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { formatBytes } from "./format";

const TEXT_LIMIT = 200_000;

function isText(mime: string) {
  return mime.startsWith("text/") || ["application/json", "application/xml", "application/javascript"].includes(mime);
}

/** Shows a decrypted file in place: images, video, audio, PDFs and text. Everything else offers a download. */
export function FilePreview({ blob, name, mime, onDownload }: { blob: Blob; name: string; mime: string; onDownload: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    // The type comes from the uploader. Re-type the bytes for the element that shows them, so a file labelled as a
    // PDF but holding HTML can never be rendered as a page on our origin.
    const kind = mime === "application/pdf" ? "application/pdf" : mime.startsWith("image/") || mime.startsWith("video/") || mime.startsWith("audio/") ? mime : "application/octet-stream";
    const u = URL.createObjectURL(new Blob([blob], { type: kind }));
    setUrl(u);
    if (isText(mime)) blob.slice(0, TEXT_LIMIT).text().then(setText);
    return () => URL.revokeObjectURL(u);
  }, [blob, mime]);

  if (!url) return null;
  let body: ReactNode;
  if (mime.startsWith("image/")) body = <img src={url} alt={name} className="mx-auto max-h-[70vh] rounded-xl object-contain" />;
  else if (mime.startsWith("video/")) body = <video src={url} controls className="max-h-[70vh] w-full rounded-xl bg-ink" />;
  else if (mime.startsWith("audio/")) body = <audio src={url} controls className="w-full" />;
  else if (mime === "application/pdf")
    body = <iframe src={url} title={name} className="h-[70vh] w-full rounded-xl border border-line bg-paper" />;
  else if (isText(mime))
    body = (
      <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-paper p-3 text-sm">
        {text}
        {blob.size > TEXT_LIMIT && "\n…"}
      </pre>
    );
  else body = <p className="text-sm text-muted">There&apos;s no preview for this type of file. Download it to open it.</p>;

  return (
    <div className="flex flex-col gap-3">
      {body}
      <div className="flex items-center justify-between gap-3 text-sm text-muted">
        <span>
          {mime || "Unknown type"}, {formatBytes(blob.size)}. Decrypted on this device.
        </span>
        <button onClick={onDownload} className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-card px-3 py-1.5 text-ink">
          <Download size={16} aria-hidden /> Download
        </button>
      </div>
    </div>
  );
}

/** Saves a blob with the given name, without any server. */
export function saveBlob(blob: Blob, name: string) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 10_000);
}
