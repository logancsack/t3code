// How an open felt past its first view (firstView.ts): how long the page was
// busy in its first 30 seconds (long tasks, each over 50 ms) and its longest
// freeze, when the sidebar had every machine's threads, and its slowest
// interaction, with how many machines the directory listed and whether it
// was a phone. Told Aldo once, with a directory read, for `pnpm latency`.
// A page hidden meanwhile says nothing: a background tab's timings aren't
// what anyone felt.

import { appAtomRegistry } from "../rpc/atomRegistry";
import { allEnvironmentShellsBootstrappedAtom } from "../state/shell";
import { getAldoEnvironments, noteAldoOpen } from "./directory";
import { isAldoCloud } from "./api";

const WINDOW_MS = 30_000;
/** Interactions faster than this aren't the slowest anyone would notice. */
const EVENT_THRESHOLD_MS = 40;

export function installAldoOpenTimings(): void {
  if (!isAldoCloud || typeof PerformanceObserver === "undefined") return;
  if (document.visibilityState !== "visible") return;
  // A browser that can't see long tasks or interactions (Safari) says
  // nothing: its zeros would read as an open that never froze.
  const supported = PerformanceObserver.supportedEntryTypes ?? [];
  if (!supported.includes("longtask") || !supported.includes("event")) return;
  let measured = true;
  let busy = 0;
  let longest = 0;
  let input = 0;
  let sidebar: number | null = null;
  let hidden = false;
  const observers: Array<() => void> = [];
  const observe = (
    options: PerformanceObserverInit & { durationThreshold?: number },
    take: (entry: PerformanceEntry) => void,
  ) => {
    const takeAll = (entries: PerformanceEntryList) => {
      for (const entry of entries) if (entry.startTime < WINDOW_MS) take(entry);
    };
    try {
      const observer = new PerformanceObserver((list) => takeAll(list.getEntries()));
      observer.observe(options);
      // What it saw and hasn't said yet, then no more.
      observers.push(() => {
        takeAll(observer.takeRecords());
        observer.disconnect();
      });
    } catch {
      measured = false;
    }
  };
  observe({ type: "longtask", buffered: true }, (entry) => {
    busy += entry.duration;
    longest = Math.max(longest, entry.duration);
  });
  observe({ type: "event", buffered: true, durationThreshold: EVENT_THRESHOLD_MS }, (entry) => {
    if ((entry as PerformanceEventTiming).interactionId) input = Math.max(input, entry.duration);
  });
  const onVisibility = () => {
    if (document.visibilityState !== "visible") hidden = true;
  };
  document.addEventListener("visibilitychange", onVisibility);
  const stopSidebar = appAtomRegistry.subscribe(
    allEnvironmentShellsBootstrappedAtom,
    // Before the directory answers, no machines are listed, so none are missing.
    (ready) => {
      if (ready && sidebar === null && getAldoEnvironments() !== null) sidebar = performance.now();
    },
    { immediate: true },
  );
  window.setTimeout(
    () => {
      for (const stop of observers) stop();
      document.removeEventListener("visibilitychange", onVisibility);
      stopSidebar();
      if (hidden || !measured) return;
      const fields = {
        busy,
        longest,
        sidebar,
        input,
        machines: getAldoEnvironments()?.length ?? null,
        phone: window.matchMedia("(max-width: 767px)").matches ? 1 : 0,
      };
      noteAldoOpen(
        Object.entries(fields)
          .filter(([, value]) => value !== null)
          .map(([name, value]) => `${name}=${Math.round(value as number)}`)
          .join(";"),
      );
    },
    Math.max(0, WINDOW_MS - performance.now()),
  );
}
