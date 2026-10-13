// The first screen loads only what it shows. Once it's up and the browser is
// idle, this fetches what the next click most likely needs (a thread, the
// palette's pickers, settings), so those open without waiting on the network.

import type { AppRouter } from "../router";
import { isAldoCloud } from "./cloud";

type RouteId = keyof AppRouter["routesById"];

interface NetworkInformationLike {
  readonly saveData?: boolean;
  readonly effectiveType?: string;
}

export function installAldoChunkPrefetch(router: AppRouter): void {
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
    try {
      await load();
    } catch {
      // Nothing to do ahead of use.
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
