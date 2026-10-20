// The plan picker under a request sent to Aldo before choosing a plan (Aldo's
// src/lib/assistant/pending.ts). Aldo keeps the request and its refusal (402)
// carries what the picker shows (`needsPlan`); Checkout started from it comes
// back to Home (/?resume=<id>&session_id=<Checkout's>), and the page asks Aldo
// to send the kept request (a chat turn with `resume`), which it does once. A
// page that loads while one is kept shows it again with the picker, or sends
// it once a plan is on (a tab closed meanwhile). An older Aldo sends none of
// this: its refusal is a plain error, as before. Pure, so it's tested on its own.

import { withoutImageNotes } from "./assistant.logic";
import { formatPlanPrice } from "./billing.logic";

/** A plan the picker offers, with what it includes in Aldo's words (`lines`). */
export interface AldoPickerPlan {
  readonly id: string;
  readonly name: string;
  readonly priceCents: number;
  readonly credits: number;
  readonly concurrent: number;
  readonly lines: readonly string[];
}

/** What Aldo's refusal of a request it kept carries for the picker. */
export interface AldoNeedsPlan {
  /** The kept request: Checkout comes back with it, and the page sends it. */
  readonly requestId: string;
  readonly text: string;
  /** No plan yet, or the plan ended. */
  readonly reason: "none" | "ended";
  /** What Aldo says above the picker. */
  readonly say: string;
  /** Cheapest first. */
  readonly plans: readonly AldoPickerPlan[];
  /** Under the plans: how they renew, and how to change or cancel. */
  readonly note: string;
}

/** A request Aldo keeps until a plan lets it go. */
export interface AldoKeptRequest {
  readonly id: string;
  readonly text: string;
  readonly at: string;
  /** How many images go with it (Aldo has them). */
  readonly images: number;
}

export interface AldoKept {
  readonly pending: AldoKeptRequest | null;
  /** The picker's, while a plan is what the request waits for; null once it can go. */
  readonly needsPlan: AldoNeedsPlan | null;
}

/** Back from Checkout started from the picker. */
export interface AldoCheckoutReturn {
  readonly requestId: string;
  /** Checkout's session, so Aldo can confirm the plan without waiting for Stripe's webhook. */
  readonly checkoutSession: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function pickerPlanOf(value: unknown): AldoPickerPlan | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.name !== "string" ||
    !value.name ||
    !isCount(value.priceCents) ||
    !isCount(value.credits) ||
    !isCount(value.concurrent)
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    priceCents: value.priceCents,
    credits: value.credits,
    concurrent: value.concurrent,
    lines: Array.isArray(value.lines)
      ? value.lines.filter((line): line is string => typeof line === "string" && line !== "")
      : [],
  };
}

/** The picker's data in a refusal's body (`{ error, needsPlan }`), or null: an older Aldo's, or another refusal. */
export function needsPlanOf(body: unknown): AldoNeedsPlan | null {
  const value = isRecord(body) ? body.needsPlan : null;
  if (
    !isRecord(value) ||
    typeof value.requestId !== "string" ||
    !value.requestId ||
    typeof value.text !== "string" ||
    (value.reason !== "none" && value.reason !== "ended") ||
    !Array.isArray(value.plans)
  ) {
    return null;
  }
  const plans = value.plans.flatMap((plan) => pickerPlanOf(plan) ?? []);
  // Nothing to choose: the refusal's words are all there is.
  if (plans.length === 0) return null;
  return {
    requestId: value.requestId,
    text: value.text,
    reason: value.reason,
    say: typeof value.say === "string" ? value.say : "",
    plans,
    note: typeof value.note === "string" ? value.note : "",
  };
}

/** GET /api/assistant/pending's answer, or null where this Aldo doesn't keep requests (an older one). */
export function keptOf(body: unknown): AldoKept | null {
  if (!isRecord(body) || !("pending" in body)) return null;
  const p = body.pending;
  const pending =
    isRecord(p) &&
    typeof p.id === "string" &&
    p.id &&
    typeof p.text === "string" &&
    typeof p.at === "string"
      ? { id: p.id, text: p.text, at: p.at, images: isCount(p.images) ? p.images : 0 }
      : null;
  return { pending, needsPlan: pending ? needsPlanOf(body) : null };
}

const RESUME_PARAM = "resume";
const SESSION_PARAM = "session_id";
const REQUEST_ID = /^pr_[0-9a-z]{6,32}$/;

/** Back from Checkout started from the picker: /?resume=<id>&session_id=<Checkout's>. */
export function checkoutReturnOf(search: string): AldoCheckoutReturn | null {
  const params = new URLSearchParams(search);
  const requestId = params.get(RESUME_PARAM) ?? "";
  if (!REQUEST_ID.test(requestId)) return null;
  const session = params.get(SESSION_PARAM) ?? "";
  return { requestId, checkoutSession: /^cs_[A-Za-z0-9_]+$/.test(session) ? session : null };
}

/** The query without the way back's, to put in the address bar once it's read. */
export function withoutCheckoutReturn(search: string): string {
  const params = new URLSearchParams(search);
  if (!params.has(RESUME_PARAM)) return search;
  params.delete(RESUME_PARAM);
  params.delete(SESSION_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

/** What a page that loads does about a kept request. */
export type AldoKeptStep =
  | { readonly kind: "nothing" }
  /** Still without a plan: the request shows again, with the picker. */
  | { readonly kind: "pick"; readonly request: AldoKeptRequest; readonly needs: AldoNeedsPlan }
  /** Back from Checkout, or a plan's on: send it (`request`, when the page knows its words). */
  | {
      readonly kind: "resume";
      readonly requestId: string;
      readonly request: AldoKeptRequest | null;
      readonly needs: AldoNeedsPlan | null;
      readonly checkoutSession: string | null;
      /** Back from Checkout: Stripe may take a moment to confirm the plan. */
      readonly returning: boolean;
    };

/**
 * What to do on load, from the way back (`returning`, the address's) and what
 * Aldo keeps (`kept`, null when it couldn't say).
 */
export function keptStep(
  checkoutReturn: AldoCheckoutReturn | null,
  kept: AldoKept | null,
): AldoKeptStep {
  // Only a paid Checkout comes back with its session: one without (canceled, or an address typed in) shows the picker again.
  const returning = checkoutReturn?.checkoutSession ? checkoutReturn : null;
  const pending = kept?.pending ?? null;
  if (!pending) {
    // Aldo couldn't say: the way back still asks, and Aldo answers whether there's one to send.
    return returning && !kept
      ? {
          kind: "resume",
          requestId: returning.requestId,
          request: null,
          needs: null,
          checkoutSession: returning.checkoutSession,
          returning: true,
        }
      : { kind: "nothing" };
  }
  if (kept?.needsPlan && !returning)
    return { kind: "pick", request: pending, needs: kept.needsPlan };
  // The one kept is what's sent, the latest the user sent, whichever the way back named.
  return {
    kind: "resume",
    requestId: pending.id,
    request: pending,
    needs: kept?.needsPlan ?? null,
    checkoutSession: returning?.checkoutSession ?? null,
    returning: returning !== null,
  };
}

/** A turn Aldo answered a resume with: as chat's, with what it sent. */
export interface AldoResumedTurn {
  readonly sessionId: string;
  readonly reply: string;
  readonly calls: ReadonlyArray<{
    readonly callId: string;
    readonly name: string;
    readonly arguments: Record<string, unknown>;
    readonly outcome: unknown;
  }>;
}

/** What came of asking Aldo to send the kept request. */
export type AldoResumed =
  /** Sent, as the user's message: Aldo's reply, and the plan it went on. */
  | {
      readonly kind: "sent";
      readonly turn: AldoResumedTurn;
      readonly text: string;
      readonly plan: string | null;
    }
  /** Sent already (another tab), or not kept any more: nothing went. */
  | { readonly kind: "gone" }
  /** Still no plan: the picker again. */
  | { readonly kind: "needsPlan"; readonly needs: AldoNeedsPlan }
  /** Refused for what a plan doesn't fix (a payment, credits): the words go back to the user. */
  | { readonly kind: "refused"; readonly message: string }
  /** It didn't get an answer: whether it went, the conversation says. */
  | { readonly kind: "failed"; readonly message: string };

/** Reads a resume's answer: its body when it came back 2xx, or what it failed with. */
export function resumedOf(
  outcome:
    | { readonly ok: true; readonly body: unknown }
    | {
        readonly ok: false;
        readonly status: number;
        readonly message: string;
        readonly body: unknown;
      },
): AldoResumed {
  if (!outcome.ok) {
    if (outcome.status === 402) {
      const needs = needsPlanOf(outcome.body);
      return needs ? { kind: "needsPlan", needs } : { kind: "refused", message: outcome.message };
    }
    return { kind: "failed", message: outcome.message };
  }
  const body = outcome.body;
  if (!isRecord(body) || !("resumed" in body)) {
    return { kind: "failed", message: "Aldo didn't say whether your request went." };
  }
  const resumed = body.resumed;
  if (!isRecord(resumed)) return { kind: "gone" };
  if (typeof body.reply !== "string" || typeof body.sessionId !== "string") {
    return { kind: "failed", message: "Aldo didn't say whether your request went." };
  }
  return {
    kind: "sent",
    turn: {
      sessionId: body.sessionId,
      reply: body.reply,
      calls: Array.isArray(body.calls) ? body.calls : [],
    },
    text: typeof resumed.text === "string" ? resumed.text : "",
    plan: typeof resumed.plan === "string" && resumed.plan ? resumed.plan : null,
  };
}

/** Whether the conversation has the user saying `text` (Aldo's copy names images after the words). */
export function saidAlready(
  messages: ReadonlyArray<{ readonly role: string; readonly text: string }>,
  text: string,
): boolean {
  const words = text.trim();
  return (
    words !== "" &&
    messages.some((m) => m.role === "user" && withoutImageNotes(m.text).text.trim() === words)
  );
}

/** Back from Checkout, Stripe can take a moment to confirm the plan: how long before asking again, or null to stop. */
export function confirmAgainIn(attempt: number): number | null {
  const waits = [1_500, 2_000, 3_000, 4_000, 5_000, 6_000];
  return attempt < waits.length ? waits[attempt]! : null;
}

/** What a plan includes, in Aldo's words, or (from an Aldo that didn't say) its credits and agents at once. */
export function pickerLines(plan: AldoPickerPlan): readonly string[] {
  if (plan.lines.length > 0) return plan.lines;
  return [
    `${Math.round(plan.credits).toLocaleString("en-US")} credits a month`,
    plan.concurrent === 1 ? "1 agent at once" : `${plan.concurrent} agents at once`,
  ];
}

/** The limit extra usage gets when it's turned on at Checkout, where Aldo's Checkout offers the choice (billing.extraUsage); else null. */
export function extraUsageOffer(
  billing: { readonly extraUsage?: unknown } | null | undefined,
): number | null {
  const offer = billing?.extraUsage;
  return isRecord(offer) && isCount(offer.limitCents) && offer.limitCents > 0
    ? offer.limitCents
    : null;
}

/** The extra usage choice's words, at its limit. */
export function extraUsageLabel(limitCents: number): {
  readonly label: string;
  readonly hint: string;
} {
  return {
    label: "Turn on extra usage",
    hint: `Past the plan’s credits, agents keep going as usual, billed up to ${formatPlanPrice(limitCents)} a month. Off, nothing more is billed. You can change it any time on the Usage page.`,
  };
}
