// The shared browser's chrome (AldoBrowserPanel.tsx): what its address bar and
// tabs say, and the one line under them that says who's using the browser.

/** A tab with nothing in it yet: the panel offers a start there instead. */
export function aldoBlankPage(url: string): boolean {
  return (
    url === "" ||
    url === "about:blank" ||
    url.startsWith("chrome://newtab") ||
    url.startsWith("chrome://new-tab-page")
  );
}

/**
 * The address at rest, as a browser shows it: the site in full, then the rest
 * quieter, without the scheme. Null for what isn't a web address.
 */
export function aldoAddressParts(url: string): { host: string; rest: string } | null {
  if (aldoBlankPage(url)) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const host = parsed.host.replace(/^www\./, "");
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return { host, rest: `${path}${parsed.search}${parsed.hash}` };
  } catch {
    return null;
  }
}

/** A tab's name: its title, else its site, else "New tab". */
export function aldoTabTitle(tab: { readonly url: string; readonly title: string }): string {
  if (aldoBlankPage(tab.url)) return "New tab";
  return tab.title.trim() || aldoAddressParts(tab.url)?.host || tab.url || "New tab";
}

/** Who a dialog is from: "resy.com says", as Chrome puts it. */
export function aldoDialogFrom(url: string): string {
  const host = aldoAddressParts(url)?.host;
  return host ? `${host} says` : "This page says";
}

/**
 * Who's using the browser, one at a time, most pressing first: a recording,
 * an agent waiting on the user, the user holding agents off, the agent at
 * work, the user at work (agents wait a moment after each click), or nobody.
 */
export type AldoBrowserState = "recording" | "handoff" | "yours" | "agent" | "using" | "shared";

export function aldoBrowserState(input: {
  readonly recording: boolean;
  readonly handoff: boolean;
  /** The user took control: agents wait until it's handed back. */
  readonly explicit: boolean;
  readonly agentActive: boolean;
  /** The user used the page in the last few seconds. */
  readonly using: boolean;
}): AldoBrowserState {
  if (input.recording) return "recording";
  if (input.handoff) return "handoff";
  if (input.explicit) return "yours";
  if (input.using) return "using";
  if (input.agentActive) return "agent";
  return "shared";
}
