import type { Address, DriveClient, ShareOptions } from "@cloakroom/types";
import type { SubtreePreviewView, SubtreeRuleView } from "@cloakroom/ui";

/**
 * Add-on F2's optional DriveClient methods (the add-on's proposed @cloakroom/types additions, plus previewSubtree for
 * the share dialog's "12 members found" line). @cloakroom/core's subtree.ts implements the logic; a client exposes
 * these once createDriveClient wires them in. Until then the Team tab and the team panel don't appear.
 */
export interface TeamMethods {
  previewSubtree(parentEnsName: string): Promise<SubtreePreviewView>;
  shareWithSubtree(folder: Address, parentEnsName: string, opts: ShareOptions): Promise<SubtreeRuleView>;
  listSubtreeRules(folder: Address): Promise<SubtreeRuleView[]>;
  /** Excludes one person and removes them right away (revoke and key refresh). */
  excludeFromSubtree(folder: Address, parentEnsName: string, memberEnsName: string): Promise<void>;
  /** Ends the rule and removes everyone it shared with. */
  removeSubtreeRule(folder: Address, parentEnsName: string): Promise<void>;
}

/** The F2 methods this client has, bound to it. Missing ones are left out. */
export function teams(client: DriveClient): Partial<TeamMethods> {
  const c = client as DriveClient & Partial<TeamMethods>;
  return {
    ...(c.previewSubtree ? { previewSubtree: c.previewSubtree.bind(c) } : {}),
    ...(c.shareWithSubtree ? { shareWithSubtree: c.shareWithSubtree.bind(c) } : {}),
    ...(c.listSubtreeRules ? { listSubtreeRules: c.listSubtreeRules.bind(c) } : {}),
    ...(c.excludeFromSubtree ? { excludeFromSubtree: c.excludeFromSubtree.bind(c) } : {}),
    ...(c.removeSubtreeRule ? { removeSubtreeRule: c.removeSubtreeRule.bind(c) } : {}),
  };
}
