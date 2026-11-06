"use client";

import { NETWORKS } from "@cloakroom/platform";
import type { AnonStatus, PrivateNetwork } from "@cloakroom/types";
import { useEffect, useState } from "react";
import { chooseNetwork, getAnon, selectedNetwork, unavailableReason } from "@/lib/anon";

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
    <div className="flex max-w-2xl flex-col gap-6 pt-8">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="rounded-2xl border border-line bg-card p-5">
        <h2 className="font-medium">Private network</h2>
        <p className="mt-1 text-sm text-muted">
          Every lookup this app makes goes through the network you pick, so RPC providers can&apos;t see who is asking.
        </p>
        <fieldset className="mt-4 flex flex-col gap-3">
          <legend className="sr-only">Choose a private network</legend>
          {options.map((n) => {
            const reason = unavailableReason(n);
            return (
              <label key={n} className={`flex gap-3 rounded-lg border p-3 ${n === current ? "border-accent" : "border-line"} ${reason ? "opacity-60" : "cursor-pointer"}`}>
                <input
                  type="radio"
                  name="network"
                  className="mt-1"
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

      <section className="rounded-2xl border border-line bg-card p-5 text-sm">
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
