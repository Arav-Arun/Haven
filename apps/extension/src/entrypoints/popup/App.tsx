import { readInbox, removeFromInbox, type InboxFile } from "@cloakroom/platform";
import type { AnonStatus, Address, DriveClient, Folder, Identity, IncomingShare } from "@cloakroom/types";
import {
  Button,
  EmptyState,
  ErrorNote,
  IncomingTickets,
  NetworkBadge,
  Skeleton,
  UploadDropzone,
  Wordmark,
  formatBytes,
  inputClass,
  useNow,
  type UploadItem,
} from "@cloakroom/ui";
import { ExternalLink, KeyRound, Plug } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getAnon, makeClient, unavailableReason } from "@/lib/client";
import { config } from "@/lib/config";

function openSite(path: string) {
  chrome.tabs.create({ url: `${config.appOrigin}${path}` });
}

function FolderSelect({ folders, value, onChange }: { folders: Folder[] | null; value: string; onChange: (v: Address) => void }) {
  return (
    <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value as Address)} aria-label="Folder">
      <option value="">{folders ? "Choose a folder" : "Loading your folders…"}</option>
      {folders?.map((f) => (
        <option key={f.registry} value={f.registry}>
          {f.displayName}
          {f.kind === "room" ? " (room)" : ""}
        </option>
      ))}
    </select>
  );
}

/** Things saved with the right-click menu, waiting for a folder. */
function Inbox({ client, folders, onChange }: { client: DriveClient; folders: Folder[] | null; onChange: () => void }) {
  const [items, setItems] = useState<InboxFile[]>([]);
  const [target, setTarget] = useState<Address | "">("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => readInbox().then(setItems, setError), []);
  useEffect(() => void load(), [load]);
  if (!items.length) return null;
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-line bg-card p-3">
      <h2 className="text-sm font-medium">Saved from the web ({items.length})</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {items.map((f) => (
          <li key={String(f.id)} className="flex justify-between gap-2">
            <span className="truncate">{f.name}</span>
            <span className="shrink-0 text-muted">{formatBytes(f.blob.size)}</span>
          </li>
        ))}
      </ul>
      <FolderSelect folders={folders} value={target} onChange={setTarget} />
      <Button
        variant="primary"
        disabled={!target}
        pending={pending}
        onClick={async () => {
          if (!target) return;
          setPending(true);
          setError(null);
          try {
            for (const f of items) {
              await client.upload(target, f.blob, f.name);
              await removeFromInbox(f.id);
            }
            await load();
            onChange();
          } catch (e) {
            setError(e);
          } finally {
            setPending(false);
          }
        }}
      >
        Encrypt and save
      </Button>
      <ErrorNote error={error} />
    </section>
  );
}

function Upload({ client, folders }: { client: DriveClient; folders: Folder[] | null }) {
  const [target, setTarget] = useState<Address | "">("");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const onFiles = async (files: File[]) => {
    if (!target) return;
    for (const file of files) {
      const id = crypto.randomUUID();
      setUploads((u) => [{ id, name: file.name, size: file.size, fraction: 0, state: "uploading" }, ...u]);
      try {
        await client.upload(target, file, file.name, (fraction) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, fraction } : x))));
        setUploads((u) => u.map((x) => (x.id === id ? { ...x, fraction: 1, state: "done" } : x)));
      } catch (error) {
        setUploads((u) => u.map((x) => (x.id === id ? { ...x, state: "failed", error } : x)));
      }
    }
  };
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Upload</h2>
      <FolderSelect folders={folders} value={target} onChange={setTarget} />
      <UploadDropzone onFiles={onFiles} uploads={uploads} disabled={!target} disabledReason="Choose a folder first." />
    </section>
  );
}

export function App() {
  const [client, setClient] = useState<DriveClient | null | undefined>(undefined);
  const [identity, setIdentity] = useState<Identity | null | undefined>(undefined);
  const [status, setStatus] = useState<AnonStatus | null>(null);
  const [shares, setShares] = useState<IncomingShare[] | null>(null);
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const now = useNow(1000);

  const loadData = useCallback((c: DriveClient) => {
    c.sharedWithMe().then(setShares, setError);
    Promise.all([c.listFolders("root"), c.listFolders("rooms")]).then(
      ([a, b]) => setFolders([...a, ...b].filter((f) => f.myAccess && f.myAccess.role !== "viewer" && !f.refreshPending)),
      setError,
    );
  }, []);

  useEffect(() => {
    void chrome.runtime.sendMessage({ type: "seen" });
    if (unavailableReason()) return setClient(null);
    const anon = getAnon();
    setStatus(anon.status());
    const off = anon.onStatus(setStatus);
    makeClient().then(async (c) => {
      setClient(c);
      if (!c) return;
      const me = await c.restore().catch(() => null);
      setIdentity(me);
      if (me) loadData(c);
    });
    return off;
  }, [loadData]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex items-center justify-between gap-2">
        <Wordmark className="text-xl" />
        <NetworkBadge status={status} compact />
      </header>

      {client === undefined && <Skeleton rows={3} />}
      {client === null && (
        <EmptyState icon={<Plug size={22} />} title="Not connected to Cloakroom yet">
          <p>{unavailableReason()}</p>
        </EmptyState>
      )}
      {client && identity === undefined && <Skeleton rows={3} />}
      {client && identity === null && (
        <EmptyState icon={<KeyRound size={22} />} title="Connect your account">
          <p>On the Cloakroom website, open Settings and choose &quot;Connect extension&quot;. Your keys come across after you confirm there.</p>
          <Button variant="primary" onClick={() => openSite("/settings/")}>
            Open Settings
          </Button>
        </EmptyState>
      )}
      {client && identity && (
        <>
          <p className="text-sm text-muted">Signed in as {identity.ensName ?? "your Cloakroom account"}.</p>
          <Inbox client={client} folders={folders} onChange={() => loadData(client)} />
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Shared with me</h2>
            {!shares && <Skeleton rows={2} />}
            {shares?.length === 0 && <p className="text-sm text-muted">Nothing yet. New shares show up here and on the toolbar icon.</p>}
            {shares && shares.length > 0 && (
              <IncomingTickets shares={shares.slice(0, 5)} now={now} onOpen={(s) => openSite(`/drive/?f=${s.folder.registry}`)} />
            )}
          </section>
          <Upload client={client} folders={folders} />
          <ErrorNote error={error} />
        </>
      )}

      <footer className="flex items-center justify-between border-t border-line pt-3 text-sm">
        <button className="inline-flex items-center gap-1 underline" onClick={() => openSite("/drive/")} disabled={!config.appOrigin}>
          Open Cloakroom <ExternalLink size={12} aria-hidden />
        </button>
        {identity && (
          <button className="text-muted underline" onClick={() => chrome.runtime.sendMessage({ type: "check-now" })}>
            Check now
          </button>
        )}
      </footer>
    </div>
  );
}
