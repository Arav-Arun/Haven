"use client";

import Link from "next/link";

import { NETWORKS } from "@haven/platform";
import type { AnonStatus, PrivateNetwork, Receipt } from "@haven/types";
import { Button, ErrorNote, shortAddress } from "@haven/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { chooseNetwork, getAnon, selectedNetwork, unavailableReason } from "@/lib/anon";
import { config } from "@/lib/config";
import { useDrive } from "@/lib/drive";
import { useInstall } from "@/lib/pwa";
import { Devices, KeysInExtension, LinkName, MyKey } from "@/components/KeyDirectory";
import { useNow } from "@haven/ui";

/**
 * Pairs the browser extension: after the user confirms, the account seed goes to the extension's content script on
 * this page (window.postMessage, this origin only), which hands it to the extension's background worker.
 */
function ConnectExtension() {
  const { client, identity } = useDrive();
  const [present, setPresent] = useState(false);
  const [persist, setPersist] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; ensName?: string | null; error?: string } | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const d = e.data as { source?: string; type?: string; ok?: boolean; ensName?: string | null; error?: string } | null;
      if (d?.source !== "haven-ext") return;
      if (d.type === "present") setPresent(true);
      if (d.type === "paired") {
        setPending(false);
        setResult({ ok: !!d.ok, ensName: d.ensName, error: d.error });
      }
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ source: "haven-web", type: "ping" }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!client || !identity) return null;
  return (
    <section className="surface rounded-2xl p-5 text-sm">
      <h2 className="font-medium">Browser extension</h2>
      {!present ? (
        <p className="mt-1 text-muted">
          <Link href="/extension/" className="font-medium text-action underline underline-offset-4">Install the Haven extension for Chrome</Link>, then reload
          this page. It adds right-click &quot;Save to Haven&quot;, a badge when something is shared with you, and a reminder
          before access ends.
        </p>
      ) : result?.ok ? (
        <p className="mt-1 text-private">Connected. The extension is signed in as {result.ensName ?? "you"}.</p>
      ) : (
        <div className="mt-2 flex flex-col items-start gap-2">
          <p className="text-muted">
            Connecting gives the extension in this browser your Haven keys, so it can check for shares and save files.
            Only do this on your own computer.
          </p>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="accent-action" checked={persist} onChange={(e) => setPersist(e.target.checked)} />
            Keep it signed in after the browser restarts
          </label>
          <Button
            variant="primary"
            pending={pending}
            onClick={async () => {
              setError(null);
              setResult(null);
              setPending(true);
              try {
                const seed = await client.exportSeed();
                window.postMessage({ source: "haven-web", type: "pair", seed: Array.from(seed), persist }, window.location.origin);
                seed.fill(0);
              } catch (e) {
                setError(e);
                setPending(false);
              }
            }}
          >
            Connect extension
          </Button>
          {result && !result.ok && <p className="text-danger">The extension couldn&apos;t sign in: {result.error}</p>}
          <ErrorNote error={error} />
        </div>
      )}
    </section>
  );
}

function Install() {
  const { state, install } = useInstall();
  return (
    <section className="surface rounded-2xl p-5 text-sm">
      <h2 className="font-medium">Phone app</h2>
      {state === "installed" && <p className="mt-1 text-muted">Installed. Haven opens from your home screen, even offline.</p>}
      {state === "can-install" && (
        <div className="mt-2 flex flex-col items-start gap-2">
          <p className="text-muted">Install Haven to open it from your home screen and share files into it from other apps.</p>
          <Button variant="primary" onClick={install}>
            Install the app
          </Button>
        </div>
      )}
      {state === "ios" && (
        <p className="mt-1 text-muted">On iPhone: tap the Share button in Safari, then &quot;Add to Home Screen&quot;.</p>
      )}
      {state === "unavailable" && (
        <p className="mt-1 text-muted">
          Open this site on your phone to install it. On Android, use Chrome; on iPhone, Safari&apos;s &quot;Add to Home Screen&quot;.
        </p>
      )}
    </section>
  );
}

/** Who is signed in, the housekeeping run, and sign-out. */
function Account() {
  const router = useRouter();
  const { client, identity, setIdentity, profile } = useDrive();
  const [ran, setRan] = useState<Receipt[] | null>(null);
  const [pending, setPending] = useState<"maintain" | "signout" | null>(null);
  const [error, setError] = useState<unknown>(null);
  if (!client || !identity) return null;

  const run = async (what: "maintain" | "signout") => {
    setPending(what);
    setError(null);
    try {
      if (what === "maintain") setRan(await client.maintain());
      else {
        await client.signOut();
        setIdentity(null);
        router.push("/");
      }
    } catch (e) {
      setError(e);
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="surface rounded-2xl p-5 text-sm">
      <h2 className="font-medium">Account{profile !== "me" && ` (Try it: the ${profile})`}</h2>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="text-muted">Name</dt>
        <dd>{identity.ensName ?? "None yet"}</dd>
        <dt className="text-muted">Wallet</dt>
        <dd>{identity.wallet ? <a className="underline" href={`${config.explorerUrl}/address/${identity.wallet}`} target="_blank" rel="noreferrer noopener">{shortAddress(identity.wallet)}</a> : "None (key made on this device)"}</dd>
        <dt className="text-muted">App key</dt>
        <dd>
          <a className="underline" href={`${config.explorerUrl}/address/${identity.driveKey}`} target="_blank" rel="noreferrer noopener">
            {shortAddress(identity.driveKey)}
          </a>{" "}
          <span className="text-muted">signs everyday actions, so your wallet doesn&apos;t pop up each time.</span>
        </dd>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button pending={pending === "maintain"} onClick={() => run("maintain")}>
          Run housekeeping now
        </Button>
        <Button variant="quiet" pending={pending === "signout"} onClick={() => run("signout")}>
          Sign out of this device
        </Button>
      </div>
      <p className="mt-2 text-muted">
        Housekeeping tops up gas for editors, refreshes keys after someone is removed, and renews storage. The app runs it
        when it opens; it&apos;s here so you can run it now.
      </p>
      {ran && (
        <p className="mt-2">
          {ran.length === 0 ? "Nothing needed doing." : `Done: ${ran.map((r) => r.action).join(", ")}. See Receipts for each step.`}
        </p>
      )}
      <ErrorNote error={error} className="mt-2" />
    </section>
  );
}

function SettingsDevices() {
  const { identity } = useDrive();
  const now = useNow(10_000);
  if (!identity?.ensName) return null;
  return <Devices now={now} />;
}

const ABOUT: Record<PrivateNetwork, string> = {
  nox: "A Sphinx mixnet. Its worker is registered on Sepolia, so it needs no mainnet connection.",
  nym: "The Nym mixnet. About 18 MB to download and a few seconds to start. Its worker is registered on mainnet.",
  tor: "Tor, through gateways you configure. Its worker is registered on mainnet.",
  off: "Requests go straight to the RPC providers, who then see your IP address and what you look up.",
};

export default function SettingsPage() {
  const [current, setCurrent] = useState<PrivateNetwork | null>(null);
  const [status, setStatus] = useState<AnonStatus | null>(null);
  const [anyHttps, setAnyHttps] = useState(false);

  useEffect(() => {
    setCurrent(selectedNetwork());
    const anon = getAnon();
    const update = (s: AnonStatus) => {
      setStatus(s);
      setAnyHttps(anon.supportsAnyHttps);
    };
    update(anon.status());
    return anon.onStatus(update);
  }, []);

  if (!current) return null;
  const options: PrivateNetwork[] = ["nox", "nym", "tor", "off"];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-[-0.035em]">Settings</h1>
      <Account />
      <MyKey />
      <SettingsDevices />
      <LinkName />
      <Install />
      <ConnectExtension />
      <KeysInExtension />

      <section className="surface rounded-2xl p-5">
        <h2 className="font-medium">Private network</h2>
        <p className="mt-1 text-sm text-muted">
          Every lookup this app makes goes through the network you pick, so RPC providers can&apos;t see who is asking.
        </p>
        <fieldset className="mt-4 flex flex-col gap-3">
          <legend className="sr-only">Choose a private network</legend>
          {/* Only the networks this deployment can run. On Sepolia that's Nox and Off: Nym and Tor register their
              workers on mainnet, so they appear only when a mainnet RPC is configured. */}
          {options.filter((n) => !unavailableReason(n)).map((n) => {
            const reason = unavailableReason(n);
            return (
              <label key={n} className={`flex gap-3 rounded-xl border p-3 ${n === current ? "border-action bg-action-soft/50" : "border-line bg-white"} ${reason ? "opacity-60" : "cursor-pointer"}`}>
                <input
                  type="radio"
                  name="network"
                  className="mt-1 accent-action"
                  checked={n === current}
                  disabled={!!reason}
                  onChange={() => chooseNetwork(n)}
                />
                <span className="text-sm">
                  <span className="font-medium">{n === "off" ? "Off" : NETWORKS[n].label}</span>
                  <span className="block text-muted">{ABOUT[n]}</span>
                  {reason && <span className="block text-danger">Not available here: {reason}.</span>}
                  {n === "off" && !reason && <span className="block text-danger">Not private.</span>}
                </span>
              </label>
            );
          })}
        </fieldset>
      </section>

      <section className="surface rounded-2xl p-5 text-sm">
        <h2 className="font-medium">What is routed right now</h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-muted">Status</dt>
          <dd>
            {status?.state ?? "…"}
            {status?.detail ? ` (${status.detail})` : ""}
          </dd>
          <dt className="text-muted">Chain lookups</dt>
          <dd>{current === "off" ? "Direct, not private" : status?.state === "ready" ? "Through the private network" : "Waiting for the private network"}</dd>
          <dt className="text-muted">File storage and our API</dt>
          <dd>
            {current === "off"
              ? "Direct, not private"
              : anyHttps
                ? "Through the private network (tested with a real request)"
                : "Direct: the private network carries chain lookups only, or hasn't been tested yet. Our storage node sees your IP and which encrypted files you fetch, never what's in them."}
          </dd>
        </dl>
      </section>
    </div>
  );
}
