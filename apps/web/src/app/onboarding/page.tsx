"use client";

import type { DriveClient, Hex, Identity } from "@cloakroom/types";
import { Button, ErrorNote, ReceiptSteps, Wordmark, inputClass } from "@cloakroom/ui";
import { Check, LoaderCircle, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { ConnectWallet, useWalletKind } from "@/components/ConnectWallet";
import { ClientUnavailable } from "@/components/Gate";
import { NetworkBadge } from "@/components/NetworkBadge";
import { config } from "@/lib/config";
import { useDrive } from "@/lib/drive";

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children?: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${done ? "bg-private text-paper" : "bg-ink text-paper"}`}
        aria-hidden
      >
        {done ? <Check size={14} /> : n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3 pb-8">
        <h2 className="font-semibold">
          {title}
          {done && <span className="sr-only"> (done)</span>}
        </h2>
        {children}
      </div>
    </li>
  );
}

/**
 * Signature step. The client says whether this address is new (no cloak.key yet): then the wallet must sign the
 * same message twice, and both signatures must match, or the keys couldn't be rebuilt later.
 */
function SignStep({ client, onSignedIn }: { client: DriveClient; onSignedIn: (i: Identity) => void }) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [needed, setNeeded] = useState<number | null>(null);
  const [sigs, setSigs] = useState<Hex[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!address) return;
    let live = true;
    setSigs([]);
    client.needsSecondSignature(address).then(
      (two) => live && setNeeded(two ? 2 : 1),
      (e) => live && setError(e),
    );
    return () => {
      live = false;
    };
  }, [client, address]);

  if (!address) return null;
  if (needed === null && !error) return <p className="text-sm text-muted">Checking whether this wallet has used Cloakroom before…</p>;
  const message = client.signInMessage(address);
  const host = new URL(config.appOrigin).host;
  const mismatch = sigs.length === 2 && sigs[0] !== sigs[1];

  const sign = async () => {
    setPending(true);
    setError(null);
    try {
      const sig = await signMessageAsync({ message });
      const next = [...sigs, sig];
      setSigs(next);
      if (next.length === needed && !(next.length === 2 && next[0] !== next[1]))
        onSignedIn(await client.signIn({ kind: "wallet", address, signatures: next }));
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>
        {needed === 2
          ? "This wallet is new to Cloakroom. Sign the same message twice: your keys are made from the signature, so your wallet has to give the same one every time."
          : "Sign the message to unlock your keys on this device. Nothing is sent to the chain."}
      </p>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-card p-3 text-xs">{message}</pre>
      <p className="flex gap-2 rounded-md bg-warn-soft px-3 py-2 text-warn">
        <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          Only sign this on <strong>{host}</strong>. Anyone who gets this signature gets your Cloakroom keys, so never sign it
          for another site.
        </span>
      </p>
      {mismatch ? (
        <ErrorNote error={{ code: "WALLET_NOT_SUPPORTED" }} />
      ) : (
        <Button variant="primary" className="self-start" pending={pending} onClick={sign}>
          {sigs.length === 0 ? "Sign" : "Sign again"}
          {needed === 2 && ` (${sigs.length + 1} of 2)`}
        </Button>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

function ClaimStep({ client, onClaimed }: { client: DriveClient; onClaimed: (i: Identity) => void }) {
  const { receipts } = useDrive();
  const [label, setLabel] = useState("");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const valid = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(label);

  useEffect(() => {
    setAvailable(null);
    if (!valid) return;
    let live = true;
    setChecking(true);
    const t = setTimeout(() => {
      client
        .isNameAvailable(label)
        .then((a) => live && setAvailable(a), (e) => live && setError(e))
        .finally(() => live && setChecking(false));
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [client, label, valid]);

  const progress = startedAt === null ? null : receipts.find((r) => r.startedAt >= startedAt);

  return (
    <form
      className="flex flex-col gap-3 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        setStartedAt(Math.floor(Date.now() / 1000) - 1);
        try {
          onClaimed(await client.claimName(label));
        } catch (err) {
          setError(err);
        } finally {
          setPending(false);
        }
      }}
    >
      <p>Pick the name people will share with. It points to your Cloakroom key, so they can share without asking you for anything.</p>
      <label className="flex flex-col gap-1.5">
        <span className="sr-only">Name</span>
        <span className="flex items-center gap-2">
          <input
            className={inputClass}
            value={label}
            onChange={(e) => setLabel(e.target.value.toLowerCase())}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            required
            aria-describedby="name-status"
          />
          <span className="shrink-0 text-muted">.{config.ensParent}</span>
        </span>
      </label>
      <p id="name-status" aria-live="polite" className="min-h-5 text-xs">
        {label && !valid && <span className="text-muted">3 to 32 letters, numbers or hyphens.</span>}
        {valid && checking && (
          <span className="inline-flex items-center gap-1 text-muted">
            <LoaderCircle size={12} className="animate-spin" aria-hidden /> Checking…
          </span>
        )}
        {valid && !checking && available === true && <span className="text-private">Available.</span>}
        {valid && !checking && available === false && <span className="text-danger">Taken. Try another.</span>}
      </p>
      <Button type="submit" variant="primary" className="self-start" pending={pending} disabled={!valid || available !== true}>
        Claim {valid ? `${label}.${config.ensParent}` : "name"}
      </Button>
      {progress && <ReceiptSteps receipt={progress} />}
      <ErrorNote error={error} />
    </form>
  );
}

export default function Onboarding() {
  const router = useRouter();
  const { client, unavailable, identity, setIdentity, restoring, profile, setProfile } = useDrive();
  const { isConnected } = useAccount();
  const kind = useWalletKind();

  useEffect(() => {
    if (profile !== "me") setProfile("me");
  }, [profile, setProfile]);

  const signedIn = !!identity;
  const named = !!identity?.ensName;

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col px-5">
      <header className="flex items-center justify-between gap-3 py-5">
        <Link href="/">
          <Wordmark />
        </Link>
        <NetworkBadge compact />
      </header>
      <main className="flex flex-col gap-6 pb-16 pt-6">
        <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
        {!restoring && !client && <ClientUnavailable reason={unavailable ?? "No client."} />}
        <ol>
          <Step n={1} title="Connect a wallet" done={signedIn || (isConnected && kind === "eoa")}>
            {!signedIn && <ConnectWallet />}
          </Step>
          <Step n={2} title="Sign to make your keys" done={signedIn}>
            {!signedIn && client && isConnected && kind === "eoa" && <SignStep client={client} onSignedIn={setIdentity} />}
          </Step>
          <Step n={3} title="Claim your name" done={named}>
            {signedIn && !named && client && <ClaimStep client={client} onClaimed={setIdentity} />}
            {named && (
              <div className="flex flex-col gap-3 text-sm">
                <p>You&apos;re {identity!.ensName}. People can share with that name now.</p>
                <Button variant="primary" className="self-start" onClick={() => router.push("/drive")}>
                  Open my drive
                </Button>
              </div>
            )}
          </Step>
        </ol>
        <p className="text-sm text-muted">
          No wallet? <Link href="/try" className="underline">Try it without one</Link>.
        </p>
      </main>
    </div>
  );
}
