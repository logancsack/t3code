// The first screen loads only what it shows. Once it's up and the browser is
// idle, this fetches what the next click most likely needs (a thread, the
// palette's pickers, settings), so those open without waiting on the network.
// In Aldo, a part that can't load because Aldo was deployed again since the
// page loaded (its old files are gone) reloads the page into the new version.

import type { AppRouter } from "../router";
import { isAldoCloud } from "./cloud";

type RouteId = keyof AppRouter["routesById"];

interface NetworkInformationLike {
  readonly saveData?: boolean;
  readonly effectiveType?: string;
}

/** Set while fetching ahead of use: a failure then is nobody's to see, unless a page the user opened is loading too. */
let prefetching = false;
let appRouter: AppRouter | null = null;
const RELOADED_AT = "aldo:reloaded-for-code";
/** A reload that didn't bring the part either: the failure shows as it would. */
const RELOAD_AGAIN_AFTER_MS = 60_000;

/** A part of the app didn't load: reload into the version that has it, unless offline or just reloaded. */
function reloadForMissingCode(event: Event): void {
  // While fetching ahead, a page the user opened may be what failed: the
  // event doesn't say whose it was, so a loading page counts as theirs.
  if ((prefetching && !appRouter?.state.isLoading) || !navigator.onLine) return;
  try {
    if (Date.now() - Number(sessionStorage.getItem(RELOADED_AT) ?? 0) < RELOAD_AGAIN_AFTER_MS)
      return;
    sessionStorage.setItem(RELOADED_AT, String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
}

export function installAldoChunkPrefetch(router: AppRouter): void {
  appRouter = router;
  if (isAldoCloud) window.addEventListener("vite:preloadError", reloadForMissingCode);
  // Data saver or a 2G link: nothing ahead of use.
  const connection = (navigator as { connection?: NetworkInformationLike }).connection;
  if (connection?.saveData || connection?.effectiveType?.endsWith("2g")) return;
  // A moment after the first route has loaded, so its chunks and its data
  // never wait behind these.
  const unsubscribe = router.subscribe("onResolved", () => {
    unsubscribe();
    window.setTimeout(() => whenIdle(() => void prefetch(router)), 2_000);
  });
}

async function prefetch(router: AppRouter): Promise<void> {
  const route = (id: RouteId) => () => {
    const match = router.routesById[id];
    return match ? router.loadRouteChunk(match) : undefined;
  };
  // Most likely first; a thread or a draft needs the chat layout's chunk too.
  const next: ReadonlyArray<() => unknown> = [
    route("/_chat"),
    route("/_chat/$environmentId/$threadId"),
    route("/_chat/draft/$draftId"),
    route("/_chat/"),
    () => import("../components/files/ProjectFilePicker"),
    () => import("../components/search/ProjectContentSearchDialog"),
    ...(isAldoCloud ? [() => import("./AldoRepositoryDialog")] : []),
    route("/settings"),
    route("/settings/general"),
    () => import("../components/settings/SettingsSidebarNav"),
  ];
  // One at a time, so they don't crowd out what the page is fetching. A failed
  // fetch is ignored here; whatever needs it reports it as before.
  for (const load of next) {
    prefetching = true;
    try {
      await load();
    } catch {
      // Nothing to do ahead of use.
    } finally {
      prefetching = false;
    }
  }
}

function whenIdle(callback: () => void): void {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(callback, { timeout: 5_000 });
  } else {
    callback();
  }
}
