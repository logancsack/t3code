// The welcome on Home and what it decides (onboarding.ts, AldoWelcome.tsx),
// pure so it's tested on its own. A new account is asked once what it'll hand
// Aldo first; Aldo keeps the answer (GET and PATCH /api/account: `onboardedAt`,
// null until it's answered or skipped, and `interests`, null for accounts from
// before the welcome, empty for a skip). The answer picks Home's starters
// (starters.logic.ts), turns simple mode on unless it includes code
// (simpleMode.logic.ts), and keeps the developer tools (pull requests, Code
// settings, Terminal and Diff) for code or a connected git host. An Aldo that
// doesn't report `onboardedAt` has no welcome, and the app stays as it was.

/** The kinds of work the welcome offers, as Aldo names them. */
export type AldoInterest = "business" | "finance" | "documents" | "media" | "research" | "code";

/** In the order the welcome shows them, with their words. */
export const ALDO_INTERESTS: ReadonlyArray<{ readonly id: AldoInterest; readonly label: string }> =
  [
    { id: "business", label: "Running a business" },
    { id: "finance", label: "Finance and spreadsheets" },
    { id: "documents", label: "Decks and documents" },
    { id: "media", label: "Video and design" },
    { id: "research", label: "Research" },
    { id: "code", label: "Code and apps" },
  ];

const KNOWN: ReadonlySet<string> = new Set(ALDO_INTERESTS.map((interest) => interest.id));

export interface AldoOnboarding {
  /** When the welcome was answered or skipped; null while it waits. */
  readonly onboardedAt: string | null;
  /** What they said, in the welcome's order; null when they were never asked, empty for a skip. */
  readonly interests: ReadonlyArray<AldoInterest> | null;
}

/** The known interests in a value, once each and in the welcome's order; null when it isn't a list. */
export function aldoInterestsFrom(value: unknown): ReadonlyArray<AldoInterest> | null {
  if (!Array.isArray(value)) return null;
  return ALDO_INTERESTS.map((interest) => interest.id).filter(
    (id) => KNOWN.has(id) && value.includes(id),
  );
}

/** The welcome's state in Aldo's account read or its answer to a change; null from an Aldo without it. */
export function aldoOnboardingFrom(body: unknown): AldoOnboarding | null {
  if (typeof body !== "object" || body === null || !("onboardedAt" in body)) return null;
  const { onboardedAt, interests } = body as { onboardedAt: unknown; interests?: unknown };
  if (onboardedAt !== null && (typeof onboardedAt !== "string" || !onboardedAt)) return null;
  return { onboardedAt, interests: aldoInterestsFrom(interests) };
}

/** Whether Home asks the welcome's question: only when Aldo says it's still waiting. */
export function aldoWelcomeShows(onboarding: AldoOnboarding | null | undefined): boolean {
  return onboarding !== undefined && onboarding !== null && onboarding.onboardedAt === null;
}

/** What the welcome calls them: the first word of their name, or nothing. */
export function aldoFirstName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

/** Whether the welcome's answer turns simple mode on (when the user hasn't set it): any answer without code. */
export function aldoSimpleByDefault(interests: ReadonlyArray<AldoInterest> | null): boolean {
  return interests !== null && !interests.includes("code");
}

/**
 * Whether the app shows the developer tools: pull requests, Code settings, and
 * the Terminal and Diff in a thread. Always for an account that was never
 * asked (as before the welcome) and for code; otherwise once a git host is
 * connected. Undefined while that isn't known yet: they wait, hidden.
 */
export function aldoDeveloperToolsShown(input: {
  /** What they told the welcome; undefined until the account is read. */
  readonly interests: ReadonlyArray<AldoInterest> | null | undefined;
  /** Whether a git host is connected; null while that isn't known. */
  readonly gitHost: boolean | null;
}): boolean | undefined {
  if (input.interests === undefined) return undefined;
  if (input.interests === null || input.interests.includes("code") || input.gitHost === true)
    return true;
  return input.gitHost === null ? undefined : false;
}
