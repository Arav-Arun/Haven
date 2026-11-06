"use client";

import { UsersRound } from "lucide-react";
import { FolderListPage } from "@/components/FolderListPage";
import { RequireIdentity } from "@/components/Gate";

export default function GroupsPage() {
  return (
    <RequireIdentity>
      {(client) => (
        <FolderListPage
          client={client}
          which="groups"
          title="Groups"
          intro="Share a folder with a group once. People you add to the group later get access too, and removing them from the group removes it."
          empty={{
            icon: <UsersRound size={22} />,
            title: "No groups yet",
            body: "Make a group for a team, then share folders with it instead of with each person.",
          }}
          action="New group"
        />
      )}
    </RequireIdentity>
  );
}
