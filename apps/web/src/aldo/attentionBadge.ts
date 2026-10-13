// How many things wait on the user, where they'll see it away from the home
// screen: "(2) Aldo" in the tab's title, a dot on the favicon, and the
// installed app's icon badge. All three read the one count the home screen's
// Threads tab shows (decisions.logic.ts aldoWaitingCount), from Aldo's home
// read, which stays fresh on every page while AldoAttentionSync is mounted.
// The optional sound (chime.ts) listens to the same read from here.

import { useEffect } from "react";
import { create } from "zustand";

import { useAldoChime } from "./chime";
import { aldoWaitingCount } from "./decisions.logic";
import { useAldoHomeRead } from "./homeFeed";

/** The favicon with an amber dot, from Aldo's own mark. */
const DOTTED_ICON = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect x="10.667" y="10.667" width="490.666" height="490.666" rx="106.667" fill="#000"/><svg x="64" y="109.714" width="384" height="292.571" viewBox="0 0 42 32"><path fill="#fff" d="M1 28 13.4 4h8.7L10.6 28H1Z"/><path fill="#fff" d="M23.9 4h8.7L41 28h-9.6L23.9 4Z"/></svg><circle cx="400" cy="112" r="104" fill="#f59e0b" stroke="#000" stroke-width="24"/></svg>`,
)}`;

/** The icons the page started with, to put back once nothing waits. */
const original = new Map<HTMLLinkElement, string>();

function setFavicon(dotted: boolean): void {
  for (const link of document.querySelectorAll<HTMLLinkElement>("link[rel~='icon']")) {
    if (!original.has(link)) original.set(link, link.getAttribute("href") ?? "");
    link.href = dotted ? DOTTED_ICON : original.get(link)!;
  }
}

function setAppBadge(count: number): void {
  const nav = navigator as Navigator & {
    setAppBadge?: (count?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  // Only an installed app has a badge; elsewhere these reject or don't exist.
  if (count > 0) void nav.setAppBadge?.(count).catch(() => undefined);
  else void nav.clearAppBadge?.().catch(() => undefined);
}

const useCount = create<{ readonly count: number }>(() => ({ count: 0 }));

/** How many things wait on the user (0 outside Aldo, or before the first read). */
export function useAldoAttentionCount(): number {
  return useCount((s) => s.count);
}

/** Keeps the count, the favicon and the badge in step, in the signed-in app, and plays the optional sound. */
export function AldoAttentionSync(): null {
  const { home } = useAldoHomeRead();
  useAldoChime();
  const count = home ? aldoWaitingCount(home, Date.now()) : 0;
  useEffect(() => {
    useCount.setState({ count });
    setFavicon(count > 0);
    setAppBadge(count);
  }, [count]);
  useEffect(
    () => () => {
      useCount.setState({ count: 0 });
      setFavicon(false);
      setAppBadge(0);
    },
    [],
  );
  return null;
}
