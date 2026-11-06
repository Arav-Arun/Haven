"use client";

import { missingConfig } from "@/lib/config";

/** Shown instead of guessing when required settings are missing. */
export function MissingConfig() {
  const missing = missingConfig();
  if (!missing.length) return null;
  return (
    <div role="alert" className="rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
      <p className="font-medium">This deployment is missing settings:</p>
      <ul className="mt-2 list-inside list-disc font-mono">
        {missing.map((k) => (
          <li key={k}>{k}</li>
        ))}
      </ul>
      <p className="mt-2">Set them in the environment (see .env.example) and rebuild.</p>
    </div>
  );
}
