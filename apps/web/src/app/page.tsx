import { ConnectWallet } from "@/components/ConnectWallet";
import { MissingConfig } from "@/components/MissingConfig";

export default function Home() {
  return (
    <div className="flex flex-col gap-8 pt-10">
      <MissingConfig />
      <section className="max-w-2xl">
        <h1 className="text-4xl font-semibold leading-tight tracking-tight">Share files privately with any ENS name.</h1>
        <p className="mt-4 text-lg text-muted">
          No one can see who you shared with. When someone&apos;s access ends, every new file is locked for them, with no transaction.
          What they already opened, they keep, as with any file you share.
        </p>
      </section>
      <section className="max-w-md rounded-2xl border border-line bg-card p-5">
        <h2 className="mb-3 font-medium">Sign in</h2>
        <ConnectWallet />
      </section>
    </div>
  );
}
