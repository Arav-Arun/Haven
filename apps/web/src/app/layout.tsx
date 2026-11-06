import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { NetworkBadge } from "@/components/NetworkBadge";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Cloakroom",
  description: "Share files with ENS names privately: hidden members, and new files lock out when access ends.",
};

export const viewport: Viewport = { themeColor: "#f7f6f2", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans antialiased">
        <Providers>
          <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
            <span className="text-lg font-semibold tracking-tight">Cloakroom</span>
            <NetworkBadge />
          </header>
          <main className="mx-auto max-w-5xl px-5 pb-16">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
