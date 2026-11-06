"use client";

import type { DriveClient, Folder } from "@haven/types";
import { Button, Dialog, EmptyState, ErrorNote, FolderRows, NewFolderDialog, Skeleton, inputClass, useNow } from "@haven/ui";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useLoad } from "@/lib/drive";

/** A named thing to create: a room or a group. Both only need a name. */
function NameDialog({
  open,
  onClose,
  title,
  about,
  action,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  about: string;
  action: string;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setError(null);
          try {
            await onCreate(name.trim());
            setName("");
            onClose();
          } catch (err) {
            setError(err);
          } finally {
            setPending(false);
          }
        }}
      >
        <p className="text-sm text-muted">{about}</p>
        <label className="flex flex-col gap-1.5 text-sm">
          Name
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoFocus />
          <span className="text-xs text-muted">Encrypted. Only people with access see it.</span>
        </label>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" pending={pending} disabled={!name.trim()}>
            {action}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** "My drive", "Rooms" and "Groups": a list of folders of one kind, and a way to make a new one. */
export function FolderListPage({
  client,
  which,
  title,
  intro,
  empty,
  action,
}: {
  client: DriveClient;
  which: "root" | "rooms" | "groups";
  title: string;
  intro: ReactNode;
  empty: { title: string; body: string; icon: ReactNode };
  action: string;
}) {
  const router = useRouter();
  const now = useNow(5000);
  const list = useLoad((c) => c.listFolders(which), [which]);
  const [open, setOpen] = useState(false);
  const go = (f: Folder) => router.push(`/drive?f=${f.registry}`);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-[-0.035em]">{title}</h1>
          <p className="mt-1 max-w-prose text-sm text-muted">{intro}</p>
        </div>
        <Button variant="primary" onClick={() => setOpen(true)}>
          <Plus size={16} aria-hidden /> {action}
        </Button>
      </div>

      {list.loading && !list.data && <Skeleton />}
      <ErrorNote error={list.error} />
      {list.data?.length === 0 && (
        <EmptyState icon={empty.icon} title={empty.title}>
          <p>{empty.body}</p>
        </EmptyState>
      )}
      {list.data && <FolderRows folders={list.data} now={now} onOpen={go} />}

      {which === "root" ? (
        <NewFolderDialog
          open={open}
          onClose={() => setOpen(false)}
          parent={null}
          onCreate={async (choice) => {
            if (choice.kind === "subfolder") return;
            go(choice.kind === "room" ? await client.createRoom(choice.name) : await client.createFolder("root", choice.name));
          }}
        />
      ) : (
        <NameDialog
          open={open}
          onClose={() => setOpen(false)}
          title={action}
          action={action}
          about={
            which === "rooms"
              ? "A room gets a random name that can't be tied to you or to your other folders. Good for data rooms."
              : "Share a folder with a group, and everyone in it gets access, including people you add later."
          }
          onCreate={async (name) => go(which === "rooms" ? await client.createRoom(name) : await client.createGroup(name))}
        />
      )}
    </div>
  );
}
