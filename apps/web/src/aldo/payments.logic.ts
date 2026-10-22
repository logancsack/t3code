// Payments an agent asked for from the user's Link wallet (homeApi.ts
// AldoPayment): which wait on the user, and what each says as it stands,
// from asking to paid. The user approves or declines in Link, never in
// Aldo; approved, the agent types the one-time card into the checkout.
// Pure, so it's tested on its own.

import { type AldoHome, type AldoPayment } from "./homeApi";
import { clockTime } from "./notNow.logic";

/** Asked of the user in Link, waiting on their approval. */
const ASKING = new Set(["created", "pending_approval"]);

/** Waiting on the user in Link: to approve or decline it while it still can be, or to do what Link needs first. */
export function paymentWaits(payment: AldoPayment, now: number): boolean {
  if (payment.status === "requires_action") return payment.approvalUrl !== null;
  if (!ASKING.has(payment.status)) return false;
  return payment.expiresAt === null || Date.parse(payment.expiresAt) > now;
}

/** The payments waiting on the user, the one that stops waiting soonest first. */
export function waitingPayments(
  home: Pick<AldoHome, "payments">,
  now: number,
): ReadonlyArray<AldoPayment> {
  const until = (p: AldoPayment) => (p.expiresAt ? Date.parse(p.expiresAt) : Infinity);
  return (home.payments ?? [])
    .filter((p) => paymentWaits(p, now))
    .toSorted((a, b) => until(a) - until(b) || a.createdAt.localeCompare(b.createdAt));
}

/** The payments that went on from waiting on the user (or never got as far): how each went, in the conversation. */
export function settledPayments(
  home: Pick<AldoHome, "payments">,
  now: number,
): ReadonlyArray<AldoPayment> {
  return (home.payments ?? []).filter((p) => !paymentWaits(p, now));
}

export type AldoPaymentTone = "waiting" | "going" | "done" | "stopped";

/** What a payment says as it stands: a headline, a line under it, and how it reads at a glance. */
export interface AldoPaymentWords {
  readonly headline: string;
  readonly line: string;
  readonly tone: AldoPaymentTone;
}

export function paymentWords(payment: AldoPayment, now: number): AldoPaymentWords {
  const what = `${payment.total} at ${payment.merchant}`;
  const card = payment.cardLast4 ? `Card ending ${payment.cardLast4}.` : "";
  switch (payment.status) {
    case "created":
    case "pending_approval":
      if (paymentWaits(payment, now))
        return {
          headline: `Pay ${what}?`,
          line: payment.expiresAt
            ? `Approve or decline it in Link by ${clockTime(new Date(payment.expiresAt))}.`
            : "Approve or decline it in Link.",
          tone: "waiting",
        };
      // Past its time, before Aldo next reads it from Link.
      return {
        headline: `Not approved in time: ${what}`,
        line: "Nothing was paid. The agent asks you before trying again.",
        tone: "stopped",
      };
    case "requires_action":
      // Without Link's page there's nothing to open here: the agent says what Link needs.
      return payment.approvalUrl
        ? {
            headline: `Link needs you before paying ${what}`,
            line: "Open Link to see what it needs. The agent carries on once it can.",
            tone: "waiting",
          }
        : {
            headline: `Link needs something before paying ${what}`,
            line: "The agent tells you in the conversation what it is.",
            tone: "going",
          };
    case "approved":
      return {
        headline: `Approved: ${what}`,
        line: `The agent is checking out on ${payment.site} with a card that works once, for up to ${payment.total}.`,
        tone: "going",
      };
    case "submitted":
      return {
        headline: `Paying ${what}`,
        line: `${payment.merchant} is charging the card. ${card}`.trim(),
        tone: "going",
      };
    case "succeeded":
      return {
        headline: `Paid ${what}`,
        line: `${card} The order's details are in the conversation.`.trim(),
        tone: "done",
      };
    case "failed":
      return {
        headline: `The charge didn't go through: ${what}`,
        line: "Nothing was paid. The agent asks you before trying another way.",
        tone: "stopped",
      };
    case "denied":
      return { headline: `Declined: ${what}`, line: "Nothing was paid.", tone: "stopped" };
    case "expired":
      return payment.cardLast4
        ? {
            headline: `The card expired unused: ${what}`,
            line: "Nothing was paid. The agent asks you before paying again.",
            tone: "stopped",
          }
        : {
            headline: `Not approved in time: ${what}`,
            line: "Nothing was paid. The agent asks you before trying again.",
            tone: "stopped",
          };
    case "canceled":
      return { headline: `Cancelled: ${what}`, line: "Nothing was paid.", tone: "stopped" };
    case "disconnected":
      return {
        headline: `Stopped: ${what}`,
        line: "Link was disconnected, so it can't go on. Connect Link again in Settings to pay.",
        tone: "stopped",
      };
    default:
      return { headline: `Paying ${what}`, line: "Under way in Link.", tone: "going" };
  }
}

/** What Aldo is told about a payment waiting on the user, on a call: that only they decide it, in Link. */
export function paymentBrief(payment: AldoPayment): string {
  const items = payment.items
    .map(
      (i) =>
        `${i.quantity && i.quantity > 1 ? `${i.quantity} × ` : ""}${i.name}${i.price ? ` (${i.price})` : ""}`,
    )
    .join(", ");
  return [
    `A payment of ${payment.total} at ${payment.merchant} (${payment.site}) waits on the user's approval in their Link wallet${payment.threadTitle ? `, asked by the thread "${payment.threadTitle}"` : ""}.`,
    items ? `It's for ${items}.` : "",
    `What the agent told Link: ${payment.context.slice(0, 400)}`,
    payment.expiresAt ? `Link stops waiting at ${clockTime(new Date(payment.expiresAt))}.` : "",
    "Nobody but the user can approve it, in Link: from its card or the notification. Never say it's approved.",
  ]
    .filter(Boolean)
    .join(" ");
}
