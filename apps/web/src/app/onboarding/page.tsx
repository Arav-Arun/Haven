"use client";

import type { DriveClient, Hex, Identity } from "@haven/types";
import { Button, ErrorNote, ReceiptSteps, inputClass } from "@haven/ui";
import { ArrowLeft, Check, LoaderCircle, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { ConnectWallet, useWalletKind } from "@/components/ConnectWallet";
import { config } from "@/lib/config";
import { useDrive } from "@/lib/drive";
import { HavenMark } from "@/components/landing/Logo";
import "./onboarding.css";

function Step({ n, title, description, done, active, children }: { n: number; title: string; description: string; done: boolean; active: boolean; children?: ReactNode }) {
  return (
    <li className="flex gap-4 py-6 first:pt-0 last:pb-0 sm:gap-5">
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${done ? "border-[#2563eb] bg-[#2563eb] text-white" : active ? "border-[#2563eb] bg-[#2563eb] text-white" : "border-[#d6e1f2] bg-white text-[#7890b3]"}`}
        aria-hidden
      >
        {done ? <Check size={14} /> : n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <h2 className={`text-base font-semibold ${active || done ? "text-[#0d1b33]" : "text-[#71829d]"}`}>
          {title}
          {done && <span className="sr-only"> (done)</span>}
          {active && !done && <span className="sr-only"> (current step)</span>}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-[#60718d]">{description}</p>
        {children && <div className="mt-4">{children}</div>}
      </div>
    </li>
  );
}

/**
 * Signature step. The client says whether this address is new (no haven.key yet): then the wallet must sign the
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
    // If this can't be told in time (a slow network on a phone), ask for two signatures: that always works, and a
    // returning wallet just signs once more.
    const fallback = setTimeout(() => live && setNeeded((n) => n ?? 2), 12_000);
    client.needsSecondSignature(address).then(
      (two) => live && setNeeded(two ? 2 : 1),
      () => live && setNeeded(2),
    );
    return () => {
      live = false;
      clearTimeout(fallback);
    };
  }, [client, address]);

  if (!address) return null;
  if (needed === null && !error) return <p className="text-sm text-muted">Checking whether this wallet has used Haven before…</p>;
  const message = client.signInMessage(address);
  const host = new URL(config.appOrigin).host;
  const mismatch = sigs.length === 2 && sigs[0] !== sigs[1];

  const have = needed !== null && sigs.length >= needed;
  const sign = async () => {
    setPending(true);
    setError(null);
    try {
      // Both signatures are in and only the key step failed: try again with them, without asking for a third.
      const next = have ? sigs : [...sigs, await signMessageAsync({ message })];
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
          ? "This wallet is new to Haven. Sign the same message twice: your keys are made from the signature, so your wallet has to give the same one every time."
          : "Sign the message to unlock your keys on this device. Nothing is sent to the chain."}
      </p>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-card p-3 text-xs">{message}</pre>
      <p className="flex gap-2 rounded-xl bg-warn-soft px-3 py-2 text-warn">
        <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          Only sign this on <strong>{host}</strong>. Anyone who gets this signature gets your Haven keys, so never sign it
          for another site.
        </span>
      </p>
      {mismatch ? (
        <ErrorNote error={{ code: "WALLET_NOT_SUPPORTED" }} />
      ) : (
        <Button variant="primary" className="self-start" pending={pending} onClick={sign}>
          {have ? (pending ? "Creating your keys…" : "Try again") : sigs.length === 0 ? "Sign" : "Sign again"}
          {!have && needed === 2 && ` (${sigs.length + 1} of 2)`}
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
      <p>Pick the name people will share with. It points to your Haven key, so they can share without asking you for anything.</p>
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
  const walletReady = isConnected && kind === "eoa";

  return (
    <div className="haven-onboarding min-h-dvh px-3 py-3 sm:px-5 sm:py-5">
      <div className="mx-auto min-h-[calc(100dvh-1.5rem)] max-w-[1600px] overflow-hidden rounded-[26px] border border-white/90 bg-white/55 sm:min-h-[calc(100dvh-2.5rem)]">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-6 py-5 sm:px-10 sm:py-7">
        <Link href="/" aria-label="Haven home" className="flex items-center gap-2.5 text-[#0d1b33]">
          <HavenMark size={36} />
          <span className="text-lg font-semibold tracking-tight">Haven</span>
        </Link>
      </header>
      <main className="mx-auto w-full max-w-xl px-6 pb-16 pt-7 sm:px-8 sm:pt-12">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-[#60718d] transition-colors hover:text-[#2563eb]">
          <ArrowLeft size={15} aria-hidden /> Back to home
        </Link>
        <div className="mt-8 sm:mt-10">
          <p className="text-sm font-semibold text-[#3972d9]">Get started</p>
          <h1 className="haven-onboarding-title mt-3 text-5xl text-[#0d1b33] sm:text-7xl">Sign in to Haven.</h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-[#60718d] sm:text-base">Connect your wallet to start sharing privately.</p>
        </div>
        {!restoring && !client && (
          <div role="status" className="mt-7 rounded-xl border border-[#e6d8b7] bg-[#faf6eb] px-4 py-3 text-sm text-[#765922]">
            <p className="font-semibold">Haven isn&apos;t fully set up yet</p>
            <p className="mt-1 leading-relaxed">You can connect a wallet, but sign-in needs the app&apos;s services to be configured.</p>
            <details className="mt-2 text-xs"><summary className="cursor-pointer font-medium">Technical details</summary><p className="mt-2 break-words">{unavailable ?? "No client."}</p></details>
          </div>
        )}
        <section aria-label="Sign-in steps" className="mt-7 rounded-[22px] border border-white bg-white/80 px-5 py-6 shadow-[0_20px_50px_-30px_rgb(28_64_140_/_0.25)] sm:px-8 sm:py-8">
        <ol className="divide-y divide-[#e8eef7]">
          <Step n={1} title="Connect your wallet" description="Choose the wallet you want to use with Haven." active={!signedIn && !walletReady} done={signedIn || walletReady}>
            {!signedIn && <ConnectWallet />}
          </Step>
          <Step n={2} title="Create your keys" description="Sign a message to securely unlock your space." active={!signedIn && walletReady} done={signedIn}>
            {!signedIn && client && isConnected && kind === "eoa" && <SignStep client={client} onSignedIn={setIdentity} />}
          </Step>
          <Step n={3} title="Claim your name" description="Give people an easy way to share with you." active={signedIn && !named} done={named}>
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
        </section>
        <div className="mt-6 px-1 text-center text-sm text-[#60718d]">
          No wallet? <Link href="/try" className="font-medium text-[#2563eb] underline-offset-4 hover:underline">Try it without one</Link>
        </div>
      </main>
      </div>
    </div>
  );
}
