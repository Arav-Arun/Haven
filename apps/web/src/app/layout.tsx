import type { Metadata, Viewport } from "next";
import { Big_Shoulders, Hanken_Grotesk } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "./providers";

// Fonts are downloaded at build time and served from our own origin: no font requests leave the app.
const hanken = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-hanken", display: "swap" });
const shoulders = Big_Shoulders({ subsets: ["latin"], variable: "--font-shoulders", weight: ["700"], display: "swap", adjustFontFallback: false });

export const metadata: Metadata = {
  title: { default: "Cloakroom", template: "%s · Cloakroom" },
  description: "Share files privately with any ENS name. No one can see who you shared with, and new files lock when access ends.",
  applicationName: "Cloakroom",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Cloakroom", statusBarStyle: "default" },
  openGraph: {
    title: "Cloakroom",
    description: "Share files privately with any ENS name. No one can see who you shared with.",
    type: "website",
  },
};

export const viewport: Viewport = { themeColor: "#f1f2ee", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${hanken.variable} ${shoulders.variable}`}>
      <body className="min-h-dvh font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
