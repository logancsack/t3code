// Goals: an outcome Aldo works toward for weeks, from a plan the user approves
// once. /goals lists them; /goals/$goalId is one goal on a page that answers,
// without opening a thread: is it on track (the measures), what needs me, who
// is working on it, what it has cost, and what happened (the log). The page
// only reads; what needs the user is answered where it waits (its thread).

import { Link } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { cn } from "~/lib/utils";
import { Section } from "./AldoHomeBoard";
import { ThreadLink } from "./AldoHomeInbox";
import { AldoPlacePage } from "./AldoPlaces";
import { aldoEnvironmentIdFor } from "./directory";
import { refreshAldoGoals, useAldoGoals, useAldoGoalsWatch } from "./goals";
import {
  goalConversationState,
  goalDay,
  goalHeadline,
  goalLimits,
  goalLogByDay,
  goalLogKind,
  goalLogWriter,
  goalMeasureNote,
  goalNeedsYou,
  goalOutcome,
  goalPart,
  goalProgress,
  goalReading,
  goalSpent,
  goalStatus,
  goalWaitingKeyed,
  goalWaitingKind,
  mergedGoalLog,
  refreshedGoalLog,
  type GoalTone,
} from "./goals.logic";
import {
  fetchAldoGoal,
  type AldoGoal,
  type AldoGoalLogLine,
  type AldoGoalMeasure,
} from "./goalsApi";
import { relativeTime } from "./home.logic";
import { setAldoSimplePlace, useAldoSimple } from "./simpleMode";
import { FOCUS, INSET } from "./surface";

const TONE: Record<GoalTone, "outline" | "info" | "warning" | "success" | "error"> = {
  quiet: "outline",
  working: "info",
  yours: "warning",
  good: "success",
  bad: "error",
};

/** The list's frame, the one Routines uses: rows on a faint card with a hairline edge. */
const LIST = "rounded-xl border border-border/60 bg-card/30 p-1.5";
const ROW = "rounded-lg px-2.5 py-2";

function StatusBadge(props: { readonly label: string; readonly tone: GoalTone }) {
  return (
    <Badge variant={TONE[props.tone]} size="sm" className="shrink-0">
      {props.label}
    </Badge>
  );
}

/**
 * How far a measure has come from its start to its target; drawn only when all
 * three are numbers. Quiet for a goal that's paused or has ended: nothing is moving.
 */
function Progress(props: {
  readonly measure: AldoGoalMeasure;
  readonly quiet?: boolean;
  readonly className?: string;
}) {
  const progress = goalProgress(props.measure);
  if (progress === null) return null;
  const percent = Math.round(progress * 100);
  return (
    <span
      role="progressbar"
      aria-label={`${props.measure.name}: ${percent}% of the way to its target`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn("block h-1 overflow-hidden rounded-full bg-foreground/10", props.className)}
    >
      <span
        className={cn(
          "block h-full rounded-full",
          props.quiet ? "bg-muted-foreground/60" : "bg-primary",
        )}
        style={{ width: `${percent}%` }}
      />
    </span>
  );
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function Failed(props: { readonly message: string; readonly onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p role="alert" className="min-w-0 text-destructive-foreground text-sm">
        Couldn’t load this. {props.message}
      </p>
      <Button size="sm" variant="outline" onClick={props.onRetry}>
        Try again
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// /goals

function GoalRow(props: { readonly goal: AldoGoal }) {
  const { goal } = props;
  const status = goalStatus(goal);
  const outcome = goalOutcome(goal);
  const headline = goalHeadline(goal);
  const needs = goalNeedsYou(goal);
  return (
    <li>
      <Link
        to="/goals/$goalId"
        params={{ goalId: goal.id }}
        className={cn(ROW, FOCUS, "group flex items-start gap-3 hover:bg-accent/40")}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 font-medium text-sm [overflow-wrap:anywhere]">
              {goal.title}
            </span>
            <StatusBadge {...status} />
          </span>
          {outcome ? (
            <span className="line-clamp-2 text-muted-foreground text-xs">{outcome}</span>
          ) : null}
          {headline ? (
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
              <Progress
                measure={headline}
                quiet={goal.status === "ended" || goal.status === "paused"}
                className="w-24 shrink-0"
              />
              <span className="tabular-nums">{goalReading(headline)}</span>
              <span className="min-w-0 text-muted-foreground">{headline.name}</span>
            </span>
          ) : null}
          {needs ? (
            <span className="mt-0.5 flex items-center gap-1.5 text-warning-foreground text-xs">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" />
              {needs}
            </span>
          ) : null}
        </span>
        <ChevronRightIcon
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground"
        />
      </Link>
    </li>
  );
}

/** /goals: each goal with where it stands, its headline measure and whether anything needs the user. */
export function AldoGoalsPage() {
  const { goals, error } = useAldoGoals();
  const look = useCallback(() => void refreshAldoGoals(), []);
  useAldoGoalsWatch(look);
  const live = goals?.filter((goal) => goal.status !== "ended") ?? [];
  const ended = goals?.filter((goal) => goal.status === "ended") ?? [];
  return (
    <AldoPlacePage
      title="Goals"
      about="An outcome Aldo works toward for weeks, from a plan you approve once. Each one shows its measures, what needs you and what it has cost."
    >
      {goals === undefined && error ? (
        <Failed message={error} onRetry={look} />
      ) : goals === undefined ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      ) : goals === null ? (
        <p className="text-muted-foreground text-sm">This Aldo doesn’t have goals yet.</p>
      ) : goals.length === 0 ? (
        <p className="rounded-xl border border-border/60 border-dashed px-4 py-3 text-muted-foreground text-sm">
          No goals yet.
        </p>
      ) : (
        <>
          {live.length > 0 ? (
            <ul className={LIST}>
              {live.map((goal) => (
                <GoalRow key={goal.id} goal={goal} />
              ))}
            </ul>
          ) : null}
          {ended.length > 0 ? (
            <Section title="Ended" count={ended.length}>
              <ul className={LIST}>
                {ended.map((goal) => (
                  <GoalRow key={goal.id} goal={goal} />
                ))}
              </ul>
            </Section>
          ) : null}
        </>
      )}
    </AldoPlacePage>
  );
}

// ---------------------------------------------------------------------------
// /goals/$goalId

type GoalRead =
  | { readonly kind: "loading" }
  | { readonly kind: "gone" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "ready"; readonly goal: AldoGoal };

/** What the user wrote, exactly; a long one opens in place. */
function Words(props: { readonly words: string }) {
  const [open, setOpen] = useState(false);
  const long = props.words.length > 280 || props.words.split("\n").length > 4;
  return (
    <div className={cn(INSET, "flex flex-col items-start gap-2")}>
      <p
        className={cn(
          "w-full whitespace-pre-wrap text-sm [overflow-wrap:anywhere]",
          long && !open && "line-clamp-4",
        )}
      >
        {props.words}
      </p>
      {long ? (
        <button
          type="button"
          aria-expanded={open}
          className={cn(FOCUS, "rounded text-muted-foreground text-xs hover:text-foreground")}
          onClick={() => setOpen((was) => !was)}
        >
          {open ? "Show less" : "Show all of it"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Under the outcome: since when it's paused or when it ended, and where its plan stands. A version
 * that waits on the user is said in ink; the rest is quiet.
 */
function PlanLine(props: { readonly goal: AldoGoal }) {
  const { plan, proposed, status } = props.goal;
  const facts: string[] = [];
  if (status === "ended" && props.goal.endedAt) facts.push(`Ended ${goalDay(props.goal.endedAt)}.`);
  if (status === "paused" && props.goal.pausedAt)
    facts.push(`Paused since ${goalDay(props.goal.pausedAt)}.`);
  if (plan) facts.push(`Plan version ${plan.version}, approved ${goalDay(plan.approvedAt)}.`);
  else if (status === "researching") facts.push("No plan yet: Aldo is researching first.");
  const waits =
    proposed && (proposed.approvalId || status === "awaiting_approval") ? proposed : null;
  if (proposed && !waits) facts.push(`Version ${proposed.version} is being written.`);
  if (!facts.length && !waits) return null;
  return (
    <p className="text-muted-foreground text-xs">
      {facts.join(" ")}
      {waits ? (
        <span className="text-foreground">
          {facts.length ? " " : ""}
          Version {waits.version} is waiting for your approval.
        </span>
      ) : null}
    </p>
  );
}

/** Opens the thread where something waits: the button Home's "Needs you" uses. */
function Open(props: {
  readonly threadId: string;
  readonly t3ThreadId: string;
  readonly label: string;
}) {
  return (
    <Button
      variant="outline"
      size="compact"
      className="shrink-0"
      render={
        <ThreadLink
          target={{
            environmentId: aldoEnvironmentIdFor(props.threadId),
            threadId: props.t3ThreadId,
          }}
          label={props.label}
        />
      }
    >
      Open
    </Button>
  );
}

function LogLines(props: {
  readonly goal: AldoGoal;
  readonly lines: ReadonlyArray<AldoGoalLogLine>;
  readonly now: number;
}) {
  return (
    <div className="flex flex-col gap-4">
      {goalLogByDay(props.lines, props.now).map((day) => (
        <div key={day.day} className="flex flex-col gap-1.5">
          <h3 className="px-0.5 text-muted-foreground text-xs">{day.day}</h3>
          <ul className={LIST}>
            {day.lines.map((line) => (
              <li key={line.id} className={cn(ROW, "flex flex-col gap-0.5")}>
                <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{line.text}</p>
                <p className="text-muted-foreground text-xs">
                  {goalLogKind(line)} · {goalLogWriter(line, props.goal)} ·{" "}
                  <time dateTime={line.at}>
                    {new Date(line.at).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                </p>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** The log opens on what happened lately; older lines come a longer page at a time. */
const LOG_FIRST = 20;
const LOG_OLDER = 50;

/** /goals/$goalId: one goal. */
export function AldoGoalPage(props: { readonly goalId: string }) {
  const { goalId } = props;
  const now = useNow();
  const [read, setRead] = useState<GoalRead>({ kind: "loading" });
  /** The log lines read so far, newest first: the newest page, and any older ones asked for. */
  const [lines, setLines] = useState<ReadonlyArray<AldoGoalLogLine>>([]);
  // The same lines for the reads' answers, which come after the render that asked.
  const logRead = useRef<ReadonlyArray<AldoGoalLogLine>>([]);
  const show = useCallback((next: ReadonlyArray<AldoGoalLogLine>) => {
    logRead.current = next;
    setLines(next);
  }, []);
  const [more, setMore] = useState(false);
  const [older, setOlder] = useState<"idle" | "loading" | { readonly error: string }>("idle");
  // Answers that come after the page is gone are dropped. Another goal is another page (the route keys it).
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const olderAsked = useRef(false);
  // How many times the log started over: an older page asked for before then belongs to the list that's gone.
  const restarts = useRef(0);

  const look = useCallback(() => {
    fetchAldoGoal(goalId, { limit: LOG_FIRST }).then(
      (answer) => {
        if (!alive.current) return;
        if (!answer) return setRead({ kind: "gone" });
        setRead({ kind: "ready", goal: answer.goal });
        const fresh = refreshedGoalLog(logRead.current, answer.log, answer.more);
        show(fresh.lines);
        // A log that starts over has only its newest page again.
        if (fresh.restarted) {
          olderAsked.current = false;
          restarts.current += 1;
        }
        // Once older pages were asked for, whether more remain is theirs to say.
        if (!olderAsked.current) setMore(answer.more);
      },
      (cause: unknown) => {
        if (!alive.current) return;
        // A look that fails while the goal is on screen leaves it there; the next one tries again.
        setRead((was) =>
          was.kind === "ready"
            ? was
            : { kind: "failed", message: cause instanceof Error ? cause.message : String(cause) },
        );
      },
    );
  }, [goalId, show]);
  useAldoGoalsWatch(look);

  const showOlder = () => {
    const oldest = lines.at(-1);
    if (!oldest || older === "loading") return;
    setOlder("loading");
    const asked = restarts.current;
    fetchAldoGoal(goalId, { before: oldest.id, limit: LOG_OLDER }).then(
      (answer) => {
        if (!alive.current) return;
        if (asked !== restarts.current) return setOlder("idle");
        olderAsked.current = true;
        show(mergedGoalLog(logRead.current, answer?.log ?? []));
        setMore(answer?.more ?? false);
        setOlder("idle");
      },
      (cause: unknown) => {
        if (!alive.current) return;
        setOlder({ error: cause instanceof Error ? cause.message : String(cause) });
      },
    );
  };

  const goal = read.kind === "ready" ? read.goal : null;
  const page = (children: ReactNode) => (
    <AldoPlacePage title={goal?.title.trim() || "Goal"} parent={{ label: "Goals", to: "/goals" }}>
      {children}
    </AldoPlacePage>
  );

  if (read.kind === "loading") {
    return page(
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>,
    );
  }
  if (read.kind === "gone") {
    return page(
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm">This goal isn’t here. It may belong to another account.</p>
        <Button size="sm" variant="outline" render={<Link to="/goals" />}>
          Back to Goals
        </Button>
      </div>,
    );
  }
  if (read.kind === "failed") return page(<Failed message={read.message} onRetry={look} />);

  const { goal: shown } = read;
  const status = goalStatus(shown);
  const outcome = goalOutcome(shown);
  const limits = goalLimits(shown.spending.limits);
  const working = shown.conversations.filter((c) => !c.ended);
  const finished = shown.conversations.filter((c) => c.ended);
  const lead = working.find((c) => c.role === "lead");
  const over = shown.status === "ended";
  return page(
    <>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <StatusBadge {...status} />
          {outcome ? <p className="min-w-0 text-base [overflow-wrap:anywhere]">{outcome}</p> : null}
        </div>
        <PlanLine goal={shown} />
        <div className="flex flex-col gap-1.5">
          <h2 className="px-0.5 text-muted-foreground text-xs">What you asked for</h2>
          <Words words={shown.words} />
        </div>
      </header>

      {shown.waiting.length > 0 ? (
        <Section title="Needs you" count={shown.waiting.length}>
          <ul className={LIST}>
            {goalWaitingKeyed(shown.waiting).map(({ key, waiting }) => (
              <li key={key} className={cn(ROW, "flex items-start gap-2.5")}>
                <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-warning" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm [overflow-wrap:anywhere]">{waiting.title}</p>
                  <p className="text-muted-foreground text-xs">{goalWaitingKind(waiting)}</p>
                </div>
                {waiting.threadId && waiting.t3ThreadId ? (
                  <Open
                    threadId={waiting.threadId}
                    t3ThreadId={waiting.t3ThreadId}
                    label={`Open the thread: ${waiting.title}`}
                  />
                ) : waiting.kind === "approval" ? (
                  // A card that belongs to no thread of the goal is answered where every card is: Home.
                  <Button
                    variant="outline"
                    size="compact"
                    className="shrink-0"
                    render={
                      <Link
                        to="/"
                        aria-label={`Answer on Home: ${waiting.title}`}
                        // Simple mode keeps the place it was on (the Library, say): the card is under Needs you.
                        onClick={() => {
                          if (useAldoSimple.getState().on) setAldoSimplePlace("needs");
                        }}
                      />
                    }
                  >
                    Open Home
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {lead && shown.waiting.some((waiting) => waiting.kind === "step") ? (
            <p className="px-0.5 text-muted-foreground text-xs">
              When you’ve done a step,{" "}
              <ThreadLink
                target={{
                  environmentId: aldoEnvironmentIdFor(lead.threadId),
                  threadId: lead.t3ThreadId,
                }}
                className={cn(FOCUS, "rounded underline underline-offset-2 hover:text-foreground")}
              >
                tell the lead
              </ThreadLink>
              .
            </p>
          ) : null}
        </Section>
      ) : null}

      <Section
        title="Measures"
        {...(shown.measures.length ? { count: shown.measures.length } : {})}
      >
        {shown.measures.length === 0 ? (
          <p className="px-0.5 text-muted-foreground text-sm">
            {shown.plan || shown.proposed
              ? "The plan names no measures."
              : "The plan sets these. There’s no plan yet."}
          </p>
        ) : (
          <ul className={LIST}>
            {shown.measures.map((measure) => (
              <li key={measure.key} className={cn(ROW, "flex flex-col gap-1.5")}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <p className="min-w-0 text-sm">
                    <span className="font-medium">{measure.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {" "}
                      · {measure.kind === "early" ? "an early sign" : "a result"}
                    </span>
                  </p>
                  <p className="text-sm tabular-nums">{goalReading(measure)}</p>
                </div>
                <Progress measure={measure} quiet={over || shown.status === "paused"} />
                <p className="text-muted-foreground text-xs">
                  {goalMeasureNote(measure, now, relativeTime)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Who’s working on it" {...(working.length ? { count: working.length } : {})}>
        {shown.conversations.length === 0 ? (
          <p className="px-0.5 text-muted-foreground text-sm">
            {over ? "Nobody now: the goal has ended." : "Nobody yet."}
          </p>
        ) : (
          <ul className={LIST}>
            {[...working, ...finished].map((conversation) => {
              const state = goalConversationState(conversation);
              return (
                <li key={`${conversation.threadId}/${conversation.t3ThreadId}`}>
                  <ThreadLink
                    target={{
                      environmentId: aldoEnvironmentIdFor(conversation.threadId),
                      threadId: conversation.t3ThreadId,
                    }}
                    className={cn(ROW, FOCUS, "group flex items-center gap-3 hover:bg-accent/40")}
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span
                          className={cn(
                            "font-medium text-sm",
                            conversation.ended && "text-muted-foreground",
                          )}
                        >
                          {goalPart(conversation)}
                        </span>
                        {state.tone === "quiet" ? (
                          <span className="text-muted-foreground text-xs">{state.label}</span>
                        ) : (
                          <StatusBadge {...state} />
                        )}
                      </span>
                      <span className="line-clamp-2 text-muted-foreground text-xs [overflow-wrap:anywhere]">
                        {conversation.title}
                      </span>
                    </span>
                    <ChevronRightIcon
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground"
                    />
                  </ThreadLink>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Spending" hint="since it began">
        <dl className={cn(LIST, "grid grid-cols-2 gap-x-4 px-4 py-3")}>
          {goalSpent(shown).map((spent) => (
            <div key={spent.label} className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground text-xs">{spent.label}</dt>
              <dd className="font-medium text-sm tabular-nums">{spent.value}</dd>
            </div>
          ))}
        </dl>
        {limits ? <p className="px-0.5 text-muted-foreground text-xs">{limits}</p> : null}
      </Section>

      <Section title="Log" hint="newest first">
        {lines.length === 0 ? (
          <p className="px-0.5 text-muted-foreground text-sm">
            Nothing yet. Results, readings and decisions are written here as they happen.
          </p>
        ) : (
          <>
            <LogLines goal={shown} lines={lines} now={now} />
            {more || typeof older === "object" ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={older === "loading"}
                  onClick={showOlder}
                >
                  {older === "loading" ? "Loading…" : "Show older"}
                </Button>
                {typeof older === "object" ? (
                  <p role="alert" className="text-destructive-foreground text-xs">
                    Couldn’t load older lines: {older.error}
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </Section>
    </>,
  );
}
