"use client";

// How to get the Haven extension for Chrome, and connect it. Until it's listed on the Chrome Web Store
// (NEXT_PUBLIC_EXTENSION_STORE_URL), the build is served from this site as a zip to load unpacked.

import { extensionPresent } from "@haven/platform";
import { FxLabel } from "@haven/ui";
import { ArrowLeft, BellRing, CheckCircle2, Download, MousePointerClick, PanelRight, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { HavenMark } from "@/components/landing/Logo";
import { config } from "@/lib/config";

const ZIP = "/haven-extension.zip";

const FEATURES = [
  { icon: BellRing, title: "New shares, and a reminder before access ends", body: "A badge and a notification when someone shares with you, and another an hour before a share closes." },
  { icon: MousePointerClick, title: "Save to Haven from any page", body: "Right-click an image, a link or the page. It's encrypted on your device when you pick a folder." },
  { icon: PanelRight, title: "Your shares in the side panel", body: "Keep Haven open beside the page you're working on." },
  { icon: ShieldCheck, title: "Checks this website before giving it your keys", body: "The extension compares the site's code with the published, signed release. If it doesn't match, your keys stay locked." },
];

export default function ExtensionPage() {
  const [installed, setInstalled] = useState<boolean | null>(null);
  useEffect(() => {
    extensionPresent().then(setInstalled);
  }, []);
  const store = config.extensionStoreUrl;

  return (
    <div className="haven-onboarding min-h-dvh px-3 py-3 sm:px-5 sm:py-5">
      <div className="mx-auto min-h-[calc(100dvh-1.5rem)] max-w-[1600px] overflow-hidden rounded-[26px] border border-white/90 bg-white/55 sm:min-h-[calc(100dvh-2.5rem)]">
        <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-6 py-5 sm:px-10 sm:py-7">
          <Link href="/" aria-label="Haven home" className="flex items-center gap-2.5 text-[#0d1b33]">
            <HavenMark size={30} />
            <span className="text-lg font-semibold tracking-tight">Haven</span>
          </Link>
        </header>
        <main className="mx-auto w-full max-w-2xl px-6 pb-16 pt-4 sm:px-8 sm:pt-8">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-[#60718d] transition-colors hover:text-[#2563eb]">
            <ArrowLeft size={15} aria-hidden /> Back to home
          </Link>
          <h1 className="haven-onboarding-title mt-8 text-5xl text-[#0d1b33] sm:text-6xl">Haven for Chrome.</h1>
          <p className="mt-4 max-w-lg text-[#60718d] sm:text-lg">Your shares on the toolbar, saving from any page, and a check that this website is the real one.</p>

          {installed ? (
            <div role="status" className="mt-8 flex items-start gap-3 rounded-2xl border border-[#cfe8da] bg-[#f1faf5] px-5 py-4 text-[#1f6f4a]">
              <CheckCircle2 size={20} className="mt-0.5 shrink-0" aria-hidden />
              <div>
                <p className="font-semibold">The extension is installed in this browser.</p>
                <p className="mt-1 text-sm">
                  Connect it to your account: <Link href="/settings/" className="font-medium underline underline-offset-4">Settings → Connect extension</Link>.
                </p>
              </div>
            </div>
          ) : (
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a href={store || ZIP} {...(store ? { target: "_blank", rel: "noreferrer noopener" } : { download: "haven-extension.zip" })} className="btn-action fx inline-flex items-center gap-2 rounded-full px-6 py-3 text-[16px] font-semibold">
                <FxLabel>
                  <Download size={18} aria-hidden /> {store ? "Add to Chrome" : "Download for Chrome"}
                </FxLabel>
              </a>
              <span className="text-sm text-[#60718d]">Chrome, Brave, Edge and Arc. Free.</span>
            </div>
          )}

          <ul className="mt-10 grid gap-3 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="rounded-2xl border border-white bg-white/80 p-5">
                <Icon size={20} className="text-[#2563eb]" aria-hidden />
                <p className="mt-3 font-semibold text-[#0d1b33]">{title}</p>
                <p className="mt-1 text-sm leading-relaxed text-[#60718d]">{body}</p>
              </li>
            ))}
          </ul>

          {!store && !installed && (
            <section aria-labelledby="install" className="mt-10 rounded-[22px] border border-white bg-white/80 px-5 py-6 sm:px-8">
              <h2 id="install" className="text-lg font-semibold text-[#0d1b33]">Install it in a minute</h2>
              <p className="mt-1 text-sm text-[#60718d]">It isn&apos;t on the Chrome Web Store yet, so Chrome loads it from the folder you download.</p>
              <ol className="mt-5 flex flex-col gap-4 text-[15px] text-[#0d1b33]">
                <li>
                  <span className="font-semibold">1.</span> Download the zip above and unzip it.
                </li>
                <li>
                  <span className="font-semibold">2.</span> Open <code className="rounded bg-[#eef3fa] px-1.5 py-0.5 text-sm">chrome://extensions</code> in a new tab
                  (copy and paste it; links can&apos;t open it).
                </li>
                <li>
                  <span className="font-semibold">3.</span> Turn on <span className="font-medium">Developer mode</span> at the top right.
                </li>
                <li>
                  <span className="font-semibold">4.</span> Click <span className="font-medium">Load unpacked</span> and choose the unzipped folder. Pin Haven from the
                  puzzle icon.
                </li>
                <li>
                  <span className="font-semibold">5.</span> Reload this page, then go to <Link href="/settings/" className="font-medium text-[#2563eb] underline-offset-4 hover:underline">Settings → Connect extension</Link>.
                </li>
              </ol>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
