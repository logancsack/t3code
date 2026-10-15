// What happened to the user's agents, where it happened in Aldo's conversation
// (feed.logic.ts): what Aldo did and what shipped as quiet lines across the
// middle, the way a group chat says who joined; a thread Aldo started that's
// still going as its live card; threads that finished as one checklist from
// Aldo, each line a tap from a peek.

import { CheckIcon } from "lucide-react";
import { useContext } from "react";

import { PullRequestGlyph } from "../components/pullRequest/pullRequestIcons";
import { AldoPeekContext, AldoThreadCard } from "./AldoLiveCard";
import { ACTION_LABELS } from "./assistant.logic";
import type { AldoFeedEvent } from "./feed.logic";

export function AldoFeedRun(props: { readonly events: ReadonlyArray<AldoFeedEvent> }) {
  // Threads that finished one after another are one checklist; the rest are lines.
  const groups: Array<
    | { readonly kind: "line"; readonly event: AldoFeedEvent }
    | {
        readonly kind: "finished";
        readonly events: Array<Extract<AldoFeedEvent, { kind: "finished" }>>;
      }
  > = [];
  for (const event of props.events) {
    const last = groups.at(-1);
    if (event.kind === "finished" && last?.kind === "finished") last.events.push(event);
    else if (event.kind === "finished") groups.push({ kind: "finished", events: [event] });
    else groups.push({ kind: "line", event });
  }
  return (
    <>
      {groups.map((group) =>
        group.kind === "line" ? (
          <EventLine key={group.event.key} event={group.event} />
        ) : (
          <Finished key={group.events[0]!.key} events={group.events} />
        ),
      )}
    </>
  );
}

function EventLine(props: { readonly event: AldoFeedEvent }) {
  const peek = useContext(AldoPeekContext);
  const { event } = props;
  if (event.kind === "shipped") {
    const pr = event.pullRequest;
    return (
      <p className="flex items-center justify-center gap-1.5 px-6 text-center text-muted-foreground text-xs">
        <PullRequestGlyph.merged
          aria-hidden
          className="size-3.5 shrink-0 text-success-foreground"
        />
        <span className="truncate">
          Shipped{" "}
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            className="text-foreground/80 hover:underline"
          >
            #{pr.number} {pr.title}
          </a>
          {pr.stage === "deployed" ? " · deployed" : ""}
        </span>
      </p>
    );
  }
  if (event.kind !== "action") return null;
  const a = event.action;
  const label = ACTION_LABELS[a.tool] ?? a.tool.replace(/_/g, " ");
  const thread = a.thread;
  const line = (
    <p className="flex items-center justify-center gap-1 px-6 text-center text-muted-foreground text-xs">
      <span className="shrink-0">{label}</span>
      {a.title ? (
        <>
          <span aria-hidden>·</span>
          {thread && peek ? (
            <button
              type="button"
              className="truncate text-foreground/80 hover:underline"
              onClick={() => peek(thread)}
            >
              {a.title}
            </button>
          ) : (
            <span className="truncate text-foreground/80">{a.title}</span>
          )}
        </>
      ) : null}
    </p>
  );
  return event.live && thread ? (
    <AldoThreadCard target={thread} label={label} fallback={line} />
  ) : (
    line
  );
}

function Finished(props: {
  readonly events: ReadonlyArray<Extract<AldoFeedEvent, { kind: "finished" }>>;
}) {
  const peek = useContext(AldoPeekContext);
  return (
    <div
      data-aldo-arrive=""
      className="flex max-w-[88%] flex-col gap-1 self-start rounded-[22px] rounded-bl-md bg-card px-4 py-3 shadow-black/5 shadow-sm ring-1 ring-border/50 dark:bg-white/[0.06] dark:shadow-none dark:ring-0"
    >
      <p className="text-muted-foreground text-xs">
        {props.events.length === 1 ? "Finished" : `${props.events.length} finished`}
      </p>
      <ul className="flex flex-col gap-1">
        {props.events.map(({ key, conversation: c }) => (
          <li key={key}>
            <button
              type="button"
              className="flex w-full items-start gap-2 text-left text-[15px] leading-snug hover:opacity-80"
              disabled={!peek}
              onClick={() => peek?.(c.thread)}
            >
              <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-success-foreground" />
              <span className="min-w-0">
                <span className="font-medium">{c.title}</span>
                {c.summary ? <span className="text-muted-foreground"> → {c.summary}</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
