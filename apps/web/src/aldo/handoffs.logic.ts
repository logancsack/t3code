// What a handoff's card says (AldoHandoffCard.tsx): an agent in its browser
// met what only the user can get past and asked them. The card leads with the
// reason and how long it usually takes, says what to do, and offers the one
// step that gets it past: doing it in the agent's browser, typing a code, or
// skipping the site.

import type { AldoHandoff, AldoHome } from "./cloud";

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

/** "Skip OpenTable", from the site's name; "Skip it" without one. */
export function aldoHandoffSkipLabel(h: Pick<AldoHandoff, "site">): string {
  if (!h.site) return "Skip it";
  const name = h.site.replace(/^www\./, "").split(".")[0] ?? h.site;
  return `Skip ${name.charAt(0).toUpperCase()}${name.slice(1)}`;
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
