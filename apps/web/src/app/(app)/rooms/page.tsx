"use client";

import { DoorClosed } from "lucide-react";
import { FolderListPage } from "@/components/FolderListPage";
import { RequireIdentity } from "@/components/Gate";

export default function RoomsPage() {
  return (
    <RequireIdentity>
      {(client) => (
        <FolderListPage
          client={client}
          which="rooms"
          title="Rooms"
          intro="Unlinked rooms have random names. No one can tell they're yours, or that two rooms belong to the same person."
          empty={{
            icon: <DoorClosed size={22} />,
            title: "No rooms yet",
            body: "Use a room for anything you don't want tied to your name, like a data room for investors.",
          }}
          action="New room"
        />
      )}
    </RequireIdentity>
  );
}
