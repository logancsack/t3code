// What happened to the user's agents, where it happened in Aldo's conversation
// (feed.logic.ts): quiet lines on Aldo's side, the way an assistant shows the
// steps it took. What finished (each a tap from a peek), what shipped, what
// Aldo did (a thread it started that's still going as its live card), and
// what the user decided from a card this visit.

import { CheckIcon } from "lucide-react";
import { useContext, type ReactNode } from "react";

import { PullRequestGlyph } from "../components/pullRequest/pullRequestIcons";
import { cn } from "~/lib/utils";
import { AldoPeekContext, AldoThreadCard } from "./AldoLiveCard";
import { AldoAvatar } from "./AldoPresence";
import { useAldoArrive } from "./arrive";
import { aldoCanMorph } from "./morph";
import { ACTION_LABELS } from "./assistant.logic";
import { FOCUS } from "./surface";
import type { AldoFeedEvent } from "./feed.logic";

export function AldoFeedRun(props: { readonly events: ReadonlyArray<AldoFeedEvent> }) {
  return (
    <div className="flex flex-col gap-2">
      {props.events.map((event) => (
        <EventLine key={event.key} event={event} />
      ))}
    </div>
  );
}

/** A line on Aldo's side: what it's about at the start, then what happened. */
function Line(props: {
  readonly icon: ReactNode;
  readonly children: ReactNode;
  readonly detail?: ReactNode;
  readonly onClick?: (() => void) | undefined;
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
        {props.detail ? (
          <span className="mt-0.5 line-clamp-2 block text-muted-foreground/80">{props.detail}</span>
        ) : null}
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
      onClick={props.onClick}
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

function EventLine(props: { readonly event: AldoFeedEvent }) {
  const peek = useContext(AldoPeekContext);
  const { event } = props;
  switch (event.kind) {
    case "finished": {
      const c = event.conversation;
      return (
        <Line
          icon={<CheckIcon className="size-4 text-success-foreground" strokeWidth={2.25} />}
          detail={c.summary}
          onClick={peek ? () => peek(c.thread) : undefined}
        >
          <span className="font-medium text-foreground group-hover:underline group-hover:decoration-foreground/30 group-hover:underline-offset-4">
            {c.title}
          </span>{" "}
          finished
        </Line>
      );
    }
    case "shipped": {
      const pr = event.pullRequest;
      return (
        <Line icon={<PullRequestGlyph.merged className="size-4 text-success-foreground" />}>
          Shipped{" "}
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            className="text-foreground/85 hover:underline hover:decoration-foreground/30 hover:underline-offset-4"
          >
            #{pr.number} {pr.title}
          </a>
          {pr.stage === "deployed" ? " · deployed" : ""}
        </Line>
      );
    }
    case "decided": {
      // What was decided opens a look at where it was decided.
      const thread = event.thread;
      return (
        <Line
          icon={
            <span className="flex size-4 items-center justify-center rounded-full bg-foreground text-background">
              <CheckIcon className="size-2.5" strokeWidth={3} />
            </span>
          }
          receipt={event.key.slice("decided:".length)}
          onClick={thread && peek ? () => peek(thread) : undefined}
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
          icon={<AldoAvatar size={14} />}
          onClick={thread && peek ? () => peek(thread) : undefined}
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
