"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useConnect } from "wagmi";

/**
 * Shows the WalletConnect pairing link as a QR code, generated locally. Reown's hosted modal is never
 * loaded (showQrModal: false), so no third-party scripts or images reach the page.
 */
export function WalletConnectQr() {
  const { connectors } = useConnect();
  const [uri, setUri] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    const offs = connectors.map((c) => {
      const handler = (m: { type: string; data?: unknown }) => {
        if (m.type === "display_uri" && typeof m.data === "string") setUri(m.data);
      };
      c.emitter.on("message", handler);
      return () => c.emitter.off("message", handler);
    });
    return () => offs.forEach((off) => off());
  }, [connectors]);

  useEffect(() => {
    if (!uri) return setSvg(null);
    QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).then(setSvg, () => setSvg(null));
  }, [uri]);

  if (!uri || !svg) return null;
  return (
    <div className="mt-3 flex flex-col items-center gap-2 rounded-xl border border-line p-4">
      <p className="text-sm">Scan with your phone wallet</p>
      <div className="w-56" aria-label="WalletConnect QR code" dangerouslySetInnerHTML={{ __html: svg }} />
      <button className="text-sm text-muted underline" onClick={() => navigator.clipboard.writeText(uri)}>
        Copy pairing link
      </button>
    </div>
  );
}
