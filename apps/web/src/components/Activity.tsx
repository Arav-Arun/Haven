"use client";

import { ActivityPill, useNow } from "@haven/ui";
import { useDrive } from "@/lib/drive";

/** Every running action (a new folder, a share, an upload, a name), with its current step, on every page. */
export function Activity() {
  const { receipts } = useDrive();
  const now = useNow(1000);
  return <ActivityPill receipts={receipts} now={now} />;
}
