// A reload banner when Aldo is updated. A tab left open keeps running the
// client it loaded, however many deploys later, so it asks Aldo which version
// it is (/api/version): once when it loads, whenever it comes back into view,
// and every 10 minutes while it's visible. When the answer changes, a notice
// offers a reload. An Aldo that doesn't answer with a version (an older one,
// or one that can't be reached) shows nothing and isn't asked again soon.

import { toastManager } from "../components/ui/toast";
import { isAldoCloud } from "./cloud";
import {
  aldoVersionCheckDue,
  INITIAL_ALDO_VERSION_STATE,
  parseAldoVersion,
  recordAldoVersion,
  type AldoVersionCheckReason,
} from "./version.logic";

/** How often the timer looks at whether a check is due (the checks themselves are 10 minutes apart). */
const TICK_MS = 60_000;

let state = INITIAL_ALDO_VERSION_STATE;
let checking = false;

/** Aldo's version, or null if it didn't report one. Never redirects to sign-in. */
async function fetchAldoVersion(): Promise<string | null> {
  try {
    const response = await fetch("/api/version", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    return parseAldoVersion(await response.json());
  } catch {
    return null;
  }
}

async function check(reason: AldoVersionCheckReason | "load", onUpdated: () => void) {
  if (checking || (reason !== "load" && !aldoVersionCheckDue(state, Date.now(), reason))) return;
  checking = true;
  try {
    state = recordAldoVersion(state, await fetchAldoVersion(), Date.now());
  } finally {
    checking = false;
  }
  if (state.updated) onUpdated();
}

function showReloadNotice(): void {
  toastManager.add({
    type: "info",
    title: "Aldo was updated",
    description: "Reload to get the latest version.",
    timeout: 0,
    actionProps: { children: "Reload", onClick: () => window.location.reload() },
  });
}

/** Starts watching for a new Aldo. Does nothing outside Aldo. */
export function installAldoVersionCheck(): void {
  if (!isAldoCloud) return;
  const onVisible = () => {
    if (document.visibilityState === "visible") void check("visible", updated);
  };
  const timer = window.setInterval(() => {
    if (document.visibilityState === "visible") void check("interval", updated);
  }, TICK_MS);
  function updated() {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
    showReloadNotice();
  }
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  void check("load", updated);
}
