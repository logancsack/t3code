import { managedWorkspaceBrowserUrl } from "../../managedDevPc";

/**
 * The machine a hub starts for provider sign-in has its own browser, reached
 * like a thread's under this reserved id.
 */
export const HUB_SIGN_IN_BROWSER_THREAD_ID = "aldo-provider-sign-in";

/**
 * Where a sign-in that needs the workspace browser should open it: the URL
 * the session names (a hub's sign-in machine), else the deployment's browser.
 *
 * TODO(thread-machines): read `session.workspaceBrowserUrl` directly once the
 * `AuthConnectorSession` contract carries it; until then decoding drops it
 * and the reserved sign-in id stands in.
 */
export function resolveAuthWorkspaceBrowserUrl(session: object | null): string | null {
  if (
    session !== null &&
    "workspaceBrowserUrl" in session &&
    typeof session.workspaceBrowserUrl === "string" &&
    session.workspaceBrowserUrl.length > 0
  ) {
    return session.workspaceBrowserUrl;
  }
  return managedWorkspaceBrowserUrl(HUB_SIGN_IN_BROWSER_THREAD_ID);
}
