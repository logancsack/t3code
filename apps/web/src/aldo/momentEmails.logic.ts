/**
 * The emails Aldo sends when a thread is done, needs the user or stops while
 * they're away from Aldo (its GET/PUT /api/notifications/email), each kind on
 * or off. An Aldo without them answers 404, and the rows stay hidden.
 */
export interface AldoMomentEmails {
  readonly done: boolean;
  readonly needsYou: boolean;
  readonly failed: boolean;
  /** The address they go to: the account's. */
  readonly to: string;
}

export type AldoMomentEmailKind = "done" | "needsYou" | "failed";

/** Aldo's answer, or null for one that isn't (an older Aldo's page for a path it doesn't have). */
export function parseAldoMomentEmails(body: unknown): AldoMomentEmails | null {
  if (!body || typeof body !== "object") return null;
  const { done, needsYou, failed, to } = body as Record<string, unknown>;
  if (typeof done !== "boolean" || typeof needsYou !== "boolean" || typeof failed !== "boolean")
    return null;
  return { done, needsYou, failed, to: typeof to === "string" ? to : "" };
}

/** The settings with one kind changed, as the switch shows it before Aldo answers. */
export function withMomentEmail(
  settings: AldoMomentEmails,
  kind: AldoMomentEmailKind,
  on: boolean,
): AldoMomentEmails {
  return { ...settings, [kind]: on };
}

/** The rows, in order: when each email comes, and what's in it. */
export const ALDO_MOMENT_EMAIL_ROWS: ReadonlyArray<{
  readonly kind: AldoMomentEmailKind;
  readonly title: string;
  readonly description: string;
}> = [
  {
    kind: "done",
    title: "When a thread is done",
    description: "What it came to, with links to what it made.",
  },
  {
    kind: "needsYou",
    title: "When a thread needs you",
    description:
      "Its question, with the answers as buttons you check before sending. An approval opens on Home: it’s never made from an email.",
  },
  {
    kind: "failed",
    title: "When a thread stops",
    description: "Why it stopped, and what to do next.",
  },
];

/** What the section says first: when these come, and where. */
export function momentEmailsIntro(to: string): string {
  const where = to ? ` to ${to}` : "";
  return `Only when you haven’t seen it in Aldo for a few minutes. They go${where}, and each has a link to stop that kind.`;
}
