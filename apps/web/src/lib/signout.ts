"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useDrive } from "./drive";

/** Signs this device out: forgets its keys, drops this tab's quick-start lists (they belong to the account that's
 * leaving) and goes back to the front page. Settings and the menu both use it. */
export function useSignOut() {
  const router = useRouter();
  const { client, setIdentity } = useDrive();
  return useCallback(async () => {
    if (!client) return;
    await client.signOut();
    for (const k of Object.keys(localStorage)) if (k.startsWith("haven:view:") || k.startsWith("haven:receipts:")) localStorage.removeItem(k);
    setIdentity(null);
    router.push("/");
  }, [client, setIdentity, router]);
}
