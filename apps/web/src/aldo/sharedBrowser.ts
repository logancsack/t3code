import { isAldoCloud } from "./api";

/** Whether this build has a shared, in-workspace browser (Aldo's). */
export function hasSharedBrowser(): boolean {
  return isAldoCloud;
}
