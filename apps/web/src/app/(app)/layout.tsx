import type { ReactNode } from "react";
import { Shell } from "@/components/Shell";
import { PullUpFooter } from "@/components/SiteFooter";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <PullUpFooter>
      <Shell>{children}</Shell>
    </PullUpFooter>
  );
}
