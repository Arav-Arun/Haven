"use client";

import { useEffect, useState } from "react";

/** Registers the service worker in production builds (in development it would cache stale code). */
export function registerServiceWorker() {
  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
    // The app works without it; only offline start and the share target need it.
  });
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallState = "installed" | "can-install" | "ios" | "unavailable";

/** Whether the app can be installed here, and how: Chrome's prompt, or iOS's "Add to Home Screen". */
export function useInstall(): { state: InstallState; install: () => Promise<void> } {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [state, setState] = useState<InstallState>("unavailable");

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setState(standalone ? "installed" : ios ? "ios" : "unavailable");
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
      setState("can-install");
    };
    const onInstalled = () => setState("installed");
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  return {
    state,
    install: async () => {
      if (!prompt) return;
      await prompt.prompt();
      if ((await prompt.userChoice).outcome === "accepted") setState("installed");
      setPrompt(null);
    },
  };
}

// ---- Files shared into the app (Android share target), parked by the service worker ----

export interface SharedFile {
  id: IDBValidKey;
  name: string;
  type: string;
  blob: Blob;
}

function openInbox(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("cloakroom-inbox", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files", { autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function readSharedFiles(): Promise<SharedFile[]> {
  const db = await openInbox();
  const files = await new Promise<SharedFile[]>((resolve, reject) => {
    const out: SharedFile[] = [];
    const req = db.transaction("files").objectStore("files").openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve(out);
      const v = c.value as Omit<SharedFile, "id">;
      out.push({ id: c.key, name: v.name, type: v.type, blob: v.blob });
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
  db.close();
  return files;
}

export async function removeSharedFile(id: IDBValidKey): Promise<void> {
  const db = await openInbox();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
