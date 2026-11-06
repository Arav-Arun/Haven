import type { DriveClient } from "@cloakroom/types";
import type { DeviceView, KeyInfoView } from "@cloakroom/ui";

/**
 * Add-on F1's optional DriveClient methods (the add-on's proposed @cloakroom/types additions). @cloakroom/core's
 * keydir.ts implements them; a client exposes them once createDriveClient wires them in. Until then each screen says
 * so instead of showing anything made up.
 */
export interface KeyDirMethods {
  lookupKey(ensName: string): Promise<KeyInfoView>;
  confirmKeyChange(ensName: string): Promise<void>;
  listDevices(): Promise<DeviceView[]>;
  revokeDevice(deviceId: string): Promise<void>;
}

/** The F1 methods this client has, bound to it. Missing ones are left out. */
export function keyDir(client: DriveClient): Partial<KeyDirMethods> {
  const c = client as DriveClient & Partial<KeyDirMethods>;
  return {
    ...(c.lookupKey ? { lookupKey: c.lookupKey.bind(c) } : {}),
    ...(c.confirmKeyChange ? { confirmKeyChange: c.confirmKeyChange.bind(c) } : {}),
    ...(c.listDevices ? { listDevices: c.listDevices.bind(c) } : {}),
    ...(c.revokeDevice ? { revokeDevice: c.revokeDevice.bind(c) } : {}),
  };
}

export const KEYDIR_MISSING =
  "This build's Cloakroom client doesn't include the public key directory yet (add-on F1 needs the client to expose lookupKey).";

/** A name's public key page. A query string, not a path, because the static export can't have /u/[name] on Swarm. */
export function profileHref(ensName: string): string {
  return `/u?n=${encodeURIComponent(ensName)}`;
}
