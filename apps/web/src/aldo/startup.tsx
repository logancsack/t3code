// What Aldo starts before T3's app services (main.tsx): its command dispatch,
// its caches and sync, the landing page's demo and replay, and its history.
import {
  createBrowserHistory,
  createHashHistory,
  type RouterHistory,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { isElectron } from "../env";
import { initializeLandingDemoClientSettings } from "../hooks/useSettings";
import { isLandingDemo, isWorkReplay } from "../landingDemo/mode";
import { installPrismGlass } from "../prismGlass";
import type { AppRouter } from "../router";
import { isAldoCloud } from "./api";
import { installAldoChunkPrefetch } from "./chunkPrefetch";
import { installAldoCommandDispatch } from "./dispatch";
import { installAldoFirstView } from "./firstView";
import { installAldoLayers, seedAldoHome } from "./layers";
import { installAldoMachineSettings } from "./machineSettings";
import { installAldoNotificationsSync } from "./notifications";
import { installAldoOpenTimings } from "./openTimings";
import { installAldoReconnect } from "./reconnect";
import { installAldoServerConfigCapture } from "./serverConfig";
import { installAldoServiceWorker } from "./serviceWorker";
import { installAldoShellSync } from "./shells";
import { installAldoThreadDetails } from "./threadDetails";
import { installAldoVersionCheck } from "./version";

function WorkReplayMounted() {
  useEffect(() => {
    parent.postMessage({ type: "aldo:replay-mounted" }, "*");
  }, []);
  return null;
}

/** Resolves with the history Aldo needs, if not T3's own, and what it mounts beside the app. */
export async function prepareAldoStartup(): Promise<{
  readonly history: RouterHistory | undefined;
  readonly mounted: ReactNode;
}> {
  const replay = isWorkReplay();
  if (replay) await (await import("../landingDemo/replay")).startWorkReplay();
  installPrismGlass();
  const landingDemo = isLandingDemo();
  if (landingDemo) {
    initializeLandingDemoClientSettings();
    if (!replay) document.documentElement.classList.add("dark");
  } else {
    installAldoCommandDispatch();
    installAldoServerConfigCapture();
    installAldoMachineSettings();
    installAldoVersionCheck();
    installAldoNotificationsSync();
    installAldoShellSync();
    installAldoThreadDetails();
    installAldoReconnect();
    installAldoFirstView();
    installAldoOpenTimings();
  }

  const layered = isAldoCloud && !isElectron && (!landingDemo || replay);
  if (layered && !landingDemo) seedAldoHome();
  // The demo keeps its place in the hash, so the page framing it keeps its own address.
  const history = landingDemo ? createHashHistory() : layered ? createBrowserHistory() : undefined;
  if (layered && history) installAldoLayers(history);
  return { history, mounted: replay ? <WorkReplayMounted /> : null };
}

export function installAldoRouter(router: AppRouter): void {
  if (!isLandingDemo()) installAldoServiceWorker((href) => router.navigate({ href }));
  installAldoChunkPrefetch(router);
}
