// What a handoff's card says (AldoHandoffCard.tsx): an agent in its browser
// met what only the user can get past and asked them. The card leads with the
// reason and how long it usually takes, says what to do, and offers the one
// step that gets it past: taking control of the agent's browser (or doing it
// on a phone), typing a code, or skipping the site.

import { type AldoHandoff, type AldoHome } from "./homeApi";

/** Kinds whose card has a field for the code (D2): typed into the page by Aldo, never kept. */
const CODE_KINDS = new Set(["code"]);

/** The open handoff of one conversation, if it has one. */
export function aldoHandoffFor(
  home: Pick<AldoHome, "handoffs"> | null | undefined,
  target: { readonly environmentId: string; readonly threadId: string },
): AldoHandoff | null {
  return (
    home?.handoffs?.find(
      (h) =>
        h.thread.environmentId === target.environmentId && h.thread.threadId === target.threadId,
    ) ?? null
  );
}

/** The open handoff on one computer's browser, whichever of its conversations asked. */
export function aldoHandoffOn(
  home: Pick<AldoHome, "handoffs"> | null | undefined,
  environmentId: string,
): AldoHandoff | null {
  return home?.handoffs?.find((h) => h.thread.environmentId === environmentId) ?? null;
}

/** "about 10 seconds", "about a minute", "about 3 minutes"; null when it isn't known. */
export function aldoHandoffDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 50) return `about ${Math.max(5, Math.round(seconds / 5) * 5)} seconds`;
  const minutes = Math.round(seconds / 60);
  return minutes <= 1 ? "about a minute" : `about ${minutes} minutes`;
}

/** The line over the card's reason: "Needs you · about 10 seconds", when how long is known. */
export function aldoHandoffEyebrow(h: Pick<AldoHandoff, "seconds">): string {
  const duration = aldoHandoffDuration(h.seconds);
  return duration ? `Needs you · ${duration}` : "Needs you";
}

/** What to do, in one sentence: the agent's own, or one for its kind. */
export function aldoHandoffHow(h: Pick<AldoHandoff, "kind" | "how" | "site">): string {
  if (h.how) return h.how;
  const where = h.site ?? "the page";
  switch (h.kind) {
    case "captcha":
      return `Get past the check on ${where}, then hand it back.`;
    case "sign_in":
      return `Sign in on ${where}, then hand it back.`;
    case "code":
      return "Enter the code you were sent.";
    case "number_match":
      return `Tap the number ${where} shows on your other device, then hand it back.`;
    case "approve_on_device":
      return "Approve the sign-in on your other device, then hand it back.";
    case "identity":
      return `Confirm who you are on ${where} (an ID or a selfie), then hand it back.`;
    case "payout":
      return `Add your payout, bank or tax details on ${where}, then hand it back.`;
    default:
      return `Do what ${where} asks, then hand it back.`;
  }
}

/**
 * Done on the user's other device (approving a sign-in, tapping the number
 * the page shows): the card leads with "I'm done", and its browser is a look
 * away rather than the way through.
 */
export function aldoHandoffElsewhere(h: Pick<AldoHandoff, "kind">): boolean {
  return h.kind === "approve_on_device" || h.kind === "number_match";
}

export function aldoHandoffWantsCode(h: Pick<AldoHandoff, "kind">): boolean {
  return CODE_KINDS.has(h.kind);
}

/** Second-level suffixes under a country's (co.uk, com.au, ne.jp). */
const SECOND_LEVEL = new Set(["co", "com", "net", "org", "gov", "ac", "edu", "ne", "or"]);

/** A host's domain, as labels: opentable.com for www.opentable.com, bbc.co.uk for www.bbc.co.uk; an address is its own. */
function domainLabels(host: string): string[] {
  if (/^[\d.]+$/.test(host) || host.startsWith("[")) return [host];
  const labels = host.split(".");
  // The name before the suffix: opentable in opentable.com, google in accounts.google.com, bbc in bbc.co.uk.
  const twoPart =
    labels.length > 2 && labels.at(-1)!.length === 2 && SECOND_LEVEL.has(labels.at(-2)!);
  return labels.slice(twoPart ? -3 : -2);
}

/**
 * What the user knows a site as: its name as the reason writes it
 * ("OpenTable wants to check you're human" on www.opentable.com), else its
 * domain. The same as Aldo's notification says (its siteName).
 */
export function aldoHandoffSiteName(h: Pick<AldoHandoff, "site" | "reason">): string | null {
  const site = h.site?.trim().toLowerCase();
  if (!site) return null;
  const domain = domainLabels(site);
  const name = domain[0];
  const words = h.reason.match(/[\p{L}\p{N}][\p{L}\p{N}&'.-]*/gu) ?? [];
  const plain = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  for (let i = 0; i < words.length; i++) {
    const one = words[i]!.replace(/['.-]+$/, "");
    if (plain(one) === name) return one;
    // "Open Table", in two words.
    const two = words[i + 1];
    if (two !== undefined && plain(one + two) === name)
      return `${one} ${two.replace(/['.-]+$/, "")}`;
  }
  return domain.join(".");
}

/** "Skip OpenTable", by the name the reason gives the site, or its domain; "Skip it" without one. */
export function aldoHandoffSkipLabel(h: Pick<AldoHandoff, "site" | "reason">): string {
  const name = aldoHandoffSiteName(h);
  return name ? `Skip ${name}` : "Skip it";
}

/** A code as the user typed it, without the spaces and dashes codes are often shown with. */
export function aldoHandoffCode(typed: string): string {
  return typed.trim().replace(/[\s-]+/g, "");
}

/** The handoff a notification's "Do it now" opened the page for (`?handoff=<id>`), if any. */
export function aldoHandoffParam(search: string): string | null {
  const id = new URLSearchParams(search).get("handoff");
  return id && id.length <= 100 ? id : null;
}

/** A phone link, at most (Aldo sends none longer): its QR code has to scan off a screen. */
const PHONE_URL_CHARS = 1000;

/**
 * The site's own link for doing it on a phone (an ID check or selfie's
 * "continue on your phone"), when Aldo sent one: https, on the site the step
 * is on. Null otherwise, and from an older Aldo.
 */
export function aldoHandoffSiteLink(h: Pick<AldoHandoff, "phoneUrl" | "site">): string | null {
  const site = h.site?.trim().toLowerCase();
  if (!h.phoneUrl || !site || h.phoneUrl.length > PHONE_URL_CHARS) return null;
  try {
    const url = new URL(h.phoneUrl);
    const host = url.hostname;
    const onSite = host === site || domainLabels(host).join(".") === domainLabels(site).join(".");
    return url.protocol === "https:" && !url.username && !url.password && onSite ? url.href : null;
  } catch {
    return null;
  }
}

/** The conversation that asked, with the agent's browser full screen (`?handoff=`, AldoHandoffTakeover.tsx). */
export function aldoHandoffConversationPath(h: Pick<AldoHandoff, "id" | "thread">): string {
  const { environmentId, threadId } = h.thread;
  return `/${encodeURIComponent(environmentId)}/${encodeURIComponent(threadId)}?handoff=${encodeURIComponent(h.id)}`;
}

/**
 * Where "Do it on my phone" goes: the site's own link for a camera step
 * (`onSite`, where the phone's camera works), else the conversation with the
 * agent's browser full screen at the step, which a phone signed in to Aldo
 * opens (signed out, it signs in first and comes back). Null where this page
 * isn't on the web, so a phone has no address to open.
 */
export function aldoHandoffPhoneLink(
  h: Pick<AldoHandoff, "id" | "thread" | "phoneUrl" | "site">,
  origin: string,
): { readonly href: string; readonly onSite: boolean } | null {
  const site = aldoHandoffSiteLink(h);
  if (site) return { href: site, onSite: true };
  if (!/^https?:\/\/[^/]+$/.test(origin)) return null;
  return { href: origin + aldoHandoffConversationPath(h), onSite: false };
}

/** "Open on Fiverr": the site's own link for the step, on this phone. */
export function aldoHandoffSiteLabel(h: Pick<AldoHandoff, "site" | "reason">): string {
  const name = aldoHandoffSiteName(h);
  return name ? `Open on ${name}` : "Open the site's page";
}

/**
 * One of a card's buttons: "take" (Take control, the agent's browser full
 * screen), "phone" (Do it on my phone: a QR code and the link, on a
 * computer), "site" (the site's own page for the step, on this phone),
 * "done" (I'm done), "browser" (Open its browser) and "skip".
 */
export type AldoHandoffButton = "take" | "phone" | "site" | "done" | "browser" | "skip";

/**
 * A card's buttons, the main one first. A code is typed into the card, with
 * the browser beside it; what's done on another device leads with "I'm done".
 * Otherwise the agent's browser is the way: on a computer, "Take control" with
 * "Do it on my phone" beside it (when there's a link a phone can open); on a
 * phone, a camera step leads with the site's own page, where the camera works,
 * then "I'm done" once it's finished there.
 */
export function aldoHandoffButtons(
  h: Pick<AldoHandoff, "kind" | "phoneUrl" | "site">,
  context: { readonly onPhone: boolean; readonly phoneLink: boolean },
): ReadonlyArray<AldoHandoffButton> {
  if (aldoHandoffWantsCode(h)) return ["browser", "skip"];
  if (aldoHandoffElsewhere(h)) return ["done", "browser", "skip"];
  if (!context.onPhone) return context.phoneLink ? ["take", "phone", "skip"] : ["take", "skip"];
  return aldoHandoffSiteLink(h) ? ["site", "done", "take", "skip"] : ["take", "skip"];
}
