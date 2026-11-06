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

// Files shared into the app from Android's share sheet are parked by sw.js in the inbox from @cloakroom/platform.
export { readInbox as readSharedFiles, removeFromInbox as removeSharedFile } from "@cloakroom/platform";
export type { InboxFile as SharedFile } from "@cloakroom/platform";
