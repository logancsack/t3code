// The plan Aldo proposes before big work starts (plans.logic.ts), as a card in
// its conversation: the goal and the steps, what the agent does in the user's
// name and what it costs, what's left for them, the questions with Aldo's
// recommended answers picked, and Start, named for how long the work takes.
// One that costs nothing starts on its own with the recommended answers two
// minutes after, unless the user says a word, changes an answer or starts
// writing; the card counts it down. "Change the plan" goes to the composer:
// what the user writes next revises it, and the new card replaces this one.
// "Not now" puts it off until a time (AldoNotNow.tsx): it leaves the
// conversation until then, comes back once, and never starts on its own.
// Open, it waits at the conversation's end; started, it says what it started
// with where it started, with its thread to open (its live card follows).

import { ArrowUpRightIcon, CheckIcon, LoaderCircleIcon, UserRoundIcon } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";

import { toastManager } from "../components/ui/toast";
import { cn } from "~/lib/utils";
import { ThreadLink } from "./AldoHomeInbox";
import { NotNowMenu } from "./AldoNotNow";
import { AldoAvatar } from "./AldoPresence";
import { useAldoArrive } from "./arrive";
import { pullAldoConversation, seedAldoComposer } from "./assistantSession";
import { refreshAldoHome } from "./homeFeed";
import { backWhen } from "./notNow.logic";
import { tapAldoPlan } from "./planApi";
import {
  changedFromRecommended,
  chosenAnswers,
  countdownNote,
  inYourNameWords,
  newerPlan,
  planCardState,
  sentence,
  startLabel,
  type AldoPlan,
  type AldoPlanQuestion,
} from "./plans.logic";
import { FOCUS, INSET, PRIMARY, SECONDARY, SURFACE } from "./surface";

/** Plans this page told Aldo to hold (they no longer start on its own), so a card mounted again knows: whether Aldo heard. */
const held = new Map<string, Promise<boolean>>();
/** Plans whose countdown this page reported run out: once each. */
const due = new Set<string>();
/** A hold that didn't reach Aldo is asked again after 1, 2 and 4 seconds, well inside the two minutes. */
const HOLD_TRIES = 4;

function hold(id: string): Promise<boolean> {
  const asked = held.get(id);
  if (asked) return asked;
  const asking = (async () => {
    for (let tries = 1; ; tries += 1) {
      try {
        await tapAldoPlan(id, { action: "hold" });
        return true;
      } catch {
        if (tries >= HOLD_TRIES) break;
        await new Promise((resolve) => window.setTimeout(resolve, 1000 * 2 ** (tries - 1)));
      }
    }
    // Not held after all: Aldo's minute may still start it, so the card counts down again and says so.
    held.delete(id);
    return false;
  })();
  held.set(id, asking);
  return asking;
}

const UNHELD =
  "Couldn’t reach Aldo to hold it, so it still starts on its own when its two minutes are up.";

/** What a failed tap says. */
function failureOf(error: unknown): string {
  return error instanceof Error ? error.message : "It didn’t start. Try again.";
}

export function AldoPlanCard(props: {
  readonly plan: AldoPlan;
  /** Shown where it was already (an open card that started moves up among what happened): it doesn't arrive again. */
  readonly still?: boolean;
}) {
  const [latest, setLatest] = useState<AldoPlan | null>(null);
  const plan = newerPlan(props.plan, latest);
  const open = plan.status === "proposed";
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [isHeld, setHeld] = useState(() => held.has(plan.id));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const arrive = useAldoArrive();
  const state = planCardState(plan, { now, busy, held: isHeld });
  const counting = state.kind === "countdown";

  const holdHere = useCallback(() => {
    setHeld(true);
    setFailure(null);
    void hold(plan.id).then((heard) => {
      if (heard) return;
      setHeld(false);
      setFailure(UNHELD);
    });
  }, [plan.id]);

  // A hold asked for before this card mounted (the page moved it) that Aldo never heard: it counts down again.
  useEffect(() => {
    let live = true;
    void held.get(plan.id)?.then((heard) => {
      if (!live || heard) return;
      setHeld(false);
      setFailure(UNHELD);
    });
    return () => {
      live = false;
    };
  }, [plan.id]);

  // The countdown, a tick a second while it runs.
  useEffect(() => {
    if (!counting) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [counting]);

  // Writing to Aldo while it counts down: the user isn't away, so it waits for them.
  useEffect(() => {
    if (!counting) return;
    const onInput = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-aldo-assistant-footer]")) return;
      holdHere();
    };
    document.addEventListener("input", onInput, true);
    return () => document.removeEventListener("input", onInput, true);
  }, [counting, holdHere]);

  // Its time is up: Aldo starts it on its own if it's still due (its minute would anyway).
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (state.kind !== "due" || due.has(plan.id)) return;
    due.add(plan.id);
    void tapAldoPlan(plan.id, { action: "auto" })
      .then((next) => {
        if (next) setLatest(next);
        // Not due by Aldo's clock yet: a few seconds more, a few times.
        if (next?.status === "proposed" && next.autoStartAt && tries < 3)
          window.setTimeout(() => {
            due.delete(plan.id);
            setTries((t) => t + 1);
          }, 5_000);
      })
      .catch(() => undefined)
      .then(() => refreshAldoHome())
      .then(() => pullAldoConversation());
  }, [state.kind, plan.id, tries]);

  const start = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const next = await tapAldoPlan(plan.id, {
        action: "start",
        answers: chosenAnswers(plan, picked),
      });
      if (next) setLatest(next);
      // Its "Started." and the thread's live card come with the next reads.
      await refreshAldoHome();
      void pullAldoConversation();
    } catch (error) {
      setFailure(failureOf(error));
      void refreshAldoHome();
    } finally {
      setBusy(false);
    }
  };

  // Put off until then: it doesn't start on its own, and the conversation shows it again when it's back.
  const putOff = async (until: Date) => {
    setBusy(true);
    setFailure(null);
    try {
      await tapAldoPlan(plan.id, { action: "hold", until: until.toISOString() });
      held.set(plan.id, Promise.resolve(true));
      setHeld(true);
      const toast = toastManager.add({
        type: "info",
        title: `Back ${backWhen(until, new Date())}`,
        description: "It won’t start on its own.",
        actionProps: {
          children: "Undo",
          onClick: () => {
            toastManager.close(toast);
            void tapAldoPlan(plan.id, { action: "hold", until: null }).then(
              () => refreshAldoHome(),
              () => toastManager.add({ type: "error", title: "Couldn't bring the plan back" }),
            );
          },
        },
      });
      await refreshAldoHome();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Couldn’t put it off. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const pick = (question: AldoPlanQuestion, option: string) => {
    const next = { ...picked, [question.id]: option };
    setPicked(next);
    // Another answer than Aldo's: the user is deciding, so it waits for their Start.
    if (changedFromRecommended(plan, next)) holdHere();
  };

  const answers = open
    ? chosenAnswers(plan, picked)
    : Object.fromEntries(plan.questions.map((q) => [q.id, plan.answers?.[q.id] ?? q.recommended]));
  const note =
    failure ??
    (state.kind === "countdown"
      ? countdownNote(state.left, plan.questions.length > 0)
      : state.kind === "waiting"
        ? state.why
        : state.kind === "due" || state.kind === "starting"
          ? "Starting…"
          : null);
  const inset = inYourNameWords(plan);

  return (
    <article
      {...(props.still ? {} : arrive)}
      aria-label={`Plan: ${plan.goal}`}
      data-aldo-plan={plan.id}
      className={cn(SURFACE, "flex w-full flex-col gap-4 p-4 sm:p-5")}
    >
      <header className="flex flex-col gap-1.5">
        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground leading-[18px]">
          <AldoAvatar size={12} />
          Here’s the plan
        </p>
        <h4 className="text-balance font-semibold text-[16px] leading-[22px] tracking-[-0.01em]">
          {plan.goal}
        </h4>
      </header>
      {plan.steps.length > 0 ? (
        <ol className="flex flex-col gap-2">
          {plan.steps.map((step, index) => (
            // oxlint-disable-next-line react/no-array-index-key -- A plan's steps never move, and two may read the same.
            <li key={index} className="flex items-start gap-2.5 text-[14px] leading-5">
              <span
                aria-hidden
                className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] font-medium text-[11px] text-muted-foreground tabular-nums dark:bg-white/[0.08]"
              >
                {index + 1}
              </span>
              <span className="min-w-0 break-words">{step}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <div className={cn(INSET, "flex flex-col gap-2.5 text-[14px] leading-5")}>
        <div className="flex flex-col gap-1">
          {plan.inYourName ? (
            <p className="flex items-center gap-1.5 font-medium">
              <UserRoundIcon aria-hidden className="size-3.5 shrink-0" strokeWidth={2} />
              In your name
            </p>
          ) : (
            <p className="font-medium">What it costs</p>
          )}
          <p className="break-words text-foreground/85">{inset}</p>
        </div>
        {plan.leftForYou ? (
          <div className="flex flex-col gap-1">
            <p className="font-medium">Left for you</p>
            <p className="break-words text-foreground/85">{sentence(plan.leftForYou)}</p>
          </div>
        ) : null}
      </div>
      {plan.questions.length > 0 ? (
        <div className="flex flex-col gap-3.5">
          {plan.questions.map((q) => (
            <Question
              key={q.id}
              question={q}
              answer={answers[q.id] ?? q.recommended}
              disabled={!open || busy}
              onPick={(option) => pick(q, option)}
            />
          ))}
        </div>
      ) : null}
      <footer className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2.5 border-foreground/[0.06] border-t pt-3.5 dark:border-white/[0.06]">
        {open ? (
          <>
            <p
              role={counting ? "timer" : "status"}
              className="min-w-0 basis-full text-[13px] text-muted-foreground leading-5 tabular-nums sm:flex-1 sm:basis-0"
            >
              {note}
            </p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {plan.deferredUntil !== undefined ? (
                <NotNowMenu
                  label={`Not now: ${plan.goal}`}
                  busy={busy}
                  className={cn(
                    FOCUS,
                    "h-10 rounded-full px-3 text-[13px] text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-50 pointer-coarse:h-11 data-popup-open:bg-foreground/[0.05] data-popup-open:text-foreground",
                  )}
                  onPutOff={(until) => void putOff(until)}
                >
                  Not now
                </NotNowMenu>
              ) : null}
              <button
                type="button"
                className={cn(SECONDARY, "h-10 px-4 pointer-coarse:h-11")}
                disabled={busy}
                onClick={() => {
                  holdHere();
                  seedAldoComposer("");
                }}
              >
                Change the plan
              </button>
              <button
                type="button"
                className={cn(PRIMARY, "h-10 px-4 pointer-coarse:h-11")}
                disabled={busy}
                aria-busy={busy || undefined}
                onClick={() => void start()}
              >
                {busy ? (
                  <LoaderCircleIcon aria-hidden className="size-4 shrink-0 animate-spin" />
                ) : null}
                {startLabel(plan)}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="flex min-w-0 flex-1 items-start gap-2 text-[13px] text-foreground/85 leading-5">
              <span
                aria-hidden
                className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-foreground text-background"
              >
                <CheckIcon className="size-2.5" strokeWidth={3} />
              </span>
              <span className="min-w-0 break-words">
                {state.kind === "started" ? state.summary : null}
              </span>
            </p>
            {plan.thread ? (
              <ThreadLink
                target={plan.thread}
                className={cn(SECONDARY, "h-10 px-4 pointer-coarse:h-11")}
                label={`Open ${plan.title ?? "the thread"}`}
              >
                Open
                <ArrowUpRightIcon aria-hidden className="size-4" strokeWidth={1.75} />
              </ThreadLink>
            ) : null}
          </>
        )}
      </footer>
    </article>
  );
}

/** A question with its answers to tap: the one picked marked, Aldo's recommended tagged. */
function Question(props: {
  readonly question: AldoPlanQuestion;
  readonly answer: string;
  readonly disabled: boolean;
  readonly onPick: (option: string) => void;
}) {
  const id = useId();
  const q = props.question;
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-2">
      <p id={id} className="font-medium text-[13px] text-muted-foreground leading-[18px]">
        {q.question}
      </p>
      <div className="flex flex-wrap gap-2">
        {q.options.map((option) => {
          const on = option === props.answer;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={on}
              disabled={props.disabled}
              className={cn(
                FOCUS,
                "inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-left text-[14px] leading-5 transition-colors pointer-coarse:min-h-11 disabled:cursor-default motion-reduce:transition-none",
                on
                  ? "border-foreground/70 bg-foreground/[0.06] text-foreground dark:bg-white/[0.08]"
                  : "border-foreground/[0.12] bg-transparent text-foreground/80 hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-50 disabled:hover:bg-transparent",
              )}
              onClick={() => props.onPick(option)}
            >
              {on ? (
                <CheckIcon aria-hidden className="size-3.5 shrink-0" strokeWidth={2.5} />
              ) : null}
              <span className="min-w-0 break-words">{option}</span>
              {option === q.recommended ? (
                <span className="shrink-0 text-[12px] text-muted-foreground">Recommended</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
