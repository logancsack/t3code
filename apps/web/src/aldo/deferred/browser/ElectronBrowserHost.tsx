import { deferred } from "../../deferred";

const load = () => import("../../../browser/ElectronBrowserHost");
const Host = deferred(() => load().then((m) => m.ElectronBrowserHost));

export function startElectronBrowserHost(): () => void {
  if (!window.desktopBridge) return () => {};
  const stop = load().then((m) => m.startElectronBrowserHost());
  return () => void stop.then((dispose) => dispose());
}

export function ElectronBrowserHost() {
  return window.desktopBridge ? <Host /> : null;
}
