import { AnonRpcWorker } from "@anon-rpc/browser-extension-harness";
import { createAnonFetch, createExtensionStorage, type HarnessWorker } from "@cloakroom/platform";
import type { AnonFetch, CreateDriveClient, DriveClient } from "@cloakroom/types";
import { config, missingConfig } from "./config";

/**
 * The extension's DriveClient, from @cloakroom/core (Person A, step A6). There is no mock: until A6 is on main this is
 * null and the popup says so. When it lands, replace the line below with:
 *   import { createDriveClient } from "@cloakroom/core";
 */
const createDriveClient = null as CreateDriveClient | null;

/** Where the keys live: session storage (cleared when the browser closes) unless the user chose to stay signed in. */
const AREA_KEY = "cloak:persist";

export async function getPersist(): Promise<boolean> {
  return (await chrome.storage.local.get(AREA_KEY))[AREA_KEY] === true;
}

export async function setPersist(persist: boolean): Promise<void> {
  await chrome.storage.local.set({ [AREA_KEY]: persist });
}

export function unavailableReason(): string | null {
  const missing = missingConfig();
  if (missing.length) return `This build is missing settings: ${missing.join(", ")}.`;
  if (!createDriveClient) return "The Cloakroom client (@cloakroom/core's createDriveClient, Person A's step A6) isn't in this build yet.";
  return null;
}

let anon: AnonFetch | null = null;

/** One Anon-RPC worker per extension context. The harness runs it in an offscreen document's sandboxed frame. */
export function getAnon(): AnonFetch {
  return (anon ??= createAnonFetch({
    platform: "extension",
    network: config.network,
    bootstrapRpcUrl: config.sepoliaRpcUrl || undefined,
    probeUrl: config.beeUrl ? `${config.beeUrl.replace(/\/$/, "")}/health` : undefined,
    // A static import: MV3 service workers can't load code on demand.
    workerFactory: async (init) => new AnonRpcWorker(init as never) as unknown as HarnessWorker,
  }));
}

export async function makeClient(): Promise<DriveClient | null> {
  if (unavailableReason() || !createDriveClient) return null;
  return createDriveClient({
    anon: getAnon(),
    storage: createExtensionStorage({ persist: await getPersist() }),
    appOrigin: config.appOrigin,
    apiUrl: config.apiUrl,
    beeUrl: config.beeUrl,
    sepoliaRpcUrl: config.sepoliaRpcUrl,
    arkivRpcUrl: config.arkivRpcUrl,
    arkivAccessKey: "", // never in a client: arkivRpcUrl is our API's pass-through, which adds it
    demoMode: config.demoMode,
  });
}
