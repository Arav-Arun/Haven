// Swarm (HAVEN_PLAN.md section 11). Only padded ciphertext ever leaves the device.
//   upload:   device → apps/api POST /upload, signed by a key with WRITE on the folder → Bee → reference
//   download: Bee GET /bytes/<ref>, through Anon-RPC when the worker forwards any HTTPS request, otherwise direct,
//             and then the receipt says so ("direct" route).
//   folder:   "download whole folder" fetches every file, so the node can't tell which one you wanted.
// The signed-upload format lives here so the API (step A5) verifies exactly what the client signs.

import { DriveError, type AnonFetch, type Address, type Hex } from "@haven/types";
import { getAddress, isAddress, isHex, type LocalAccount, recoverMessageAddress, toHex } from "viem";

import { sha256 } from "./crypto";
import { PAD_BUCKETS } from "./padding";
import { ignoreSteps, type StepSink } from "./receipts";
import { isAnonymous, anonCanReach } from "./transport";

// ---------------------------------------------------------------- signed upload

export const UPLOAD_HEADERS = {
  folder: "x-haven-folder",
  signer: "x-haven-signer",
  time: "x-haven-time",
  signature: "x-haven-signature",
} as const;

/** How far an upload's signed time may be from the API's clock. */
export const UPLOAD_WINDOW_SECONDS = 300;

/** Largest body /upload accepts: the top padding bucket. */
export const MAX_UPLOAD_BYTES = PAD_BUCKETS[PAD_BUCKETS.length - 1]!;

/** The EIP-191 message a writer signs for one upload. It names the folder and the exact body (its SHA-256). */
export function uploadMessage(p: { folder: Address; signer: Address; bodySha256: Hex; time: number }): string {
  return [
    "Haven upload v1",
    `folder: ${getAddress(p.folder)}`,
    `signer: ${getAddress(p.signer)}`,
    `sha256: ${p.bodySha256.toLowerCase()}`,
    `time: ${p.time}`,
  ].join("\n");
}

export interface UploadAuth {
  folder: Address;
  signer: Address;
  time: number;
  signature: Hex;
}

export async function signUpload(
  writer: LocalAccount,
  folder: Address,
  body: Uint8Array,
  time = Math.floor(Date.now() / 1000),
): Promise<UploadAuth> {
  const message = uploadMessage({ folder, signer: writer.address, bodySha256: toHex(sha256(body)), time });
  return { folder: getAddress(folder), signer: writer.address, time, signature: await writer.signMessage({ message }) };
}

export function uploadHeaders(auth: UploadAuth): Record<string, string> {
  return {
    [UPLOAD_HEADERS.folder]: auth.folder,
    [UPLOAD_HEADERS.signer]: auth.signer,
    [UPLOAD_HEADERS.time]: String(auth.time),
    [UPLOAD_HEADERS.signature]: auth.signature,
  };
}

/**
 * API side: checks the signature, the body hash and the time window. Throws NOT_AUTHORIZED. The API must ALSO check
 * that the signer holds WRITE on the folder now (DriveRegistry.wasAllowed at the current time).
 */
export async function verifyUpload(
  headers: { get(name: string): string | null },
  body: Uint8Array,
  now = Math.floor(Date.now() / 1000),
): Promise<UploadAuth> {
  const folder = headers.get(UPLOAD_HEADERS.folder) ?? "";
  const signer = headers.get(UPLOAD_HEADERS.signer) ?? "";
  const time = Number(headers.get(UPLOAD_HEADERS.time));
  const signature = headers.get(UPLOAD_HEADERS.signature) ?? "";
  if (!isAddress(folder) || !isAddress(signer) || !Number.isSafeInteger(time) || !isHex(signature)) {
    throw new DriveError("NOT_AUTHORIZED", "missing or malformed upload signature");
  }
  if (Math.abs(now - time) > UPLOAD_WINDOW_SECONDS) throw new DriveError("NOT_AUTHORIZED", "upload signature too old");
  if (body.length > MAX_UPLOAD_BYTES) throw new DriveError("TOO_LARGE", "upload too large");
  const message = uploadMessage({ folder, signer, bodySha256: toHex(sha256(body)), time });
  let recovered: Address;
  try {
    recovered = await recoverMessageAddress({ message, signature });
  } catch {
    throw new DriveError("NOT_AUTHORIZED", "unreadable upload signature");
  }
  if (getAddress(recovered) !== getAddress(signer)) throw new DriveError("NOT_AUTHORIZED", "upload signature mismatch");
  return { folder: getAddress(folder), signer: getAddress(signer), time, signature };
}

// ---------------------------------------------------------------- routing

export interface SwarmConfig {
  apiUrl: string;
  beeUrl: string;
  anon: AnonFetch;
  /** Used for direct calls when the private network can't carry generic HTTPS. Defaults to globalThis.fetch. */
  directFetch?: typeof fetch;
}

/** The fetch to use for API and Bee calls, and the route step that says how the call went. */
function httpsRoute(config: SwarmConfig, label: string, isolationKey?: string) {
  const status = config.anon.status();
  if (config.anon.supportsAnyHttps && anonCanReach(config.apiUrl) && anonCanReach(config.beeUrl)) {
    return {
      fetch: isolationKey ? config.anon.isolated(isolationKey) : config.anon.fetch,
      step: {
        kind: "route" as const,
        label,
        route: isAnonymous(status) ? ("anon" as const) : ("direct" as const),
        network: status.network,
        ...(isolationKey ? { isolationKey } : {}),
      },
    };
  }
  return {
    // Called as route.fetch(...), so the browser's fetch must be bound: unbound, it throws "Illegal invocation" and
    // no request is sent at all.
    fetch: config.directFetch ?? globalThis.fetch.bind(globalThis),
    step: { kind: "route" as const, label, route: "direct" as const, network: status.network },
  };
}

/**
 * One Swarm/API call: through the private network when it can carry it, else direct. A large body (a 1 MB padded
 * upload) can be more than a mixnet carries in time; then the call is sent again direct, and the receipt says so.
 */
async function routedCall(
  config: SwarmConfig,
  label: string,
  isolationKey: string | undefined,
  step: StepSink,
  call: (f: typeof fetch) => Promise<Response>,
): Promise<Response> {
  const route = httpsRoute(config, label, isolationKey);
  step(route.step);
  try {
    return await call(route.fetch);
  } catch (error) {
    if (route.step.route !== "anon") throw error;
    step({ kind: "route", label: `${label}: too large for the private network, sent direct`, route: "direct", network: route.step.network });
    return await call(config.directFetch ?? globalThis.fetch.bind(globalThis));
  }
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** A Bee reference as stored in haven.file: 0x + 64 hex (or 128 for an encrypted reference). */
export function normalizeRef(reference: string): Hex {
  const hex = reference.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}([0-9a-f]{64})?$/.test(hex)) throw new DriveError("UNKNOWN", "not a Swarm reference");
  return `0x${hex}`;
}

function httpError(status: number, label: string): DriveError {
  if (status === 401 || status === 403) return new DriveError("NOT_AUTHORIZED", `${label}: refused (${status})`);
  if (status === 404) return new DriveError("NOT_FOUND", `${label}: not found`);
  if (status === 413) return new DriveError("TOO_LARGE", `${label}: too large`);
  if (status === 429) return new DriveError("RATE_LIMITED", `${label}: rate limited`);
  return new DriveError("NETWORK", `${label}: HTTP ${status}`);
}

// ---------------------------------------------------------------- client calls

/** Uploads padded ciphertext through the API. The writer key must hold WRITE on the folder. */
export async function uploadEncrypted(
  config: SwarmConfig,
  writer: LocalAccount,
  folder: Address,
  padded: Uint8Array,
  step: StepSink = ignoreSteps,
  isolationKey?: string,
): Promise<Hex> {
  if (!(PAD_BUCKETS as readonly number[]).includes(padded.length)) {
    throw new DriveError("UNKNOWN", "only padded ciphertext may be uploaded");
  }
  const auth = await signUpload(writer, folder, padded);
  let response: Response;
  try {
    response = await routedCall(config, "Upload to Swarm (via API)", isolationKey, step, (f) =>
      f(`${trimSlash(config.apiUrl)}/upload`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream", ...uploadHeaders(auth) },
        body: new Uint8Array(padded),
      }),
    );
  } catch (error) {
    throw new DriveError("NETWORK", `upload: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw httpError(response.status, "upload");
  const { reference } = (await response.json()) as { reference?: string };
  const ref = normalizeRef(reference ?? "");
  step({ kind: "swarm", label: "Encrypted file stored", ref, paddedBytes: padded.length, ok: true });
  return ref;
}

/** Downloads one padded ciphertext from Bee. Refuses anything that isn't a padding-bucket size. */
export async function downloadEncrypted(
  config: SwarmConfig,
  ref: Hex,
  step: StepSink = ignoreSteps,
  isolationKey?: string,
): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await routedCall(config, "Download from Swarm", isolationKey, step, (f) => f(`${trimSlash(config.beeUrl)}/bytes/${normalizeRef(ref).slice(2)}`));
  } catch (error) {
    throw new DriveError("NETWORK", `download: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw httpError(response.status, "download");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!(PAD_BUCKETS as readonly number[]).includes(bytes.length)) {
    throw new DriveError("UNKNOWN", "downloaded blob is not a padded Haven file");
  }
  step({ kind: "swarm", label: "Encrypted file fetched", ref: normalizeRef(ref), paddedBytes: bytes.length, ok: true });
  return bytes;
}

/**
 * Downloads every reference of a folder (the default when opening one), a few at a time, so the node can't tell
 * which file was wanted. Returns ref → ciphertext.
 */
export async function downloadFolderBlobs(
  config: SwarmConfig,
  refs: readonly Hex[],
  onProgress?: (fraction: number) => void,
  step: StepSink = ignoreSteps,
  isolationKey?: string,
  concurrency = 3,
): Promise<Map<Hex, Uint8Array>> {
  const unique = [...new Set(refs.map(normalizeRef))];
  const out = new Map<Hex, Uint8Array>();
  let next = 0;
  let done = 0;
  onProgress?.(unique.length === 0 ? 1 : 0);
  async function worker() {
    while (next < unique.length) {
      const ref = unique[next++]!;
      out.set(ref, await downloadEncrypted(config, ref, step, isolationKey));
      onProgress?.(++done / unique.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker));
  return out;
}

// ---------------------------------------------------------------- server side (apps/api)

/** POST /bytes on a Bee node with a postage batch. Used by the API, never by clients (they hold no batch). */
export async function storeOnBee(
  beeUrl: string,
  postageBatchId: string,
  body: Uint8Array,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<Hex> {
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(postageBatchId)) throw new DriveError("UNKNOWN", "bad postage batch id");
  const response = await fetchImpl(`${trimSlash(beeUrl)}/bytes`, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "swarm-postage-batch-id": postageBatchId.replace(/^0x/, ""),
    },
    body: new Uint8Array(body),
  });
  if (!response.ok) throw httpError(response.status, "Bee upload");
  const { reference } = (await response.json()) as { reference?: string };
  return normalizeRef(reference ?? "");
}
