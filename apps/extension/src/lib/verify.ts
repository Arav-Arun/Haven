import {
  arkivReader,
  downloadPublic,
  listRebuilds,
  listReleaseRevokes,
  listReleases,
  sha256Hex,
  verifyLoaded,
  type LoadedFile,
} from "@cloakroom/core";
import { config } from "./config";
import { getAnon } from "./client";
import type { VerifyReply } from "./messages";

/** At most this many files are re-downloaded per check; a Cloakroom page loads a few dozen. */
const MAX_FILES = 200;

/**
 * Add-on F3: re-downloads every file a Cloakroom tab loaded (MV3 can't read the page's own response bodies), hashes
 * it, and checks the set against the newest releases R signed on Arkiv. Re-downloading catches files swapped for
 * everyone (Bybit-style); a host that serves bad code to one visitor and good code to this re-download isn't caught,
 * which is what the Swarm copy is for.
 */
export async function verifyPage(urls: string[]): Promise<VerifyReply> {
  if (!config.releaseSigner) return { status: "unknown", reason: "this build of the extension has no release signer configured" };
  const unique = [...new Set(urls)].slice(0, MAX_FILES);
  const loaded: LoadedFile[] = [];
  for (const url of unique) {
    try {
      const res = await fetch(url, { credentials: "omit", cache: "no-store" });
      if (!res.ok) return { status: "mismatch", mismatchedFiles: [url], reason: `${url} answered ${res.status}` };
      loaded.push({ url, sha256: sha256Hex(new Uint8Array(await res.arrayBuffer())) });
    } catch {
      // a cross-origin file the extension may not read is still a file that isn't part of a release
      loaded.push({ url, sha256: "" });
    }
  }

  const anon = getAnon();
  const reader = arkivReader({ rpcUrl: config.arkivRpcUrl, accessKey: "", anon });
  const signer = config.releaseSigner;
  const swarm = { apiUrl: config.apiUrl, beeUrl: config.beeUrl, anon };
  const result = await verifyLoaded(
    {
      signer,
      listReleases: async () => (await listReleases(reader, signer)).records,
      listRevokes: async () => (await listReleaseRevokes(reader, signer)).records,
      listRebuilds: async (rootHash) => (await listRebuilds(reader, rootHash)).records,
      fetchManifest: (ref) => downloadPublic(swarm, ref),
    },
    loaded,
    config.appOrigin,
  );
  return {
    ...result,
    ...(result.siteSwarmRef ? { verifiedCopyUrl: `${config.beeUrl.replace(/\/$/, "")}/bzz/${result.siteSwarmRef.slice(2)}/` } : {}),
  };
}

const BADGE: Record<VerifyReply["status"], { text: string; color: string; title: string }> = {
  verified: { text: "✓", color: "#1d6b4b", title: "Cloakroom: this page matches a published release" },
  mismatch: { text: "!", color: "#b3261e", title: "Cloakroom: this page's code doesn't match any published release" },
  unknown: { text: "?", color: "#8a5a00", title: "Cloakroom: this page couldn't be checked" },
};

/** The per-tab badge: green ✓, red !, or amber ?. It overrides the shares count on that tab only. */
export async function showOnTab(tabId: number, result: VerifyReply): Promise<void> {
  const b = BADGE[result.status];
  const title =
    result.status === "verified"
      ? `${b.title} (v${result.version}, commit ${result.gitCommit?.slice(0, 7)}, ${result.rebuilds ?? 0} independent rebuilds)`
      : result.reason
        ? `${b.title}: ${result.reason}`
        : b.title;
  await chrome.action.setBadgeText({ tabId, text: b.text });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: b.color });
  await chrome.action.setTitle({ tabId, title });
}
