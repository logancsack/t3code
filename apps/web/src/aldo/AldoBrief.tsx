// Aldo's brief for the day, in the conversation where Aldo said it
// (AldoConversation shows a message from the day's brief this way, briefFeed.ts
// reads it): its first line ("Morning, Sam. 2 of your 5 things need you
// today."), what Aldo said, with Listen to hear it, what it's about in groups
// (what needs the user, what Aldo's watching, what can wait, what's good to
// know), each line on its thread as it stands now (briefGroups.logic.ts), and
// the rest of today's calendar. A tap on what needs the user opens its card at
// the conversation's end (AldoUpNext.tsx), where it's decided, with Aldo's
// picks and the way to go through it all on a call; any other opens its
// thread. An earlier day's brief is just what was said.

import {
  CalendarIcon,
  CalendarPlusIcon,
  ChevronRightIcon,
  CircleCheckBigIcon,
  CircleAlertIcon,
  ClipboardListIcon,
  HandIcon,
  HourglassIcon,
  LoaderCircleIcon,
  MailIcon,
  MessageCircleQuestionIcon,
  PauseIcon,
  PlayIcon,
  ShieldQuestionIcon,
  SparklesIcon,
  SunIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { PullRequestGlyph } from "../components/pullRequest/pullRequestIcons";
import { toastManager } from "../components/ui/toast";
import { requestConfirmDialog } from "../confirmDialog";
import { cn } from "~/lib/utils";
import { callDuration } from "./assistant.logic";
import { useAldoAssistant } from "./assistantSession";
import { useAldoArrive } from "./arrive";
import { useAldoHomeFeed } from "./homeFeed";
import { useAldoBrief } from "./briefFeed";
import { aldoBriefAudioUrl, type AldoBrief, type AldoBriefGroupItem } from "./assistantApi";
import { OpenThread, WorkstreamGlyph } from "./AldoWorkstream";
import { BRIEF_GROUPS, briefItemNote, briefItemState, liveDecisionKeys } from "./briefGroups.logic";
import { showAldoDecisionKey } from "./show";
import { WORKSTREAM_WORDS, type WorkstreamState } from "./workstream.logic";
import type { AldoChoice } from "./decide";
import type { AldoDecision } from "./decisions.logic";

/** A decision's kind, at a glance: what it is and how much it waits on the user. */
export function DecisionIcon(props: {
  readonly decision: AldoDecision;
  readonly className?: string;
  /** Just the glyph, in the text's color: Aldo's conversation, where color is for the face. */
  readonly plain?: boolean;
}) {
  const d = props.decision;
  const [Icon, tone] =
    d.kind === "aldo-approval"
      ? [
          d.approval.kind === "email"
            ? MailIcon
            : d.approval.kind === "event"
              ? CalendarPlusIcon
              : d.approval.kind === "confirm"
                ? CircleCheckBigIcon
                : SparklesIcon,
          "bg-warning/12 text-warning-foreground",
        ]
      : d.kind === "question"
        ? [MessageCircleQuestionIcon, "bg-primary/10 text-primary"]
        : d.kind === "approval"
          ? [ShieldQuestionIcon, "bg-warning/12 text-warning-foreground"]
          : d.kind === "handoff"
            ? [HandIcon, "bg-warning/12 text-warning-foreground"]
            : d.kind === "plan"
              ? [ClipboardListIcon, "bg-primary/10 text-primary"]
              : d.kind === "merge"
                ? [PullRequestGlyph.merged, "bg-success/12 text-success-foreground"]
                : d.kind === "failed"
                  ? [CircleAlertIcon, "bg-destructive/10 text-destructive-foreground"]
                  : [HourglassIcon, "bg-warning/12 text-warning-foreground"];
  if (props.plain)
    return (
      <Icon
        aria-hidden
        className={cn("size-4 shrink-0 text-foreground/55", props.className)}
        strokeWidth={1.75}
      />
    );
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-lg",
        tone,
        props.className,
      )}
    >
      <Icon className="size-3.5" />
    </span>
  );
}

/** The one tap a decision takes in a list, if it takes one: its choice, and what the button says. */
export function quickChoice(
  d: AldoDecision,
  suggestion: string | null,
): { readonly label: string; readonly choice: AldoChoice; readonly primary: boolean } | null {
  // A step that needs the user's yes (a purchase, a booking) is said yes to with its total and terms in view: in its card.
  if (d.kind === "aldo-approval" && d.approval.kind === "confirm") return null;
  if (d.kind === "aldo-approval")
    return {
      label: d.approval.approveLabel,
      choice: { kind: "aldo", decision: "approve" },
      primary: true,
    };
  if (d.kind === "merge") return { label: "Merge", choice: { kind: "merge" }, primary: true };
  if (d.kind === "question" && suggestion) {
    const q = d.pending.questions[0];
    if (
      d.pending.questions.length === 1 &&
      q &&
      !q.multiSelect &&
      q.options.some((o) => o.label === suggestion)
    )
      return {
        label: suggestion,
        choice: { kind: "answer", answers: { [q.id]: suggestion } },
        primary: false,
      };
  }
  return null;
}

/**
 * Asks before a tap that goes out of Aldo (an email sent, an event added, a
 * merge), deletes a draft, or makes a rule (always allow). `seen`: what goes
 * out is on screen in full (a card open at the conversation's end), so the
 * tap on its button is the yes.
 */
export async function confirmQuickChoice(
  d: AldoDecision,
  choice?: AldoChoice,
  options: { readonly seen?: boolean } = {},
): Promise<boolean> {
  if (choice?.kind === "aldo" && choice.decision === "discard") {
    if (d.kind !== "aldo-approval" || d.approval.kind !== "email") return true;
    return (
      (await (requestConfirmDialog(
        "Discard this draft? It's deleted from your drafts, and isn't sent.",
        { variant: "destructive" },
      ) ?? Promise.resolve(true))) === true
    );
  }
  if (choice?.kind === "aldo" && choice.decision === "always") {
    // A rule from now on is said yes to as what it is, whatever's on screen.
    if (d.kind !== "aldo-approval" || !d.approval.always) return false;
    return (
      (await (requestConfirmDialog(
        `${d.approval.always}, from now on? This one is approved now too, and you can undo the rule.`,
      ) ?? Promise.resolve(true))) === true
    );
  }
  if (options.seen && d.kind === "aldo-approval") return true;
  const question =
    d.kind === "aldo-approval"
      ? d.approval.kind === "email"
        ? `Send "${d.approval.title}" (${d.approval.summary}) as it's drafted?`
        : d.approval.kind === "event"
          ? `Add "${d.approval.title}" (${d.approval.summary}) to your calendar?`
          : null
      : d.kind === "merge"
        ? `Merge ${d.pullRequest.repo}#${d.pullRequest.number}? Aldo then follows its deploy.`
        : null;
  if (!question) return true;
  return (await (requestConfirmDialog(question) ?? Promise.resolve(true))) === true;
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** A message from Aldo's brief, in the conversation: today's in full, an earlier day's as what was said. */
export function AldoBriefEntry(props: { readonly text: string; readonly at: string }) {
  const brief = useAldoBrief((s) => s.brief);
  if (brief && brief.at === props.at) return <BriefCard brief={brief} />;
  const when = new Date(props.at).toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <div className="flex max-w-[94%] flex-col gap-1 self-start">
      <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <SunIcon aria-hidden className="size-3.5" strokeWidth={1.75} />
        Brief · {when}
      </span>
      <p className="whitespace-pre-wrap text-[15px] leading-7">{props.text}</p>
    </div>
  );
}

function BriefCard(props: { readonly brief: AldoBrief }) {
  const { brief } = props;
  const hidden = useAldoHomeFeed((s) =>
    [
      ...(s.home?.conversations ?? []),
      ...(s.home?.approvals ?? []),
      ...(s.home?.pullRequests ?? []),
    ]
      .filter((item) => item.chatDecision?.dismissed)
      .map((item) => item.chatDecision!.id)
      .sort()
      .join(","),
  );

  const arrive = useAldoArrive();
  const groups = brief.headline && brief.groups ? brief.groups : null;
  if (groups)
    return (
      <section
        aria-label={brief.title}
        {...arrive}
        className="flex w-full max-w-[min(94%,34rem)] flex-col gap-3 self-start rounded-[20px] rounded-bl-[8px] border border-foreground/[0.07] bg-card px-4 pt-3 pb-3.5 dark:border-white/[0.08] dark:bg-white/[0.045]"
        data-aldo-brief=""
      >
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <SunIcon aria-hidden className="size-3.5" strokeWidth={1.75} />
          <span className="min-w-0 truncate tabular-nums">
            {brief.title} · {timeOf(brief.at)}
          </span>
          <ListenButton key={hidden} brief={brief} revision={hidden} />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-balance font-semibold text-[17px] leading-6">{brief.headline}</p>
          <p className="whitespace-pre-wrap text-[14.5px] text-foreground/80 leading-6">
            {brief.text}
          </p>
        </div>
        <BriefGroups brief={brief} groups={groups} />
        <BriefAhead brief={brief} />
      </section>
    );
  // What it says to decide is at the conversation's end, live (AldoUpNext.tsx),
  // with the way to go through it all with Aldo; it's not repeated here.
  return (
    <section
      aria-label={brief.title}
      {...arrive}
      className="flex max-w-[94%] flex-col gap-1.5 self-start"
      data-aldo-brief=""
    >
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <SunIcon aria-hidden className="size-3.5" strokeWidth={1.75} />
        <span className="tabular-nums">
          {brief.title} · {timeOf(brief.at)}
        </span>
        <ListenButton key={hidden} brief={brief} revision={hidden} />
      </div>
      <p className="whitespace-pre-wrap text-[15px] leading-7">{brief.text}</p>
      <BriefAhead brief={brief} />
    </section>
  );
}

/** The rest of today's calendar, in a line. */
function BriefAhead(props: { readonly brief: AldoBrief }) {
  const { brief } = props;
  return brief.ahead.length > 0 ? (
    <p className="flex items-start gap-2 text-[13.5px] text-muted-foreground leading-5">
      <CalendarIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
      <span className="tabular-nums">
        {brief.ahead
          .map((e) => `${e.title} ${e.allDay ? "(all day)" : timeOf(e.start)}`)
          .join(" · ")}
      </span>
    </p>
  ) : null;
}

/** What the brief is about, in its groups: only those with something in them. */
function BriefGroups(props: {
  readonly brief: AldoBrief;
  readonly groups: NonNullable<AldoBrief["groups"]>;
}) {
  const home = useAldoHomeFeed((s) => s.home ?? null);
  const now = Date.now();
  const decisions = liveDecisionKeys(home, now);
  return (
    <div className="flex flex-col gap-2.5">
      {BRIEF_GROUPS.map((group) => {
        const items = props.groups[group.key];
        if (items.length === 0) return null;
        return (
          <section key={group.key} aria-label={group.label} className="flex flex-col gap-0.5">
            <h3 className="font-medium text-[12px] text-muted-foreground leading-5">
              {group.label}
            </h3>
            <ul className="-mx-2 flex flex-col">
              {items.map((item, index) => (
                // oxlint-disable-next-line react/no-array-index-key -- A brief's items never change once it's made; two may share a thread.
                <li key={`${item.key ?? item.thread?.threadId ?? "item"}:${index}`}>
                  <BriefLine
                    item={item}
                    written={group.state}
                    state={briefItemState(item, group.state, home, decisions, now)}
                    now={now}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** One line of the brief: its glyph, its thread's name and a line on it; a tap takes the user to it. */
function BriefLine(props: {
  readonly item: AldoBriefGroupItem;
  readonly written: WorkstreamState;
  readonly state: WorkstreamState;
  readonly now: number;
}) {
  const { item, state } = props;
  const note = briefItemNote(item, props.written, state, props.now);
  const settled = state === "done" && props.written === "needs";
  // What's changed since it was written leads (it's what's news); why it matters and when it's back follow
  // its line, whose own full stop goes before a "·".
  const lead = state !== props.written ? note : null;
  const more = [item.why, lead ? null : note].filter((part): part is string => Boolean(part));
  const line = [
    ...(lead ? [lead.charAt(0).toUpperCase() + lead.slice(1)] : []),
    more.length > 0 ? item.text.replace(/\.$/, "") : item.text,
    ...more,
  ].join(" · ");
  const body = (
    <>
      <span aria-hidden className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        <WorkstreamGlyph state={state} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "truncate font-medium text-[14px] leading-5",
            settled && "text-muted-foreground",
          )}
        >
          <span className="sr-only">{WORKSTREAM_WORDS[state]}: </span>
          {item.workstream}
        </span>
        <span className="line-clamp-2 text-[13px] text-muted-foreground leading-[18px]">
          {line}
        </span>
      </span>
      {item.thread ? (
        <ChevronRightIcon
          aria-hidden
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-60"
          strokeWidth={2}
        />
      ) : null}
    </>
  );
  const className =
    "flex w-full items-start gap-2.5 rounded-xl px-2 py-1.5 text-start pointer-coarse:py-2.5";
  const key = item.key;
  // What still needs them opens its card at the conversation's end, where it's decided.
  const showCard =
    key !== undefined && state === "needs" ? () => showAldoDecisionKey(key) : undefined;
  if (item.thread)
    return (
      <OpenThread
        target={item.thread}
        className={cn(
          className,
          "transition-colors hover:bg-foreground/[0.05] focus-visible:outline-2 focus-visible:outline-ring",
        )}
        {...(showCard ? { onOpen: showCard } : {})}
      >
        {body}
      </OpenThread>
    );
  if (showCard)
    return (
      <button
        type="button"
        className={cn(
          className,
          "transition-colors hover:bg-foreground/[0.05] focus-visible:outline-2 focus-visible:outline-ring",
        )}
        onClick={showCard}
      >
        {body}
      </button>
    );
  return <div className={className}>{body}</div>;
}

/** About how long the brief takes to say, before the audio says exactly. */
function estimate(brief: AldoBrief): number {
  const words = [brief.text, ...brief.ahead.map((e) => e.title)].join(" ").split(/\s+/).length;
  return Math.round(((words + brief.top.length * 12) / 2.6) * 1000);
}

/** Listen: Aldo reads the brief aloud, in its voice; the voice stops for a call. */
function ListenButton(props: { readonly brief: AldoBrief; readonly revision: string }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "paused">("idle");
  const [length, setLength] = useState<number | null>(null);
  const [position, setPosition] = useState(0);
  const live = useAldoAssistant((s) => s.phase !== "idle" && s.phase !== "error");
  useEffect(() => {
    if (live) audio.current?.pause();
  }, [live]);
  useEffect(
    () => () => {
      audio.current?.pause();
      audio.current = null;
    },
    [],
  );
  const toggle = () => {
    let player = audio.current;
    if (!player) {
      player = new Audio(
        `${aldoBriefAudioUrl(props.brief.day)}&v=${encodeURIComponent(props.revision)}`,
      );
      player.preload = "auto";
      player.addEventListener("loadedmetadata", () => {
        if (Number.isFinite(player!.duration)) setLength(player!.duration * 1000);
      });
      player.addEventListener("timeupdate", () => setPosition(player!.currentTime * 1000));
      player.addEventListener("playing", () => setState("playing"));
      player.addEventListener("pause", () => setState("paused"));
      player.addEventListener("ended", () => {
        setState("idle");
        setPosition(0);
      });
      player.addEventListener("error", () => {
        setState("idle");
        audio.current = null;
        toastManager.add({ type: "error", title: "Couldn't play the brief" });
      });
      audio.current = player;
    }
    if (state === "playing") {
      player.pause();
      return;
    }
    setState((current) => (current === "paused" ? current : "loading"));
    void player.play().catch(() => setState("idle"));
  };
  const total = length ?? estimate(props.brief);
  const label =
    state === "loading"
      ? "Getting it ready…"
      : state === "playing" || state === "paused"
        ? `${callDuration(position)} / ${callDuration(total)}`
        : `Listen · ${callDuration(total)}`;
  return (
    <button
      type="button"
      className="inline-flex h-6 items-center gap-1 rounded-full bg-foreground/[0.06] ps-2 pe-2.5 font-medium text-[12px] text-foreground/80 tabular-nums outline-none transition-colors hover:bg-foreground/[0.10] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={state === "playing" ? "Pause the brief" : "Listen to the brief"}
      onClick={toggle}
    >
      {state === "loading" ? (
        <LoaderCircleIcon className="size-3 animate-spin" />
      ) : state === "playing" ? (
        <PauseIcon className="size-3" fill="currentColor" strokeWidth={0} />
      ) : (
        <PlayIcon className="size-3" fill="currentColor" strokeWidth={0} />
      )}
      {label}
    </button>
  );
}
