"use client";

import { detectExtension, onPageVerification, requestVerifiedKeys, type PageVerification } from "@cloakroom/platform";
import type { DriveClient, Identity } from "@cloakroom/types";
import { Button, ErrorNote } from "@cloakroom/ui";
import { LoaderCircle, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { useEffect, useState } from "react";

/** Whether the extension is on this page, and what it found when it checked the page's code (add-on F3). */
export function useExtensionCheck() {
  const [present, setPresent] = useState<boolean | null>(null);
  const [verification, setVerification] = useState<PageVerification | null>(null);
  useEffect(() => {
    let live = true;
    let stop = () => {};
    detectExtension().then((yes) => {
      if (!live) return;
      setPresent(yes);
      if (yes) stop = onPageVerification((v) => live && setVerification(v));
    });
    return () => {
      live = false;
      stop();
    };
  }, []);
  return { present, verification };
}

/** One line on what the extension found. */
export function VerificationLine({ verification }: { verification: PageVerification | null }) {
  if (!verification)
    return (
      <p className="inline-flex items-center gap-1.5 text-sm text-muted">
        <LoaderCircle size={14} className="animate-spin" aria-hidden /> The extension is checking this page&apos;s code…
      </p>
    );
  if (verification.status === "verified")
    return (
      <p className="inline-flex items-center gap-1.5 text-sm text-private">
        <ShieldCheck size={14} aria-hidden /> Verified release v{verification.version}, matches commit{" "}
        {verification.gitCommit?.slice(0, 7)}, {verification.rebuilds ?? 0} independent{" "}
        {verification.rebuilds === 1 ? "rebuild" : "rebuilds"}.
      </p>
    );
  if (verification.status === "mismatch")
    return (
      <p role="alert" className="flex items-start gap-1.5 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
        <ShieldAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          This page&apos;s code doesn&apos;t match any published Cloakroom release. Don&apos;t sign in here.
          {verification.verifiedCopyUrl && (
            <>
              {" "}
              <a className="underline" href={verification.verifiedCopyUrl} rel="noreferrer noopener">
                Open the verified copy
              </a>
              .
            </>
          )}
        </span>
      </p>
    );
  return (
    <p className="inline-flex items-center gap-1.5 text-sm text-warn">
      <ShieldQuestion size={14} aria-hidden /> The extension couldn&apos;t check this page{verification.reason ? `: ${verification.reason}` : ""}.
    </p>
  );
}

/**
 * Sign in with the keys the extension holds. The extension hands them over only if every file this page has loaded
 * matches a published release, checked again at the moment of the request.
 */
export function ExtensionSignIn({ client, onSignedIn }: { client: DriveClient; onSignedIn: (i: Identity) => void }) {
  const { present, verification } = useExtensionCheck();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (present === null) return null;
  if (!present)
    return (
      <p className="rounded-md border border-dashed border-line px-3 py-2 text-sm text-muted">
        Install the Cloakroom extension to verify this page before using your keys. It checks every file this site loads
        against the published, open-source release.
      </p>
    );
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4 text-sm">
      <h2 className="font-semibold">Sign in with the Cloakroom extension</h2>
      <VerificationLine verification={verification} />
      <Button
        variant="primary"
        className="self-start"
        pending={pending}
        disabled={verification?.status === "mismatch"}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            const keys = await requestVerifiedKeys();
            if (!keys.ok) throw new Error(keys.error);
            try {
              onSignedIn(await client.signIn({ kind: "seed", seed: keys.seed }));
            } finally {
              keys.seed.fill(0);
            }
          } catch (e) {
            setError(e);
          } finally {
            setPending(false);
          }
        }}
      >
        Use the extension&apos;s keys
      </Button>
      <p className="text-muted">Works once the extension is connected to your account (Settings → Browser extension).</p>
      <ErrorNote error={error} />
    </section>
  );
}
