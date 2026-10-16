// Aldo's brief for the day, in the conversation where Aldo said it
// (AldoConversation shows a message from the day's brief this way, briefFeed.ts
// reads it): what Aldo said, as its other words are, with Listen to hear it and
// the rest of today's calendar. What to decide is at the conversation's end
// (AldoUpNext.tsx), in the brief's order, with Aldo's picks and the way to go
// through it all on a call. An earlier day's brief is just what was said.

import {
  CalendarIcon,
  CalendarPlusIcon,
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
import { useAldoBrief } from "./briefFeed";
import { aldoBriefAudioUrl, type AldoBrief } from "./cloud";
import type { AldoChoice } from "./decide";
import type { AldoDecision } from "./decisions.logic";

/** A decision's kind, at a glance: what it is and how much it waits on the user. */
export function DecisionIcon(props: {
  readonly decision: AldoDecision;
  readonly className?: string;
  /** Just the glyph, in the text's color: Aldo's conversation, where color is for the halo. */
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
  const arrive = useAldoArrive();
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
          {brief.title}'s brief · {timeOf(brief.at)}
        </span>
        <ListenButton brief={brief} />
      </div>
      <p className="whitespace-pre-wrap text-[15px] leading-7">{brief.text}</p>
      {brief.ahead.length > 0 ? (
        <p className="flex items-start gap-2 text-[13.5px] text-muted-foreground leading-5">
          <CalendarIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="tabular-nums">
            {brief.ahead
              .map((e) => `${e.title} ${e.allDay ? "(all day)" : timeOf(e.start)}`)
              .join(" · ")}
          </span>
        </p>
      ) : null}
    </section>
  );
}

/** About how long the brief takes to say, before the audio says exactly. */
function estimate(brief: AldoBrief): number {
  const words = [brief.text, ...brief.ahead.map((e) => e.title)].join(" ").split(/\s+/).length;
  return Math.round(((words + brief.top.length * 12) / 2.6) * 1000);
}

/** Listen: Aldo reads the brief aloud, in its voice; the voice stops for a call. */
function ListenButton(props: { readonly brief: AldoBrief }) {
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
      player = new Audio(aldoBriefAudioUrl(props.brief.day));
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
