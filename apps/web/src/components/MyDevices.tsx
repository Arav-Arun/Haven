"use client";

import type { DriveClient } from "@cloakroom/types";
import { DevicesList, ErrorNote, Skeleton, useNow } from "@cloakroom/ui";
import { useMemo } from "react";
import { useLoad } from "@/lib/drive";
import { KEYDIR_MISSING, keyDir } from "@/lib/keydir";

/** The user's own devices (add-on F1): listed from cloak.device entries, removed through the public key log. */
export function MyDevices({ client }: { client: DriveClient }) {
  const now = useNow(30_000);
  const keys = useMemo(() => keyDir(client), [client]);
  const devices = useLoad(keys.listDevices ? () => keys.listDevices!() : null, [keys]);
  if (!keys.listDevices) return <p className="text-sm text-muted">{KEYDIR_MISSING}</p>;
  return (
    <>
      {devices.loading && !devices.data && <Skeleton rows={2} />}
      <ErrorNote error={devices.error} />
      {devices.data && (
        <DevicesList
          devices={devices.data}
          now={now}
          {...(keys.revokeDevice
            ? {
                onRevoke: async (d) => {
                  await keys.revokeDevice!(d.deviceId);
                  devices.reload();
                },
              }
            : {})}
        />
      )}
    </>
  );
}
