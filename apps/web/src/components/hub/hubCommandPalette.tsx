import type { EnvironmentId } from "@t3tools/contracts";
import { FilePlus2Icon } from "lucide-react";

import { ITEM_ICON_CLASS, type CommandPaletteActionItem } from "../CommandPalette.logic";

/** A hub has no folders to browse: its "local" source is an empty repository. */
export function buildHubBlankProjectSourceItem(
  environmentId: EnvironmentId,
  run: () => void,
): CommandPaletteActionItem {
  return {
    kind: "action",
    value: `action:add-project:${environmentId}:blank`,
    searchTerms: ["blank", "empty", "new", "scratch", "project"],
    title: "Blank project",
    description: "Start from an empty repository",
    icon: <FilePlus2Icon className={ITEM_ICON_CLASS} />,
    keepOpen: true,
    run: async () => run(),
  };
}

export interface HubAddProjectFlowCopy {
  readonly placeholder: string | null;
  readonly buttonLabel: string;
  readonly emptyStateMessage: string;
}

/**
 * Wording for the hub's add-repository step. Nothing is cloned here — each
 * thread's machine clones the repository — so the step adds and opens.
 */
export function hubAddProjectFlowCopy(flow: {
  readonly source: string;
  readonly blankProject?: boolean;
}): HubAddProjectFlowCopy {
  if (flow.blankProject) {
    return {
      placeholder: "Name your project",
      buttonLabel: "Create",
      emptyStateMessage: "Name the project and press Enter to create it.",
    };
  }
  if (flow.source === "url") {
    return {
      placeholder: "Enter Git repository URL",
      buttonLabel: "Add",
      emptyStateMessage: "Enter a Git repository URL and press Enter to add it.",
    };
  }
  return {
    placeholder: null,
    buttonLabel: "Add",
    emptyStateMessage: "Enter a repository path and press Enter to add it.",
  };
}
