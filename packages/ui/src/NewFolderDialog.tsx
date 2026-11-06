"use client";

import type { Folder } from "@haven/types";
import { useState } from "react";
import { cx } from "./format";
import { Button, Dialog, ErrorNote, inputClass } from "./primitives";

export type NewFolderChoice =
  | { kind: "drive"; name: string }
  | { kind: "room"; name: string }
  | { kind: "subfolder"; name: string; inherit: boolean };

function Choice({
  checked,
  onSelect,
  title,
  about,
  name,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  about: string;
  name: string;
}) {
  return (
    <label className={cx("flex cursor-pointer gap-3 rounded-xl border p-3", checked ? "border-action bg-action-soft/50" : "border-line bg-white")}>
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="mt-1 accent-action" />
      <span className="text-sm">
        <span className="font-medium">{title}</span>
        <span className="block text-muted">{about}</span>
      </span>
    </label>
  );
}

/**
 * New folder. At the top level: "in my drive" (under your name) or an unlinked room (a random name that can't be
 * tied to you). Inside a folder: a subfolder with the same access, or separate access. Both are fixed at creation.
 */
export function NewFolderDialog({
  open,
  onClose,
  parent,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  parent: Folder | null;
  onCreate: (choice: NewFolderChoice) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [where, setWhere] = useState<"drive" | "room">("room");
  const [inherit, setInherit] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      const n = name.trim();
      await onCreate(parent ? { kind: "subfolder", name: n, inherit } : { kind: where, name: n });
      setName("");
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} summon title={parent ? `New folder in ${parent.displayName}` : "New folder"}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="flex flex-col gap-1.5 text-sm">
          Name
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoFocus />
          <span className="text-xs text-muted">Encrypted. Only people with access see it.</span>
        </label>

        {!parent && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm">Where</legend>
            <Choice
              name="where"
              checked={where === "room"}
              onSelect={() => setWhere("room")}
              title="Unlinked room (recommended for data rooms)"
              about="Gets a random name. No one can tell it's yours, or that it's related to your other folders."
            />
            <Choice
              name="where"
              checked={where === "drive"}
              onSelect={() => setWhere("drive")}
              title="In my drive"
              about="Lives under your name. Anyone can see that the folder exists and is yours, but not what's in it."
            />
          </fieldset>
        )}

        {parent && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm">Who can open it</legend>
            <Choice
              name="inherit"
              checked={inherit}
              onSelect={() => setInherit(true)}
              title="Same access"
              about={`Everyone who can open ${parent.displayName} can open this too.`}
            />
            <Choice
              name="inherit"
              checked={!inherit}
              onSelect={() => setInherit(false)}
              title="Separate access"
              about="Starts with only you. Share it on its own."
            />
            <p className="text-xs text-muted">This can&apos;t be changed later.</p>
          </fieldset>
        )}

        <ErrorNote error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" pending={pending} disabled={!name.trim()}>
            Create folder
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
