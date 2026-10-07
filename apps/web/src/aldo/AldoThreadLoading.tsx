// A thread with nothing to show yet. Its messages load from its machine or
// Aldo's copy, and a thread Aldo is starting has none until its machine is up
// and the agent has its first message, which can take minutes. Rather than an
// empty page under a sidebar that says "Working", it shows the shape of the
// conversation and, for a start, how it stands (threadStart.ts): the step,
// how long it has taken, what happens next, and why when it waits or failed.

import { CheckIcon, CircleAlertIcon, ClockIcon, RotateCwIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Skeleton } from "../components/ui/skeleton";
import { Spinner } from "../components/ui/spinner";
import { cn } from "~/lib/utils";
import {
  ALDO_START_STEPS,
  formatAldoStartElapsed,
  type AldoThreadStartTone,
  type AldoThreadStartView,
} from "./threadStart.logic";

// Self-ticking, so only this span re-renders each second.
function Elapsed(props: { readonly since: string }) {
  const sinceMs = Date.parse(props.since);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (Number.isNaN(sinceMs)) return;
    const id = window.setInterval(() => setTick((tick) => tick + 1), 1_000);
    return () => window.clearInterval(id);
  }, [sinceMs]);
  if (Number.isNaN(sinceMs)) return null;
  return <>{formatAldoStartElapsed(Date.now() - sinceMs)}</>;
}

function ToneIcon(props: { readonly tone: AldoThreadStartTone; readonly className?: string }) {
  switch (props.tone) {
    case "progress":
      return <Spinner aria-hidden className={cn("text-primary", props.className)} />;
    case "waiting":
      return <ClockIcon aria-hidden className={cn("text-muted-foreground", props.className)} />;
    case "retrying":
      return (
        <RotateCwIcon aria-hidden className={cn("text-warning-foreground", props.className)} />
      );
    case "failed":
      return (
        <CircleAlertIcon
          aria-hidden
          className={cn("text-destructive-foreground", props.className)}
        />
      );
  }
}

function Steps(props: { readonly step: number; readonly tone: AldoThreadStartTone }) {
  return (
    <ol aria-label="Progress" className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {ALDO_START_STEPS.map((name, index) => {
        const state = index < props.step ? "done" : index === props.step ? "current" : "next";
        return (
          <li
            key={name}
            aria-current={state === "current" ? "step" : undefined}
            className="flex items-center gap-2"
          >
            {index > 0 ? (
              <span
                aria-hidden
                className={cn(
                  "h-px w-5 sm:w-8",
                  index <= props.step ? "bg-primary/50" : "bg-border",
                )}
              />
            ) : null}
            <span
              className={cn(
                "flex items-center gap-1.5",
                state === "current"
                  ? "font-medium text-foreground"
                  : state === "done"
                    ? "text-muted-foreground"
                    : "text-muted-foreground/60",
              )}
            >
              {state === "done" ? (
                <span className="flex size-3.5 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <CheckIcon aria-hidden className="size-2.5" />
                </span>
              ) : state === "current" ? (
                <ToneIcon tone={props.tone} className="size-3.5" />
              ) : (
                <span aria-hidden className="size-3.5 rounded-full border border-border" />
              )}
              {name}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function StartCard(props: {
  readonly start: AldoThreadStartView;
  readonly startedAt: string | null;
}) {
  const { start } = props;
  const failed = start.tone === "failed";
  return (
    <section
      className={cn(
        "rounded-xl border bg-card p-4 shadow-xs",
        failed ? "border-destructive/30" : "border-border",
      )}
    >
      <div className="flex items-start gap-3">
        <ToneIcon tone={start.tone} className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            {/* The words alone are the live region: the ticking time isn't announced. */}
            <h2 role="status" className="font-medium text-foreground text-sm">
              {start.title}
            </h2>
            {!failed && props.startedAt ? (
              <span aria-hidden className="shrink-0 font-mono text-muted-foreground text-xs">
                <Elapsed since={props.startedAt} />
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-muted-foreground text-sm">{start.body}</p>
          {start.reason ? (
            <p
              className={cn(
                "mt-2 rounded-md px-2.5 py-1.5 text-xs",
                failed
                  ? "bg-destructive/8 text-destructive-foreground"
                  : "bg-muted/60 text-muted-foreground",
              )}
            >
              {start.reason}
            </p>
          ) : null}
          {start.step !== null ? <Steps step={start.step} tone={start.tone} /> : null}
        </div>
      </div>
    </section>
  );
}

/** Skeletons a shade darker than the muted ones, to read against the thread's background. */
const SHADE = "bg-foreground/[0.07] dark:bg-foreground/[0.09]";

/** A message from the user, then the agent's reply, as they'll sit in the thread. */
function TurnSkeleton(props: { readonly reply?: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end">
        <Skeleton className={cn("h-14 w-[55%] max-w-md rounded-2xl", SHADE)} />
      </div>
      {props.reply === false ? null : (
        <div className="flex flex-col gap-2.5">
          <Skeleton className={cn("h-3.5 w-11/12", SHADE)} />
          <Skeleton className={cn("h-3.5 w-full", SHADE)} />
          <Skeleton className={cn("h-3.5 w-2/3", SHADE)} />
        </div>
      )}
    </div>
  );
}

export function AldoThreadLoading(props: {
  /** Aldo's start of the thread, when it's starting it. */
  readonly start: AldoThreadStartView | null;
  /** When the thread was asked for: what a start's time counts from. */
  readonly startedAt: string | null;
  /** What it says while the messages load and Aldo isn't starting it. */
  readonly label: string;
  /** Room left at the end for the composer, which sits over the thread. */
  readonly bottomInset: number;
}) {
  const { start } = props;
  return (
    <div
      className="h-full min-h-0 overflow-y-auto px-3 sm:px-5"
      data-aldo-thread-loading={start?.tone ?? "loading"}
    >
      <div
        className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-6 pt-6"
        style={{ paddingBottom: props.bottomInset + 24 }}
      >
        {start ? (
          <>
            {/* Its first message, on its way to the agent; nothing's on its way once it failed. */}
            {start.tone === "failed" ? null : <TurnSkeleton reply={false} />}
            <StartCard start={start} startedAt={props.startedAt} />
            {start.tone === "failed" ? null : (
              <div className="flex flex-col gap-2.5 opacity-60">
                <Skeleton className={cn("h-3.5 w-10/12", SHADE)} />
                <Skeleton className={cn("h-3.5 w-7/12", SHADE)} />
              </div>
            )}
          </>
        ) : (
          <>
            <TurnSkeleton />
            <TurnSkeleton />
            <p role="status" className="flex items-center gap-2 text-muted-foreground text-sm">
              <Spinner aria-hidden className="size-3.5" />
              {props.label}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
