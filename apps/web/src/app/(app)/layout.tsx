import type { ReactNode } from "react";
import { Shell } from "@/components/Shell";

/** The app's screens: the sidebar shell only. The landing page's pull-up footer stays on the marketing pages. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <Shell>{children}</Shell>;
}
