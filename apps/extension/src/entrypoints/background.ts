import { addToInbox, readInbox } from "@haven/platform";
import { describeError } from "@haven/ui/errors";
import type { VerificationResult } from "@haven/core";
import type { Address, IncomingShare } from "@haven/types";
import { makeClient, setPersist } from "@/lib/client";
import { config } from "@/lib/config";
import { LAST_CHECK_KEY, NEW_SHARES_KEY, type ExtMessage, type KeysReply, type PairReply } from "@/lib/messages";
import { verifyUrls } from "@/lib/verify";

const CHECK_ALARM = "haven-check";
const LIVE_ALARM = "haven-live";
const MENU_ID = "save-to-haven";

/** A notification; with `open`, clicking it opens that page of the website (a path such as /shared/). */
function notify(title: string, message: string, open?: string) {
  const id = open ? `open:${open}:${crypto.randomUUID()}` : "";
  chrome.notifications.create(id, { type: "basic", iconUrl: chrome.runtime.getURL("icon/128.png"), title, message });
}

const WARNED_KEY = "haven:warnedEnds";
/** How long before a share's end the extension reminds you to save what you need. */
const WARN_BEFORE_S = 60 * 60;

function when(t: number): string {
  return new Date(t * 1000).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

function untilText(until: number | null): string {
  return until ? `, until ${when(until)}` : "";
}

/** One reminder per share, an hour (or less) before its access ends. */
async function warnEndingSoon(shares: IncomingShare[]) {
  const now = Math.floor(Date.now() / 1000);
  const warned = new Set(((await chrome.storage.local.get(WARNED_KEY))[WARNED_KEY] as string[] | undefined) ?? []);
  const soon = shares.filter((s) => s.until && s.until > now && s.until - now <= WARN_BEFORE_S && !warned.has(`${s.folder.registry}:${s.until}`));
  for (const s of soon) {
    const mins = Math.max(1, Math.round((s.until! - now) / 60));
    notify(`Access to ${s.folder.displayName} ends soon`, `In about ${mins} min (${when(s.until!)}). Open or download what you need before then.`, `/drive/?f=${s.folder.registry}`);
    warned.add(`${s.folder.registry}:${s.until}`);
  }
  // Keep the list short: only ends that haven't passed.
  const keep = [...warned].filter((k) => Number(k.split(":")[1]) > now);
  await chrome.storage.local.set({ [WARNED_KEY]: keep });
}

/** Badge: new shares since the popup was last opened, plus saved files still waiting for a folder. */
async function updateBadge() {
  const shares = ((await chrome.storage.local.get(NEW_SHARES_KEY))[NEW_SHARES_KEY] as number | undefined) ?? 0;
  const waiting = (await readInbox()).length;
  const n = shares + waiting;
  await chrome.action.setBadgeBackgroundColor({ color: "#1f4fd1" });
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
      shares.map((s) => `${s.folder.displayName}, from ${s.sharedBy}${untilText(s.until)}`).join("\n"),
      shares.length === 1 ? `/drive/?f=${shares[0]!.folder.registry}` : "/shared/",
    );
  }
  await warnEndingSoon(await client.sharedWithMe().catch(() => [])).catch(() => undefined);
  const done = await client.maintain();
  void ensureLive().catch(() => undefined);
  if (done.length) notify("Haven housekeeping", done.map((r) => r.action).join(", "));
  await updateBadge();
}

// ---------------------------------------------------------------- add-on F3: verified frontend

const verifyKey = (tabId: number) => `haven:verify:${tabId}`;

async function verifyTab(tabId: number, urls: string[]): Promise<VerificationResult> {
  let result: VerificationResult;
  try {
    result = await verifyUrls(urls);
  } catch (e) {
    result = { status: "unknown", detail: describeError(e).title };
  }
  await chrome.storage.session.set({ [verifyKey(tabId)]: result });
  const text = result.status === "verified" ? "✓" : result.status === "mismatch" ? "!" : "?";
  const color = result.status === "verified" ? "#1f6f4a" : result.status === "mismatch" ? "#9c2b21" : "#6b6b6b";
  await chrome.action.setBadgeBackgroundColor({ tabId, color });
  await chrome.action.setBadgeText({ tabId, text });
  return result;
}

/** The account seed, only for a tab whose files were just checked against a published release. */
async function releaseKeys(tabId: number, urls: string[]): Promise<KeysReply> {
  const result = await verifyTab(tabId, urls);
  if (result.status !== "verified") {
    return { ok: false, reason: result.status === "mismatch" ? "This page's code doesn't match any published Haven release." : (result.detail ?? "This page couldn't be checked.") };
  }
  const client = await makeClient();
  if (!client || !(await client.restore())) return { ok: false, reason: "The extension isn't signed in. Connect it from the website's Settings first." };
  return { ok: true, seed: Array.from(await client.exportSeed()) };
}

// ---------------------------------------------------------------- add-on F4: live updates while the browser is open

let unsubscribe: (() => void) | null = null;
let lastNotice = 0;

async function ensureLive() {
  if (unsubscribe) return;
  const client = await makeClient();
  if (!client || !(await client.restore())) return;
  const folders = new Map<string, string>();
  for (const f of [...(await client.listFolders("root").catch(() => [])), ...(await client.listFolders("rooms").catch(() => []))]) folders.set(f.registry, f.displayName);
  for (const s of await client.sharedWithMe().catch(() => [])) folders.set(s.folder.registry, s.folder.displayName);
  if (!folders.size) return;
  unsubscribe = client.subscribe([...folders.keys()] as Address[], (e) => {
    if (e.type === "refresh") void client.maintain().catch(() => undefined);
    if (e.type !== "file" && e.type !== "member") return;
    const now = Date.now();
    if (now - lastNotice < 10_000) return; // one notice per burst
    lastNotice = now;
    const name = folders.get(e.folder) ?? "a folder";
    notify(e.type === "file" ? `New file in ${name}` : `Members changed in ${name}`, "Checked against Arkiv. Open Haven to see it.");
  });
}

async function pair(seed: number[], persist: boolean): Promise<PairReply> {
  await setPersist(persist);
  const client = await makeClient();
  if (!client) return { ok: false, error: "The Haven client isn't in this build of the extension yet." };
  try {
    const me = await client.signIn({ kind: "seed", seed: Uint8Array.from(seed) });
    notify("Extension connected", `Signed in as ${me.ensName ?? "your Haven account"}.`);
    void check();
    return { ok: true, ensName: me.ensName };
  } catch (e) {
    return { ok: false, error: describeError(e).title };
  }
}

function fileName(url: URL, type: string): string {
  const last = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");
  if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return last;
  const ext = type.split("/")[1]?.split(/[;+]/)[0] ?? "bin";
  return `${last || url.hostname}.${ext === "html" ? "html" : ext}`;
}

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: "Save to Haven", contexts: ["image", "link", "page"] });
    chrome.alarms.create(CHECK_ALARM, { periodInMinutes: 15, delayInMinutes: 1 });
    chrome.alarms.create(LIVE_ALARM, { periodInMinutes: 1 });
    void updateBadge();
  });
  chrome.runtime.onStartup.addListener(() => {
    chrome.alarms.create(CHECK_ALARM, { periodInMinutes: 15, delayInMinutes: 1 });
    chrome.alarms.create(LIVE_ALARM, { periodInMinutes: 1 });
    void updateBadge();
  });

  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === CHECK_ALARM) check().catch((e) => console.warn("Haven check failed:", describeError(e).title));
    // A service worker that was stopped loses its subscriptions; this brings them back within a minute.
    if (a.name === LIVE_ALARM) ensureLive().catch(() => undefined);
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
    const fromApp = (() => {
      try {
        return !!sender.url && new URL(sender.url).origin === config.appOrigin;
      } catch {
        return false;
      }
    })();
    if ((msg.type === "verify" || msg.type === "release-keys") && !fromApp) return false;
    if (msg.type === "verify" && sender.tab?.id !== undefined) {
      verifyTab(sender.tab.id, msg.urls).then(reply);
      return true;
    }
    if (msg.type === "release-keys" && sender.tab?.id !== undefined) {
      releaseKeys(sender.tab.id, msg.urls).then(reply, (e) => reply({ ok: false, reason: describeError(e).title }));
      return true;
    }
    if (msg.type === "verification") {
      chrome.storage.session.get(verifyKey(msg.tabId)).then((v) => reply((v[verifyKey(msg.tabId)] as VerificationResult | undefined) ?? null));
      return true;
    }
    if (msg.type === "seen") {
      chrome.storage.local.set({ [NEW_SHARES_KEY]: 0 }).then(updateBadge).then(() => reply({ ok: true }));
      return true;
    }
    return false;
  });

  // A notification about a share opens that folder (or the Shared list) on the website.
  chrome.notifications.onClicked.addListener((id) => {
    chrome.notifications.clear(id);
    const m = id.match(/^open:(.*):[0-9a-f-]{36}$/);
    if (m && config.appOrigin) void chrome.tabs.create({ url: `${config.appOrigin}${m[1]}` });
  });

  // "Save to Haven": fetch what was clicked and park it in the inbox; the popup encrypts it into a folder.
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
        if (!ok) return notify("Not saved", `Haven needs permission to read ${url.hostname} to save from it.`);
        const res = await fetch(url, { credentials: "omit" });
        if (!res.ok) throw new Error(`${url.hostname} answered ${res.status}`);
        const blob = await res.blob();
        await addToInbox([{ name: fileName(url, blob.type), type: blob.type, blob }]);
        await updateBadge();
        notify("Saved to Haven", "Open Haven from the toolbar to choose a folder. It's encrypted when you do.");
      })
      .catch((e) => notify("Not saved", e instanceof Error ? e.message : String(e)));
  });
});
