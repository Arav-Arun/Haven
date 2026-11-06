"use client";

import type { AnonStatus } from "@haven/types";
import { NetworkBadge as Badge } from "@haven/ui";
import { useEffect, useState } from "react";
import { getAnon } from "@/lib/anon";

export function useAnonStatus(): AnonStatus | null {
  const [status, setStatus] = useState<AnonStatus | null>(null);
  useEffect(() => {
    const anon = getAnon();
    setStatus(anon.status());
    return anon.onStatus(setStatus);
  }, []);
  return status;
}

/** Live status of the Anon-RPC worker. Red whenever requests are not private. */
export function NetworkBadge({ compact }: { compact?: boolean }) {
  return <Badge status={useAnonStatus()} compact={compact} />;
}
