"use client";

import type { DriveClient, Identity, Receipt } from "@haven/types";
import { Button, ErrorNote, ReceiptSteps, Ticket, Wordmark, useNow } from "@haven/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ClientUnavailable } from "@/components/Gate";
import { config } from "@/lib/config";
import { makeClient, useDrive, type Profile } from "@/lib/drive";

type Persona = Exclude<Profile, "me">;

function randomLabel(p: Persona): string {
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  return `${p}-${Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 5)}`;
}

/** One persona: a fresh random key on this device, and a real name claimed for it on Sepolia. */
function PersonaCard({ persona, client, onReady }: { persona: Persona; client: DriveClient; onReady: (i: Identity) => void }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const now = useNow(60_000);

  useEffect(() => {
    let live = true;
    client.restore().then((i) => {
      if (!live || !i) return;
      setIdentity(i);
      if (i.ensName) onReady(i);
    });
    const off = client.onReceipt((r) => live && setReceipt(r));
    return () => {
      live = false;
      off();
    };
  }, [client, onReady]);

  const setUp = async () => {
    setPending(true);
    setError(null);
    try {
      let i = identity ?? (await client.signIn({ kind: "random" }));
      setIdentity(i);
      if (!i.ensName) i = await client.claimName(randomLabel(persona));
      setIdentity(i);
      onReady(i);
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {identity?.ensName ? (
        <Ticket address={identity.driveKey} href={`${config.explorerUrl}/address/${identity.driveKey}`} title={identity.ensName} subtitle={`The ${persona}`} role="owner" until={null} now={now} />
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4">
          <h2 className="font-semibold">The {persona}</h2>
          <p className="text-sm text-muted">
            {persona === "founder"
              ? "Makes a data room, adds files, and shares it with the investor's name."
              : "Gets the share, opens the files, and sees new ones lock when access ends."}
          </p>
          <Button variant="primary" className="self-start" pending={pending} onClick={setUp}>
            Make the {persona}
          </Button>
          {receipt && !receipt.done && <ReceiptSteps receipt={receipt} />}
          <ErrorNote error={error} />
        </div>
      )}
    </div>
  );
}

export default function TryIt() {
  const router = useRouter();
  const { unavailable, setProfile } = useDrive();
  const founder = useMemo(() => (typeof window === "undefined" ? null : makeClient("founder")), []);
  const investor = useMemo(() => (typeof window === "undefined" ? null : makeClient("investor")), []);
  const [ready, setReady] = useState<Record<Persona, Identity | null>>({ founder: null, investor: null });
  const onFounder = useMemo(() => (i: Identity) => setReady((r) => ({ ...r, founder: i })), []);
  const onInvestor = useMemo(() => (i: Identity) => setReady((r) => ({ ...r, investor: i })), []);

  const start = (p: Persona) => {
    setProfile(p);
    router.push(p === "founder" ? "/rooms" : "/shared");
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-5">
      <header className="flex items-center justify-between gap-3 py-5">
        <Link href="/">
          <Wordmark />
        </Link>
      </header>
      <main className="flex flex-col gap-6 pb-16 pt-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Try it without a wallet</h1>
          <p className="mt-2 max-w-prose text-muted">
            Two people, both played by you in this tab. Each gets a fresh key made on this device and a real name on the Sepolia
            test network. Nothing is set up in advance: you make the room, add your own files, and share them.
          </p>
          {config.demoMode && <p className="mt-2 text-sm text-warn">Test network, 1-minute access windows.</p>}
        </div>

        {!founder || !investor ? (
          <ClientUnavailable reason={unavailable ?? "No client."} />
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <PersonaCard persona="founder" client={founder} onReady={onFounder} />
              <PersonaCard persona="investor" client={investor} onReady={onInvestor} />
            </div>
            {ready.founder && ready.investor && (
              <div className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4">
                <p>
                  Start as the founder: make a room, drop in a file, and share it with <strong>{ready.investor.ensName}</strong>{" "}
                  for a few minutes. Then switch to the investor from the bar at the top.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => start("founder")}>
                    Start as the founder
                  </Button>
                  <Button onClick={() => start("investor")}>Start as the investor</Button>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
