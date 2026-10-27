// What happened to the user's agents, where it happened in Aldo's conversation
// (feed.logic.ts): quiet lines on Aldo's side, the way an assistant shows the
// steps it took. What finished and shipped between two things said is one
// line ("3 shipped · 2 finished"), which opens to a line each, grouped (each
// a tap from its thread or pull request); just one is its line. A thread
// that's going is its live card (AldoLiveCard.tsx), where it started or where
// Aldo last acted on it. What else Aldo did, and what the user decided from a
// card this visit, are a line each; a plan stays its card (AldoPlanCard.tsx),
// including what it started with.

import { CheckIcon, ChevronDownIcon, LayersIcon, RepeatIcon } from "lucide-react";
import { useContext, useState, type ReactNode } from "react";

import { PullRequestGlyph } from "../components/pullRequest/pullRequestIcons";
import { cn } from "~/lib/utils";
import { AldoOpenContext, AldoThreadCard } from "./AldoLiveCard";
import { AldoPaymentLine } from "./AldoPaymentCard";
import { AldoPlanCard } from "./AldoPlanCard";
import { AldoFrame } from "./AldoFrame";
import { useAldoArrive } from "./arrive";
import { aldoCanMorph } from "./morph";
import { ACTION_LABELS } from "./assistant.logic";
import { FOCUS } from "./surface";
import {
  digestOf,
  isQuietEvent,
  shippedStatus,
  type AldoDigest,
  type AldoFeedEvent,
} from "./feed.logic";

export function AldoFeedRun(props: { readonly events: ReadonlyArray<AldoFeedEvent> }) {
  const quiet = props.events.filter(isQuietEvent);
  return (
    <div className="flex flex-col gap-2">
      {props.events.map((event) =>
        !isQuietEvent(event) ? (
          <EventLine key={event.key} event={event} />
        ) : event !== quiet[0] ? null : quiet.length === 1 ? (
          <QuietRows key={event.key} digest={digestOf(quiet)} />
        ) : (
          <Digest key={event.key} digest={digestOf(quiet)} />
        ),
      )}
    </div>
  );
}

/** What finished and shipped between two things said: one line, opening to a line each. */
function Digest(props: { readonly digest: AldoDigest }) {
  const [open, setOpen] = useState(false);
  const arrive = useAldoArrive();
  return (
    <div {...arrive} className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        className={cn(
          FOCUS,
          "flex max-w-[94%] items-center gap-2.5 self-start rounded-md text-left text-[14px] text-muted-foreground leading-5 hover:text-foreground",
        )}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center">
          <LayersIcon className="size-4" strokeWidth={1.75} />
        </span>
        <span className="min-w-0 truncate">{props.digest.label}</span>
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 transition-transform motion-reduce:transition-none",
            open && "rotate-180",
          )}
          strokeWidth={1.75}
        />
      </button>
      {open ? <QuietRows digest={props.digest} grouped /> : null}
    </div>
  );
}

/** What shipped, what finished and each routine's runs, a line each: under a heading each when `grouped`. */
function QuietRows(props: { readonly digest: AldoDigest; readonly grouped?: boolean }) {
  const open = useContext(AldoOpenContext);
  const arrive = useAldoArrive();
  const { shipped, finished, routines } = props.digest;
  const groups: ReadonlyArray<readonly [string, ReadonlyArray<ReactNode>]> = [
    [
      "Shipped",
      shipped.map((e) => (
        <Row
          key={e.key}
          icon={<PullRequestGlyph.merged className="size-4 text-success-foreground" />}
          verb="Shipped"
          title={e.pullRequest.title}
          trailing={shippedStatus(e)}
          href={e.pullRequest.url}
        />
      )),
    ],
    [
      "Finished",
      finished.map((e) => (
        <Row
          key={e.key}
          icon={<CheckIcon className="size-4 text-success-foreground" strokeWidth={2.25} />}
          verb="Finished"
          title={e.conversation.title}
          trailing={timeOf(e.at)}
          onClick={open ? (from) => open(e.conversation.thread, from) : undefined}
        />
      )),
    ],
    [
      "Routines",
      routines.map((r) => {
        const last = r.runs.at(-1)!;
        return (
          <Row
            key={r.id}
            icon={<RepeatIcon className="size-4" strokeWidth={1.75} />}
            verb="Ran"
            title={r.title}
            trailing={
              r.runs.length > 1 ? `${r.runs.length} runs · ${timeOf(last.at)}` : timeOf(last.at)
            }
            onClick={open ? (from) => open(last.conversation.thread, from) : undefined}
          />
        );
      }),
    ],
  ];
  return (
    <div
      {...(props.grouped ? {} : arrive)}
      className={cn("flex flex-col", props.grouped && "gap-2")}
    >
      {groups.map(([heading, rows]) =>
        rows.length === 0 ? null : (
          <div key={heading} className="flex flex-col">
            {props.grouped ? (
              <h4 className="ps-7.5 pb-0.5 font-medium text-[12px] text-muted-foreground/80 leading-[18px]">
                {heading}
              </h4>
            ) : null}
            {rows}
          </div>
        ),
      )}
    </div>
  );
}

/** One thing that finished or shipped: what it is, then where it stands or when. */
function Row(props: {
  readonly icon: ReactNode;
  /** What happened, for a screen reader: the icon says it on screen. */
  readonly verb: string;
  readonly title: string;
  readonly trailing: string;
  readonly href?: string;
  readonly onClick?: ((from: HTMLElement) => void) | undefined;
}) {
  const className = cn(
    FOCUS,
    "group flex min-h-10 w-full max-w-[94%] items-center gap-2.5 self-start rounded-md text-left text-[14px] text-muted-foreground leading-5 sm:min-h-8",
  );
  const body = (
    <>
      <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center">
        {props.icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground/85 group-hover:underline group-hover:decoration-foreground/30 group-hover:underline-offset-4">
        <span className="sr-only">{props.verb}: </span>
        {props.title}
      </span>
      <span className="shrink-0 text-[12px] tabular-nums">{props.trailing}</span>
    </>
  );
  if (props.href)
    return (
      <a href={props.href} target="_blank" rel="noreferrer" className={className}>
        {body}
      </a>
    );
  return props.onClick ? (
    <button
      type="button"
      className={className}
      onClick={(event) => props.onClick?.(event.currentTarget)}
    >
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** When it happened: its time today, with its day before. */
function timeOf(iso: string): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return at.toDateString() === new Date().toDateString()
    ? time
    : `${at.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
}

/** A line on Aldo's side: what it's about at the start, then what happened. */
function Line(props: {
  readonly icon: ReactNode;
  readonly children: ReactNode;
  /** Opens what it's about, growing out of the line. */
  readonly onClick?: ((from: HTMLElement) => void) | undefined;
  readonly receipt?: string;
}) {
  const arrived = useAldoArrive();
  // A receipt grows out of the card it was (AldoUpNext.tsx), where the browser can morph.
  const arrive = props.receipt && aldoCanMorph() ? {} : arrived;
  const body = (
    <>
      <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center">
        {props.icon}
      </span>
      <span className="min-w-0 flex-1">
        {/* What was decided says all of what happened; the rest are a line each. */}
        <span className={props.receipt ? "block break-words" : "block truncate"}>
          {props.children}
        </span>
      </span>
    </>
  );
  const className =
    "flex w-full max-w-[94%] items-start gap-2.5 self-start text-left text-[14px] text-muted-foreground leading-5";
  return props.onClick ? (
    <button
      type="button"
      {...arrive}
      className={cn(className, FOCUS, "group rounded-md")}
      onClick={(event) => props.onClick?.(event.currentTarget)}
      {...(props.receipt ? { "data-aldo-receipt": props.receipt } : {})}
    >
      {body}
    </button>
  ) : (
    <div
      {...arrive}
      className={className}
      {...(props.receipt ? { "data-aldo-receipt": props.receipt } : {})}
    >
      {body}
    </div>
  );
}

function EventLine(props: {
  readonly event: Exclude<AldoFeedEvent, { readonly kind: "finished" | "shipped" }>;
}) {
  const open = useContext(AldoOpenContext);
  const { event } = props;
  switch (event.kind) {
    case "thread":
      return <AldoThreadCard target={event.conversation.thread} label="Thread" fallback={null} />;
    case "plan":
      return <AldoPlanCard plan={event.plan} still={event.plan.status === "started"} />;
    case "payment":
      return <AldoPaymentLine payment={event.payment} />;
    case "decided": {
      // What was decided opens the thread it was decided for.
      const thread = event.thread;
      return (
        <Line
          icon={
            <span className="flex size-4 items-center justify-center rounded-full bg-foreground text-background">
              <CheckIcon className="size-2.5" strokeWidth={3} />
            </span>
          }
          receipt={event.key.slice("decided:".length)}
          onClick={thread && open ? (from) => open(thread, from) : undefined}
        >
          <span className="text-foreground/85">{event.text}</span>
        </Line>
      );
    }
    case "action": {
      const a = event.action;
      const label = ACTION_LABELS[a.tool] ?? a.tool.replace(/_/g, " ");
      const thread = a.thread;
      const line = (
        <Line
          icon={<AldoFrame size={14} />}
          onClick={thread && open ? (from) => open(thread, from) : undefined}
        >
          {label}
          {a.title ? <span className="text-foreground/85"> · {a.title}</span> : null}
        </Line>
      );
      return event.live && thread ? (
        <AldoThreadCard target={thread} label={label} fallback={line} />
      ) : (
        line
      );
    }
  }
}
