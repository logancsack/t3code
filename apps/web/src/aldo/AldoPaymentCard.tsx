// A payment an agent asked for from the user's Link wallet (payments.logic.ts),
// in Aldo's conversation. While it waits on them it's a card in Up next
// (AldoUpNext.tsx): what's being bought, from whom and for how much, as Link
// shows it, and "Approve in Link", which opens Link's own page, where they
// approve or decline it; Aldo never can. Once it goes on, it's a card where it
// came up (AldoFeed.tsx) saying how it stands, from approved to paid, and
// what's next; in simple mode's Needs you, the same card waiting
// (AldoPaymentWaiting). Never the card itself: only its last four digits.

import { ArrowUpRightIcon, CheckIcon, CreditCardIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { ThreadLink } from "./AldoHomeInbox";
import { Quoted } from "./AldoQuoted";
import { useAldoArrive } from "./arrive";
import { type AldoPayment } from "./homeApi";
import { paymentWords } from "./payments.logic";
import { FOCUS, INSET, PRIMARY, SURFACE } from "./surface";

/** What's being bought, line by line, the total, and what the agent told Link it's for. */
export function PaymentDetails(props: { readonly payment: AldoPayment }) {
  const p = props.payment;
  return (
    <div className={cn(INSET, "flex flex-col gap-2.5 text-sm")}>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[13px] tabular-nums">
        {p.items.map((item) => (
          <div key={`${item.name}:${item.quantity}:${item.price}`} className="contents">
            <dt className="min-w-0 break-words">
              {item.quantity && item.quantity > 1 ? `${item.quantity} × ` : ""}
              {item.name}
            </dt>
            <dd className="text-muted-foreground">{item.price ?? ""}</dd>
          </div>
        ))}
        <div className="contents font-medium">
          <dt>
            Total
            {p.test ? (
              <span className="ms-2 rounded-full bg-foreground/[0.07] px-1.5 py-px font-normal text-[11px] text-muted-foreground">
                Test, no charge
              </span>
            ) : null}
          </dt>
          <dd>{p.total}</dd>
        </div>
      </dl>
      <p className="text-[13px] text-muted-foreground leading-5">
        At {p.merchant}, on {p.site}
      </p>
      {p.context ? (
        <Quoted lines={3} className="text-[13px] text-foreground/80 leading-5">
          {p.context}
        </Quoted>
      ) : null}
    </div>
  );
}

/**
 * Link's page for it, where the user approves or declines. Opened, the card
 * says it's waiting on their answer there, and that it changes once they give
 * it (Aldo reads Link every minute).
 */
export function ApproveInLink(props: { readonly payment: AldoPayment; readonly now: number }) {
  const [opened, setOpened] = useState(false);
  const p = props.payment;
  if (!p.approvalUrl) return null;
  const words = paymentWords(p, props.now);
  const label = p.status === "requires_action" ? "Open Link" : "Approve in Link";
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] text-muted-foreground leading-5">
        {opened
          ? "Waiting for your answer in Link. This changes within a minute of it."
          : words.line}
      </p>
      <a
        href={p.approvalUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(PRIMARY, "w-full")}
        onClick={() => setOpened(true)}
      >
        {label}
        <ArrowUpRightIcon aria-hidden className="-me-1 size-4" strokeWidth={1.75} />
      </a>
    </div>
  );
}

/** A payment waiting on the user, as simple mode's Needs you lists it: what it's for, and Link's page for it. */
export function AldoPaymentWaiting(props: { readonly payment: AldoPayment; readonly now: number }) {
  const p = props.payment;
  const words = paymentWords(p, props.now);
  return (
    <li>
      <article
        aria-label={words.headline}
        data-aldo-payment={p.id}
        className={cn(SURFACE, "flex flex-col gap-3 p-4")}
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] text-foreground/60"
          >
            <CreditCardIcon className="size-3.5" strokeWidth={1.75} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="font-medium text-[14px] leading-5 tabular-nums">{words.headline}</p>
            {p.thread ? (
              <ThreadLink
                target={p.thread}
                className={cn(
                  FOCUS,
                  "flex items-center gap-1 self-start rounded-md text-[13px] text-muted-foreground hover:text-foreground",
                )}
              >
                {p.threadTitle ?? "Open the conversation"}
                <ArrowUpRightIcon aria-hidden className="size-3.5" strokeWidth={1.75} />
              </ThreadLink>
            ) : null}
          </div>
        </div>
        <PaymentDetails payment={p} />
        <ApproveInLink payment={p} now={props.now} />
      </article>
    </li>
  );
}

/** A payment that went on from waiting on the user: how it stands, and what's next, where it came up. */
export function AldoPaymentLine(props: { readonly payment: AldoPayment }) {
  const p = props.payment;
  // It waits no more (settledPayments): one Link asked of the user is past its time.
  const words = paymentWords(p, Number.POSITIVE_INFINITY);
  const arrive = useAldoArrive();
  const Icon =
    words.tone === "done" ? CheckIcon : words.tone === "stopped" ? XIcon : CreditCardIcon;
  return (
    <article
      {...arrive}
      aria-label={words.headline}
      data-aldo-payment={p.id}
      className={cn(SURFACE, "flex w-full max-w-[94%] items-start gap-3 self-start p-4")}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full",
          words.tone === "done"
            ? "bg-success/12 text-success-foreground"
            : "bg-foreground/[0.06] text-foreground/60",
        )}
      >
        <Icon className="size-3.5" strokeWidth={words.tone === "going" ? 1.75 : 2.5} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="font-medium text-[14px] leading-5 tabular-nums">{words.headline}</p>
        <p className="text-[13px] text-muted-foreground leading-5">
          {words.line}
          {p.test && words.tone !== "stopped" ? " A test: nothing was charged." : ""}
        </p>
        {p.thread ? (
          <ThreadLink
            target={p.thread}
            className={cn(
              FOCUS,
              "mt-1 flex items-center gap-1 self-start rounded-md text-[13px] font-medium text-foreground/80 hover:text-foreground",
            )}
          >
            {p.threadTitle ?? "Open the conversation"}
            <ArrowUpRightIcon aria-hidden className="size-3.5" strokeWidth={1.75} />
          </ThreadLink>
        ) : null}
      </div>
    </article>
  );
}
