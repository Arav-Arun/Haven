import { addToInbox, readInbox } from "@cloakroom/platform";
import type { DriveClient } from "@cloakroom/types";
import { describeError } from "@cloakroom/ui/errors";
import { makeClient, setPersist } from "@/lib/client";
import { config } from "@/lib/config";
import { LAST_CHECK_KEY, NEW_SHARES_KEY, type ExtMessage, type KeysReply, type PairReply } from "@/lib/messages";
import { showOnTab, verifyPage } from "@/lib/verify";

const CHECK_ALARM = "cloakroom-check";
const MENU_ID = "save-to-cloakroom";

function notify(title: string, message: string) {
  chrome.notifications.create({ type: "basic", iconUrl: chrome.runtime.getURL("icon/128.png"), title, message });
}

/** Badge: new shares since the popup was last opened, plus saved files still waiting for a folder. */
async function updateBadge() {
  const shares = ((await chrome.storage.local.get(NEW_SHARES_KEY))[NEW_SHARES_KEY] as number | undefined) ?? 0;
  const waiting = (await readInbox()).length;
  const n = shares + waiting;
  await chrome.action.setBadgeBackgroundColor({ color: "#16302a" });
  await chrome.action.setBadgeText({ text: n ? String(Math.min(n, 99)) : "" });
}

/** Every 15 minutes: look for new shares, and do an owner's housekeeping (gas top-ups, key refreshes, renewals). */
async function check() {
  const client = await makeClient();
  if (!client || !(await client.restore())) return;
  const since = ((await chrome.storage.local.get(LAST_CHECK_KEY))[LAST_CHECK_KEY] as number | undefined) ?? 0;
  const started = Math.floor(Date.now() / 1000);
  const shares = await client.sharedWithMe({ since });
  await chrome.storage.local.set({ [LAST_CHECK_KEY]: started });
  if (shares.length) {
    const prev = ((await chrome.storage.local.get(NEW_SHARES_KEY))[NEW_SHARES_KEY] as number | undefined) ?? 0;
    await chrome.storage.local.set({ [NEW_SHARES_KEY]: prev + shares.length });
    notify(
      shares.length === 1 ? "Shared with you" : `${shares.length} new shares`,
      shares.map((s) => `${s.folder.displayName}, from ${s.sharedBy}`).join("\n"),
    );
  }
  const done = await client.maintain();
  if (done.length) notify("Cloakroom housekeeping", done.map((r) => r.action).join(", "));
  await updateBadge();
  await listen(client).catch((e) => console.warn("Cloakroom doorbells unavailable:", describeError(e).title));
}

type LiveEvent = { folder: string; type: "file" | "member" | "refresh" | "rotation"; arkivKey: string; receivedAt: number };
type LiveClient = DriveClient & { subscribe?: (folders: string[], listener: (e: LiveEvent) => void) => () => void };
let stopListening: (() => void) | null = null;

/**
 * Add-on F4: listen to the doorbells of every room shared with this account and every room it owns, so new files show
 * up as a notification within seconds instead of at the next 15-minute check. A manager's app answers a refresh
 * doorbell by running housekeeping at once, which shortens the group and team removal window to seconds.
 * Chrome keeps a service worker alive while its WebSocket is active; if the worker is stopped anyway, the next
 * 15-minute check subscribes again.
 */
async function listen(client: DriveClient) {
  const c = client as LiveClient;
  if (!c.subscribe) return;
  const [shared, rooms] = await Promise.all([client.sharedWithMe(), client.listFolders("rooms").catch(() => [])]);
  const names = new Map<string, string>();
  for (const s of shared) names.set(s.folder.registry.toLowerCase(), s.folder.displayName);
  for (const r of rooms) names.set(r.registry.toLowerCase(), r.displayName);
  stopListening?.();
  stopListening = c.subscribe([...names.keys()], (e) => {
    const name = names.get(e.folder.toLowerCase()) ?? "a shared room";
    if (e.type === "file") notify("New file in Cloakroom", `Something was added to ${name}.`);
    if (e.type === "refresh") void client.maintain().catch(() => undefined);
  });
}

async function pair(seed: number[], persist: boolean): Promise<PairReply> {
  await setPersist(persist);
  const client = await makeClient();
  if (!client) return { ok: false, error: "The Cloakroom client isn't in this build of the extension yet." };
  try {
    const me = await client.signIn({ kind: "seed", seed: Uint8Array.from(seed) });
    notify("Extension connected", `Signed in as ${me.ensName ?? "your Cloakroom account"}.`);
    void check();
    return { ok: true, ensName: me.ensName };
  } catch (e) {
    return { ok: false, error: describeError(e).title };
  }
}

/**
 * Add-on F3, key custody: the website gets this account's keys only if the code it is running right now matches a
 * published release. The check runs again at the moment of the request, over everything the page has loaded by then.
 */
async function releaseKeys(tabId: number, urls: string[]): Promise<KeysReply> {
  const result = await verifyPage(urls);
  await showOnTab(tabId, result);
  if (result.status !== "verified") {
    return {
      ok: false,
      error:
        result.status === "mismatch"
          ? "This page's code doesn't match any published Cloakroom release, so the extension won't give it your keys."
          : `The page couldn't be checked (${result.reason ?? "unknown reason"}), so the extension won't give it your keys.`,
      result,
    };
  }
  const client = await makeClient();
  if (!client) return { ok: false, error: "The Cloakroom client isn't in this build of the extension yet." };
  const me = await client.restore();
  if (!me) return { ok: false, error: "The extension isn't signed in. Connect it from the website's Settings first." };
  const seed = await client.exportSeed();
  const out = Array.from(seed);
  seed.fill(0);
  return { ok: true, seed: out, ensName: me.ensName };
}

function fileName(url: URL, type: string): string {
  const last = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");
  if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return last;
  const ext = type.split("/")[1]?.split(/[;+]/)[0] ?? "bin";
  return `${last || url.hostname}.${ext === "html" ? "html" : ext}`;
}

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: "Save to Cloakroom", contexts: ["image", "link", "page"] });
    chrome.alarms.create(CHECK_ALARM, { periodInMinutes: 15, delayInMinutes: 1 });
    void updateBadge();
  });
  chrome.runtime.onStartup.addListener(() => {
    chrome.alarms.create(CHECK_ALARM, { periodInMinutes: 15, delayInMinutes: 1 });
    void updateBadge();
  });

  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === CHECK_ALARM) check().catch((e) => console.warn("Cloakroom check failed:", describeError(e).title));
  });

  chrome.runtime.onMessage.addListener((msg: ExtMessage, sender, reply) => {
    // Only our own pages and our pairing content script can send these.
    if (sender.id !== chrome.runtime.id) return false;
    if (msg.type === "pair") {
      pair(msg.seed, msg.persist).then(reply);
      return true;
    }
    if (msg.type === "check-now") {
      check().then(
        () => reply({ ok: true }),
        (e) => reply({ ok: false, error: describeError(e).title }),
      );
      return true;
    }
    if (msg.type === "seen") {
      chrome.storage.local.set({ [NEW_SHARES_KEY]: 0 }).then(updateBadge).then(() => reply({ ok: true }));
      return true;
    }
    // Add-on F3: only the content script on the configured Cloakroom origin may ask these.
    const tabId = sender.tab?.id;
    const fromApp = tabId !== undefined && !!sender.url && new URL(sender.url).origin === config.appOrigin;
    if (msg.type === "verify-page" && fromApp) {
      verifyPage(msg.urls)
        .then(async (result) => {
          await showOnTab(tabId, result);
          reply(result);
        })
        .catch((e) => reply({ status: "unknown", reason: describeError(e).title }));
      return true;
    }
    if (msg.type === "release-keys" && fromApp) {
      releaseKeys(tabId, msg.urls).then(reply, (e) => reply({ ok: false, error: describeError(e).title } satisfies KeysReply));
      return true;
    }
    return false;
  });

  // "Save to Cloakroom": fetch what was clicked and park it in the inbox; the popup encrypts it into a folder.
  chrome.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId !== MENU_ID) return;
    const raw = info.srcUrl ?? info.linkUrl ?? info.pageUrl;
    if (!raw) return;
    const url = new URL(raw);
    const needsHost = url.protocol === "http:" || url.protocol === "https:";
    // Asked here, inside the click, because the browser only allows the prompt during a user gesture.
    const allowed = needsHost ? chrome.permissions.request({ origins: [`${url.origin}/*`] }) : Promise.resolve(url.protocol === "data:");
    allowed
      .then(async (ok) => {
        if (!ok) return notify("Not saved", `Cloakroom needs permission to read ${url.hostname} to save from it.`);
        const res = await fetch(url, { credentials: "omit" });
        if (!res.ok) throw new Error(`${url.hostname} answered ${res.status}`);
        const blob = await res.blob();
        await addToInbox([{ name: fileName(url, blob.type), type: blob.type, blob }]);
        await updateBadge();
        notify("Saved to Cloakroom", "Open Cloakroom from the toolbar to choose a folder. It's encrypted when you do.");
      })
      .catch((e) => notify("Not saved", e instanceof Error ? e.message : String(e)));
  });
});
