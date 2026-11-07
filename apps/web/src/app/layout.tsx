import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk } from "next/font/google";
import type { ReactNode } from "react";
import { preload } from "react-dom";
import "@rainbow-me/rainbowkit/styles.css";
import "./globals.css";
import { Intro } from "@/components/intro/Intro";
import { Providers } from "./providers";

// Fonts are downloaded at build time and served from our own origin: no font requests leave the app.
const hanken = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-hanken", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Haven", template: "%s · Haven" },
  description: "Share files privately with any ENS name. No one can see who you shared with, and new files lock when access ends.",
  applicationName: "Haven",
  manifest: "/manifest.webmanifest",
  // `?v=` makes browsers drop icons they cached before the clay tile (5: after the monochrome ones).
  icons: { icon: [{ url: "/favicon.png?v=5", sizes: "64x64", type: "image/png" }, { url: "/icon-192.png?v=5", sizes: "192x192", type: "image/png" }], apple: "/apple-touch-icon.png?v=5" },
  appleWebApp: { capable: true, title: "Haven", statusBarStyle: "default" },
  openGraph: {
    title: "Haven",
    description: "Share files privately with any ENS name. No one can see who you shared with.",
    type: "website",
  },
};

export const viewport: Viewport = { themeColor: "#eef3fa", width: "device-width", initialScale: 1, viewportFit: "cover" };

/**
 * The page's security policy, as a meta tag so the Swarm copy (which can't set headers) gets it too. Scripts only from
 * our own origin, so no third-party script can ever load. 'unsafe-inline' is needed by the static export's inline
 * bootstrap; 'wasm-unsafe-eval' and blob: by the Anon-RPC worker. Network calls go to https/wss only: RPCs, our API,
 * Bee, the worker's code hosts and the mixnet. Development builds skip it (hot reload needs ws://localhost and eval).
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: data:",
  "worker-src 'self' blob: data:",
  "frame-src 'self' blob:",
  "child-src 'self' blob:",
  "connect-src 'self' https: wss:",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export default function RootLayout({ children }: { children: ReactNode }) {
  // The loading cover draws the logo from this file; fetching it with the HTML lets the glass appear sooner.
  preload("/haven-mark.webp", { as: "image", fetchPriority: "high" });
  return (
    <html lang="en" className={hanken.variable}>
      {process.env.NODE_ENV === "production" && (
        <head>
          <meta httpEquiv="Content-Security-Policy" content={CSP} />
          <meta name="referrer" content="no-referrer" />
        </head>
      )}
      <body className="min-h-dvh font-sans antialiased">
        <Intro />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
