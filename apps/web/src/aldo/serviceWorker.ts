// Aldo's service worker (/sw.js, served by Aldo): it shows notifications
// (notifications.ts), keeps the app's built files on the device so the app
// opens without waiting for them, and takes what a phone's share sheet sends
// to Aldo (shareTarget.logic.ts). It's registered on every load in Aldo, at
// the URL and scope notifications use. Pages and Aldo's API never come from
// it, and an Aldo whose worker only shows notifications is unaffected.

import { isAldoCloud } from "./api";

const WORKER = "/sw.js";

function supported(): boolean {
  return isAldoCloud && "serviceWorker" in navigator;
}

/** Registers the worker once the page has loaded, so its first install doesn't compete with the page. */
export function installAldoServiceWorker(navigate: (href: string) => Promise<unknown>): void {
  if (!supported()) return;
  navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
    if (event.data?.type !== "aldo-open" || typeof event.data.url !== "string") return;
    const url = new URL(event.data.url, location.origin);
    if (url.origin !== location.origin) return;
    // Acknowledge synchronously so the worker knows this client can route the tap.
    event.ports[0]?.postMessage("opened");
    void navigate(url.pathname + url.search + url.hash).catch(() => location.assign(url.href));
  });
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
