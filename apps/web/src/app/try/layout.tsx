import type { ReactNode } from "react";
import { PullUpFooter } from "@/components/SiteFooter";

/** "Try it": the same footer as every other page. */
export default function Layout({ children }: { children: ReactNode }) {
  return <PullUpFooter>{children}</PullUpFooter>;
}
