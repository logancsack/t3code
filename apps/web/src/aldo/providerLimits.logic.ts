// What's left of each plan the user's agents run on, on the Usage page's Plan
// limits (AldoProviderLimits.tsx): Aldo's GET /api/usage/limits reads Aldo's
// credits and each provider the user connected (Claude, ChatGPT, Grok, media
// generators) from its server, and keeps each reading a few minutes. An older
// Aldo has no such route, and nothing shows. Pure, so it's tested on its own.

/** A limit that fills and resets: a five-hour session, a week, a month's credits. */
export interface AldoLimitWindow {
  readonly id: string;
  readonly label: string;
  /** How much of it is used, 0 to 100. */
  readonly usedPercent: number;
  readonly resetsAt: string | null;
  /** The amounts behind the percentage, when the provider gives them ("127 of 10,000 credits"). */
  readonly detail: string | null;
}

export type AldoLimitState = "ok" | "near" | "reached" | "unknown";

export interface AldoProviderLimits {
  /** "aldo", "claude", "codex", "grok", or a media generator's id. */
  readonly id: string;
  readonly name: string;
  readonly plan: string | null;
  /** `near`: a limit is 80% used; `reached`: one is used up; `unknown`: nothing to measure. */
  readonly state: AldoLimitState;
  readonly windows: ReadonlyArray<AldoLimitWindow>;
  /** Other facts, a short sentence each ("873 credits left."). */
  readonly lines: ReadonlyArray<string>;
  /** Why it couldn't be read, in the user's terms. */
  readonly error: string | null;
  /** Where the provider shows it itself. */
  readonly url: string | null;
  readonly checkedAt: string;
}

const STATES: ReadonlySet<string> = new Set(["ok", "near", "reached", "unknown"]);

const isText = (value: unknown): value is string => typeof value === "string";
const isTextOrNull = (value: unknown): value is string | null => value === null || isText(value);

function isLimitWindow(value: unknown): value is AldoLimitWindow {
  if (!value || typeof value !== "object") return false;
  const window = value as Record<string, unknown>;
  return (
    isText(window.id) &&
    isText(window.label) &&
    typeof window.usedPercent === "number" &&
    Number.isFinite(window.usedPercent) &&
    isTextOrNull(window.resetsAt) &&
    isTextOrNull(window.detail)
  );
}

function isProviderLimits(value: unknown): value is AldoProviderLimits {
  if (!value || typeof value !== "object") return false;
  const limits = value as Record<string, unknown>;
  return (
    isText(limits.id) &&
    isText(limits.name) &&
    isTextOrNull(limits.plan) &&
    isText(limits.state) &&
    STATES.has(limits.state) &&
    Array.isArray(limits.windows) &&
    limits.windows.every(isLimitWindow) &&
    Array.isArray(limits.lines) &&
    limits.lines.every(isText) &&
    isTextOrNull(limits.error) &&
    isTextOrNull(limits.url) &&
    isText(limits.checkedAt)
  );
}

/**
 * The providers in Aldo's answer, null when it isn't one (an older Aldo may
 * answer with the web client's page). A provider it describes in a way this
 * client doesn't know is left out rather than shown wrong.
 */
export function aldoProviderLimitsOf(body: unknown): ReadonlyArray<AldoProviderLimits> | null {
  if (!body || typeof body !== "object") return null;
  const providers = (body as { providers?: unknown }).providers;
  return Array.isArray(providers) ? providers.filter(isProviderLimits) : null;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * When a limit resets, as someone planning around it reads it: "Resets in
 * 1 h 25 min" within a day, "Resets Mon 9:00 AM" within a week, then the date.
 */
export function limitResetCopy(iso: string | null, now: number, timeZone?: string): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const ms = at - now;
  if (ms <= MINUTE) return "Resets now";
  if (ms < HOUR) return `Resets in ${Math.ceil(ms / MINUTE)} min`;
  if (ms < DAY) {
    const hours = Math.floor(ms / HOUR);
    const minutes = Math.floor((ms % HOUR) / MINUTE);
    return minutes > 0 ? `Resets in ${hours} h ${minutes} min` : `Resets in ${hours} h`;
  }
  const date = new Date(at);
  if (ms < 7 * DAY) {
    const when = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      ...(timeZone ? { timeZone } : {}),
    }).format(date);
    return `Resets ${when}`;
  }
  const day = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
  return `Resets ${day}`;
}

/** How full a limit is, for its meter's color. */
export function limitTone(usedPercent: number): "ok" | "near" | "reached" {
  if (usedPercent >= 100) return "reached";
  if (usedPercent >= 80) return "near";
  return "ok";
}

/** A meter's fill, 0 to 1. */
export function limitFraction(usedPercent: number): number {
  return Math.min(1, Math.max(0, usedPercent / 100));
}

/** "49% used", rounded so a sliver of use isn't "0%" and a sliver left isn't "100%". */
export function limitUsedCopy(usedPercent: number): string {
  const rounded =
    usedPercent > 0 && usedPercent < 1
      ? 1
      : usedPercent > 99 && usedPercent < 100
        ? 99
        : Math.round(usedPercent);
  return `${rounded}% used`;
}

/** What to say beside a provider's name when it's close to or at a limit. */
export function limitStateCopy(state: AldoLimitState): string | null {
  if (state === "reached") return "Limit reached";
  if (state === "near") return "Close to its limit";
  return null;
}

/** A provider's own usage page, when it's one to open in a new tab (not Aldo's, which this is). */
export function limitPageUrl(limits: AldoProviderLimits): string | null {
  return limits.url?.startsWith("https://") ? limits.url : null;
}

/** The oldest reading shown, as its age ("Checked 3 min ago"); readings are kept a few minutes. */
export function limitsCheckedCopy(
  providers: ReadonlyArray<AldoProviderLimits>,
  now: number,
): string | null {
  const times = providers.map((limits) => Date.parse(limits.checkedAt)).filter(Number.isFinite);
  if (times.length === 0) return null;
  const ms = now - Math.min(...times);
  if (ms < MINUTE) return "Checked just now";
  if (ms < HOUR) return `Checked ${Math.floor(ms / MINUTE)} min ago`;
  return `Checked ${Math.floor(ms / HOUR)} h ago`;
}
