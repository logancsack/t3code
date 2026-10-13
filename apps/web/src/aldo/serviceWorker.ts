// Aldo's service worker (/sw.js, served by Aldo): it shows notifications
// (notifications.ts), keeps the app's built files on the device so the app
// opens without waiting for them, and takes what a phone's share sheet sends
// to Aldo (shareTarget.logic.ts). It's registered on every load in Aldo, at
// the URL and scope notifications use. Pages and Aldo's API never come from
// it, and an Aldo whose worker only shows notifications is unaffected.

import { isAldoCloud } from "./cloud";

const WORKER = "/sw.js";

function supported(): boolean {
  return isAldoCloud && "serviceWorker" in navigator;
}

/** Registers the worker once the page has loaded, so its first install doesn't compete with the page. */
export function installAldoServiceWorker(): void {
  if (!supported()) return;
  const register = () => {
    navigator.serviceWorker.register(WORKER).catch(() => undefined);
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}

/** Asks the worker to update now Aldo has been deployed again, so it has the new files before the next launch. */
export function updateAldoServiceWorker(): void {
  if (!supported()) return;
  navigator.serviceWorker
    .getRegistration(WORKER)
    .then((registration) => registration?.update())
    .catch(() => undefined);
}
