// What needs the user, answered in place: a question with its choices, an
// approval, a plan to carry out, or a thread that stopped. Answering goes to
// Aldo as the user (cloud.ts answerAldoThread, approveAldoPlan), which wakes
// the thread's machine if it sleeps, so a button can take a little while.

import { Link } from "@tanstack/react-router";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { ArrowUpRightIcon, MessageCircleQuestionIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { toastManager } from "../components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "~/lib/utils";
import { seedAldoComposer } from "./assistantSession";
import {
  AldoApiError,
  answerAldoThread,
  approveAldoPlan,
  type AldoHomeConversation,
  type AldoHomePending,
  type AldoHomeTarget,
} from "./cloud";
import { elapsed, modelName, NEEDS_YOU_LABEL, needsYouKind, repoName } from "./home.logic";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** Aldo refused because the thread is waiting on something else now: the board should show it. */
const movedOn = (error: unknown) => error instanceof AldoApiError && error.status === 409;

export function ThreadLink(props: {
  readonly target: AldoHomeTarget;
  readonly children?: ReactNode;
  readonly className?: string;
}) {
  return (
    <Link
      to="/$environmentId/$threadId"
      params={{
        environmentId: props.target.environmentId as EnvironmentId,
        threadId: props.target.threadId as ThreadId,
      }}
      className={props.className}
    >
      {props.children}
    </Link>
  );
}

/** "Ask Aldo" about a conversation: seeds the composer with its name. */
export function askAldoAbout(title: string): void {
  seedAldoComposer(`About "${title}": `);
}

export function NeedsYouCard(props: {
  readonly conversation: AldoHomeConversation;
  readonly repos: ReadonlyArray<string>;
  readonly now: number;
  readonly isNew: boolean;
  readonly selected: boolean;
  readonly assistant: boolean;
  readonly onSelect: () => void;
  /** Something was answered: the board should refresh. */
  readonly onActed: () => void;
}) {
  const c = props.conversation;
  const kind = needsYouKind(c) ?? "waiting";
  const model = modelName(c.model);
  return (
    <li
      data-selected={props.selected || undefined}
      className={cn(
        "rounded-xl border border-border/60 bg-card/30 p-3.5 transition-colors",
        props.selected && "border-primary/60 ring-1 ring-primary/40",
      )}
      onClick={props.onSelect}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className={cn(
            "mt-1.5 size-2 shrink-0 rounded-full",
            kind === "failed" ? "bg-destructive" : "bg-warning",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge variant={kind === "failed" ? "error" : "warning"} size="sm">
              {NEEDS_YOU_LABEL[kind]}
            </Badge>
            <ThreadLink
              target={c.thread}
              className="min-w-0 truncate font-medium text-sm hover:underline"
            >
              {c.title}
            </ThreadLink>
            {props.isNew ? (
              <Badge variant="info" size="sm">
                new
              </Badge>
            ) : null}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-muted-foreground text-xs">
            <span>{c.repos.map((r) => repoName(r, props.repos)).join(" + ")}</span>
            {model ? <span>· {model}</span> : null}
            <span>· waiting {elapsed(c.at, props.now)}</span>
          </div>
          {c.summary && kind !== "approval" ? (
            <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm">{c.summary}</p>
          ) : null}
          <div className="mt-3">
            <PendingForm conversation={c} onActed={props.onActed} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="compact" render={<ThreadLink target={c.thread} />}>
              Open
            </Button>
            {props.assistant ? (
              <Button variant="ghost" size="compact" onClick={() => askAldoAbout(c.title)}>
                <MessageCircleQuestionIcon />
                Ask Aldo
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}

/**
 * What a conversation waits on, to answer in place: its question, approval or
 * plan. Keyed by what's asked, so a form's choices and words go when the
 * thread moves on to another. One paused mid-turn says so, with the way to
 * carry on (opening it). Nothing for one that waits on nothing to answer.
 */
export function PendingForm(props: {
  readonly conversation: AldoHomeConversation;
  readonly onActed: () => void;
}) {
  const c = props.conversation;
  const kind = needsYouKind(c);
  if (kind === "question" && c.pending?.kind === "question")
    return (
      <QuestionForm
        key={c.pending.requestId}
        target={c.thread}
        pending={c.pending}
        onActed={props.onActed}
      />
    );
  if (kind === "approval" && c.pending?.kind === "approval")
    return (
      <ApprovalForm
        key={c.pending.requestId}
        target={c.thread}
        pending={c.pending}
        onActed={props.onActed}
      />
    );
  if (kind === "plan" && c.plan)
    return <PlanForm key={c.plan.id} target={c.thread} plan={c.plan} onActed={props.onActed} />;
  if (kind === "paused")
    return (
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
        <span>Its machine went to sleep mid-turn.</span>
        <Button variant="outline" size="compact" render={<ThreadLink target={c.thread} />}>
          Open to carry on
          <ArrowUpRightIcon />
        </Button>
      </div>
    );
  return null;
}

function QuestionForm(props: {
  readonly target: AldoHomeTarget;
  readonly pending: Extract<AldoHomePending, { kind: "question" }>;
  readonly onActed: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const questions = props.pending.questions;
  const single = questions.length === 1;
  const complete = questions.every((q) => {
    const a = answers[q.id];
    return Array.isArray(a) ? a.length > 0 : !!a;
  });
  const submit = async (given: Record<string, string | string[]>) => {
    setBusy(true);
    setError(null);
    try {
      const status = await answerAldoThread(props.target, {
        requestId: props.pending.requestId,
        answers: given,
      });
      toastManager.add({
        type: "success",
        title: status === "answered" ? "Answered" : "Answer sent",
      });
      props.onActed();
    } catch (cause) {
      setError(messageOf(cause));
      if (movedOn(cause)) props.onActed();
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!single) {
          if (complete) void submit(answers);
          return;
        }
        // One question: typed words join the choices of a multi-select, or answer it instead.
        const q = questions[0]!;
        const chosen = answers[q.id];
        const typed = other.trim();
        const answer: string | string[] | undefined = q.multiSelect
          ? [...(Array.isArray(chosen) ? chosen : []), ...(typed ? [typed] : [])]
          : typed || chosen;
        if (answer === undefined || (Array.isArray(answer) ? answer.length === 0 : !answer)) return;
        void submit({ [q.id]: answer });
      }}
    >
      {questions.map((q) => {
        const chosen = answers[q.id];
        return (
          <fieldset key={q.id} className="flex flex-col gap-1.5" disabled={busy}>
            <legend className="text-sm">
              {q.header ? <span className="font-medium">{q.header}: </span> : null}
              {q.question}
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {q.options.map((o) => {
                const on = Array.isArray(chosen) ? chosen.includes(o.label) : chosen === o.label;
                const choose = () => {
                  setAnswers((prev) => {
                    if (!q.multiSelect) return { ...prev, [q.id]: o.label };
                    const list = Array.isArray(prev[q.id]) ? (prev[q.id] as string[]) : [];
                    return {
                      ...prev,
                      [q.id]: list.includes(o.label)
                        ? list.filter((l) => l !== o.label)
                        : [...list, o.label],
                    };
                  });
                  // A single question with one choice is answered with the tap.
                  if (single && !q.multiSelect) void submit({ [q.id]: o.label });
                };
                const button = (
                  <button
                    type="button"
                    aria-pressed={on}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs transition-colors",
                      on
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border/70 bg-card/40 text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                    onClick={choose}
                  >
                    {o.label}
                  </button>
                );
                return o.description ? (
                  <Tooltip key={o.label}>
                    <TooltipTrigger render={button} />
                    <TooltipPopup side="bottom">{o.description}</TooltipPopup>
                  </Tooltip>
                ) : (
                  <span key={o.label}>{button}</span>
                );
              })}
            </div>
          </fieldset>
        );
      })}
      <div className="flex items-center gap-2">
        {single ? (
          <Input
            size="sm"
            className="flex-1"
            placeholder="Or answer in your own words…"
            value={other}
            disabled={busy}
            onChange={(event) => setOther(event.target.value)}
          />
        ) : null}
        {!single || other.trim() || (questions[0]!.multiSelect && complete) ? (
          <Button
            type="submit"
            size="sm"
            disabled={busy || (single ? !(other.trim() || complete) : !complete)}
          >
            {busy ? "Sending…" : "Send"}
          </Button>
        ) : null}
        {busy && single && !other.trim() ? (
          <span className="text-muted-foreground text-xs">Sending…</span>
        ) : null}
      </div>
      {error ? <p className="text-destructive-foreground text-xs">{error}</p> : null}
    </form>
  );
}

function ApprovalForm(props: {
  readonly target: AldoHomeTarget;
  readonly pending: Extract<AldoHomePending, { kind: "approval" }>;
  readonly onActed: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const decide = async (decision: string) => {
    setBusy(decision);
    setError(null);
    try {
      const status = await answerAldoThread(props.target, {
        requestId: props.pending.requestId,
        decision,
      });
      toastManager.add({
        type: "success",
        title: status.startsWith("sent")
          ? "Decision sent"
          : `${status[0]!.toUpperCase()}${status.slice(1)}`,
      });
      props.onActed();
    } catch (cause) {
      setError(messageOf(cause));
      if (movedOn(cause)) props.onActed();
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">{props.pending.summary}</p>
      {props.pending.detail ? (
        <div>
          <button
            type="button"
            className="text-muted-foreground text-xs hover:text-foreground"
            onClick={() => setShowDetail((v) => !v)}
          >
            {showDetail ? "Hide details" : "Show details"}
          </button>
          {showDetail ? (
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 font-mono text-xs">
              {props.pending.detail}
            </pre>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {props.pending.options.map((o) => {
          const refuses = o.decision === "decline" || o.decision === "cancel";
          return (
            <Button
              key={o.decision}
              size="sm"
              variant={refuses ? "outline" : "default"}
              disabled={busy !== null}
              onClick={() => void decide(o.decision)}
            >
              {busy === o.decision ? "Sending…" : o.label}
            </Button>
          );
        })}
      </div>
      {error ? <p className="text-destructive-foreground text-xs">{error}</p> : null}
    </div>
  );
}

function PlanForm(props: {
  readonly target: AldoHomeTarget;
  readonly plan: { readonly id: string; readonly text: string };
  readonly onActed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const [changes, setChanges] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (withChanges?: string) => {
    setBusy(true);
    setError(null);
    try {
      await approveAldoPlan(props.target, props.plan.id, withChanges);
      toastManager.add({
        type: "success",
        title: withChanges ? "Asked for a revised plan" : "The agent is carrying out the plan",
      });
      props.onActed();
    } catch (cause) {
      setError(messageOf(cause));
      if (movedOn(cause)) props.onActed();
    } finally {
      setBusy(false);
    }
  };
  const lines = props.plan.text.split("\n");
  const preview = lines.slice(0, 6).join("\n");
  return (
    <div className="flex flex-col gap-2">
      <div className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2.5 text-xs leading-relaxed">
        {open ? props.plan.text : preview}
        {!open && lines.length > 6 ? "\n…" : ""}
      </div>
      {lines.length > 6 ? (
        <button
          type="button"
          className="self-start text-muted-foreground text-xs hover:text-foreground"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Show less" : "Show the whole plan"}
        </button>
      ) : null}
      {changing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (changes.trim()) void act(changes.trim());
          }}
        >
          <Textarea
            size="sm"
            rows={3}
            placeholder="What should change in the plan?"
            value={changes}
            disabled={busy}
            onChange={(event) => setChanges(event.target.value)}
          />
          <div className="flex gap-1.5">
            <Button type="submit" size="sm" disabled={busy || !changes.trim()}>
              {busy ? "Sending…" : "Send changes"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setChanging(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" disabled={busy} onClick={() => void act()}>
            {busy ? "Starting…" : "Approve plan"}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setChanging(true)}>
            Ask for changes
          </Button>
        </div>
      )}
      {error ? <p className="text-destructive-foreground text-xs">{error}</p> : null}
    </div>
  );
}

export function OpenIcon() {
  return <ArrowUpRightIcon className="size-3.5" />;
}
