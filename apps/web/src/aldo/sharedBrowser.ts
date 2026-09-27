import { managedWorkspaceBrowserUrl } from "../managedDevPc";
import { isAldoCloud } from "./cloud";

/** Whether this build has a shared, in-workspace browser (Aldo's or a managed workspace's). */
export function hasSharedBrowser(): boolean {
  return isAldoCloud || managedWorkspaceBrowserUrl() !== null;
}
