import type { AuthConnectorSession } from "@t3tools/contracts";

import { managedWorkspaceBrowserUrl } from "../../managedDevPc";

/**
 * Where a sign-in that needs the workspace browser should open it: the page
 * the session names (a hub's sign-in machine), else the persistent
 * workspace's browser. A hub names it once the provider's flow runs in a
 * browser on its sign-in machine; until then there is none.
 */
export function resolveAuthWorkspaceBrowserUrl(
  session: AuthConnectorSession | null,
): string | null {
  return session?.workspaceBrowserUrl ?? managedWorkspaceBrowserUrl();
}

/**
 * A hub reports its own progress while it starts the sign-in machine and
 * while it saves the finished sign-in; show that message as the status line.
 */
export function hubAuthConnectorProgress(
  session: Pick<AuthConnectorSession, "stage" | "message"> | null,
): string | null {
  return session?.stage === "preparing" || session?.stage === "verifying" ? session.message : null;
}
