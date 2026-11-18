// Holding Aldo's own merge of a pull request (Aldo's src/lib/prs.ts holdMerge):
// held, it waits for the user's merge in Needs you. Said with Undo.

import { toastManager } from "../components/ui/toast";
import { type AldoHomePullRequest } from "./homeApi";
import { refreshAldoHome } from "./homeFeed";
import { holdAldoMerge } from "./workspaceApi";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Holds Aldo's own merge of a pull request (it waits for the user's, in Needs
 * you), or lets it go, saying so with Undo. True when it's done.
 */
export async function setAldoMergeHold(
  pr: Pick<AldoHomePullRequest, "environmentId" | "repo" | "number">,
  held: boolean,
  undoable = true,
): Promise<boolean> {
  try {
    await holdAldoMerge(pr.environmentId, pr, held);
  } catch (cause) {
    toastManager.add({
      type: "error",
      title: held ? `Couldn't hold #${pr.number}` : `Couldn't let Aldo merge #${pr.number}`,
      description: messageOf(cause),
    });
    return false;
  }
  void refreshAldoHome();
  const id = toastManager.add({
    type: "success",
    title: held ? `Held #${pr.number}` : `Aldo can merge #${pr.number} on its own again`,
    description: held
      ? "Aldo won't merge it. It waits in Needs you for your Merge."
      : "Once its checks have passed for 10 minutes, as your merge setting allows.",
    timeout: 10_000,
    ...(undoable
      ? {
          actionProps: {
            children: "Undo",
            onClick: () => {
              toastManager.close(id);
              void setAldoMergeHold(pr, !held, false);
            },
          },
        }
      : {}),
  });
  return true;
}
