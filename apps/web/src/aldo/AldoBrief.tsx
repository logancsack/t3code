// Aldo's brief for the day, in the conversation where Aldo said it
// (AldoConversation shows a message from the day's brief this way, briefFeed.ts
// reads it): what Aldo said, Listen to hear it, "Top of mind" (the few things
// to decide first, each as it stands now: done ones ticked, the rest decided in
// a tap or opened in a peek, with Aldo's pick for a question when it has a
// reason), going through them with Aldo on a call (walkthrough.ts), and the
// rest of today's calendar. An earlier day's brief is just what was said.

import {
  CalendarPlusIcon,
  CircleCheckBigIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  ClipboardListIcon,
  GitMergeIcon,
  HourglassIcon,
  LoaderCircleIcon,
  MailIcon,
  MessageCircleQuestionIcon,
  PauseIcon,
  PlayIcon,
  ShieldQuestionIcon,
  SparklesIcon,
} from "lucide-react";
import { useContext, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { toastManager } from "../components/ui/toast";
import { requestConfirmDialog } from "../confirmDialog";
import { useIsMobile } from "../hooks/useMediaQuery";
import { cn } from "~/lib/utils";
import { AldoPeekerContext, type AldoPeekTarget } from "./AldoPeek";
import { callDuration } from "./assistant.logic";
import { useAldoAssistant } from "./assistantSession";
import { useAldoBrief } from "./briefFeed";
import { aldoBriefAudioUrl, type AldoBrief, type AldoBriefItem } from "./cloud";
import { decideAldo, type AldoChoice } from "./decide";
import { aldoDecisions, decisionAsk, decisionTitle, type AldoDecision } from "./decisions.logic";
import { setAldoHomeView, useAldoHomeFeed } from "./homeFeed";
import { startAldoWalkthrough } from "./walkthrough";

/** A decision's kind, at a glance: what it is and how much it waits on the user. */
export function DecisionIcon(props: {
  readonly decision: AldoDecision;
  readonly className?: string;
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
          : d.kind === "plan"
            ? [ClipboardListIcon, "bg-primary/10 text-primary"]
            : d.kind === "merge"
              ? [GitMergeIcon, "bg-success/12 text-success-foreground"]
              : d.kind === "failed"
                ? [CircleAlertIcon, "bg-destructive/10 text-destructive-foreground"]
                : [HourglassIcon, "bg-warning/12 text-warning-foreground"];
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

/** Where a decision peeks: its approval, or its thread. */
export function peekOfDecision(d: AldoDecision): AldoPeekTarget | null {
  if (d.kind === "aldo-approval") return { kind: "approval", id: d.approval.id };
  if (d.kind === "merge")
    return d.pullRequest.thread ? { kind: "thread", target: d.pullRequest.thread } : null;
  return { kind: "thread", target: d.conversation.thread };
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

/** Asks before a tap that goes out of Aldo: an email sent, an event added, a merge. */
export async function confirmQuickChoice(d: AldoDecision): Promise<boolean> {
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
    <div className="flex max-w-[85%] flex-col gap-1 self-start">
      <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <span
          aria-hidden
          className="size-2.5 rounded-full bg-gradient-to-br from-primary/90 to-primary/50"
        />
        Brief · {when}
      </span>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{props.text}</p>
    </div>
  );
}

function BriefCard(props: { readonly brief: AldoBrief }) {
  const { brief } = props;
  const home = useAldoHomeFeed((s) => s.home);
  const decisions = useMemo(() => (home ? aldoDecisions(home, Date.now()) : null), [home]);
  const suggestions = useMemo(() => {
    const picks: Record<string, string> = {};
    for (const item of brief.top) if (item.suggestion) picks[item.key] = item.suggestion;
    return picks;
  }, [brief.top]);
  // Top of mind first, then the rest of what waits, for going through them.
  const toGoThrough = useMemo(() => {
    if (!decisions) return [];
    const first = brief.top.flatMap((item) => decisions.filter((d) => d.key === item.key));
    return [...first, ...decisions.filter((d) => !first.includes(d))];
  }, [brief.top, decisions]);
  return (
    <section
      aria-label={brief.title}
      className="flex w-full flex-col gap-3 self-stretch"
      data-aldo-brief=""
    >
      <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <span
          aria-hidden
          className="size-2.5 rounded-full bg-gradient-to-br from-primary/90 to-primary/50"
        />
        {brief.title} · {timeOf(brief.at)}
      </span>
      <p className="text-[17px] leading-relaxed md:text-base">{brief.text}</p>
      <div className="flex flex-wrap items-center gap-2">
        <ListenButton brief={brief} />
        {toGoThrough.length > 0 ? (
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            onClick={() => startAldoWalkthrough(toGoThrough, suggestions)}
          >
            <span
              aria-hidden
              className="size-3 rounded-full bg-gradient-to-br from-primary/90 to-primary/50"
            />
            Go through {toGoThrough.length === 1 ? "it" : "them"}
          </Button>
        ) : null}
      </div>
      {brief.top.length > 0 ? <TopOfMind items={brief.top} decisions={decisions} /> : null}
      {brief.ahead.length > 0 ? (
        <p className="text-sm">
          <span className="font-medium">Looking ahead: </span>
          <span className="text-muted-foreground">
            {brief.ahead
              .map((e) => `${e.title} ${e.allDay ? "(all day)" : timeOf(e.start)}`)
              .join(" · ")}
          </span>
        </p>
      ) : null}
    </section>
  );
}

function TopOfMind(props: {
  readonly items: ReadonlyArray<AldoBriefItem>;
  readonly decisions: ReadonlyArray<AldoDecision> | null;
}) {
  const mobile = useIsMobile();
  const { decisions } = props;
  const shown = new Set(props.items.map((i) => i.key));
  const more = decisions ? decisions.filter((d) => !shown.has(d.key)).length : 0;
  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/40">
      <h3 className="border-border/60 border-b px-4 pt-3 pb-2 font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
        Top of mind
      </h3>
      <ul className="divide-y divide-border/60">
        {props.items.map((item) =>
          decisions === null ? (
            <li key={item.key} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="size-7 rounded-lg" />
              <Skeleton className="h-4 flex-1" />
            </li>
          ) : (
            <TopRow
              key={item.key}
              item={item}
              decision={decisions.find((d) => d.key === item.key) ?? null}
            />
          ),
        )}
      </ul>
      <div className="flex items-center gap-2 border-border/60 border-t px-4 py-2.5 text-muted-foreground text-sm">
        {more > 0 ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 hover:text-foreground"
            onClick={() => (mobile ? setAldoHomeView("agents") : undefined)}
            disabled={!mobile}
          >
            {more === 1 ? "1 more waits on you" : `${more} more wait on you`}
            {mobile ? <ChevronRightIcon className="size-3.5" /> : null}
          </button>
        ) : (
          <>
            <CheckIcon className="size-4 text-primary" />
            That's everything for now
          </>
        )}
      </div>
    </div>
  );
}

function TopRow(props: { readonly item: AldoBriefItem; readonly decision: AldoDecision | null }) {
  const peek = useContext(AldoPeekerContext);
  const [busy, setBusy] = useState(false);
  const d = props.decision;
  const { item } = props;
  if (!d) {
    return (
      <li className="flex items-center gap-3 px-4 py-3 text-muted-foreground">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-success/12">
          <CheckIcon className="size-3.5 text-success-foreground" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm line-through decoration-muted-foreground/50">
          {item.title ?? "Decided"}
        </span>
        <span className="shrink-0 text-xs">Done</span>
      </li>
    );
  }
  const quick = quickChoice(d, item.suggestion);
  const target = peekOfDecision(d);
  // A question leads with what it asks, so its line names the thread.
  const sub =
    d.kind === "question" && item.suggestion
      ? `Aldo suggests ${item.suggestion}${item.reason ? `: ${item.reason}` : ""}`
      : (item.why ?? (d.kind === "question" ? decisionTitle(d) : decisionAsk(d)));
  const title =
    d.kind === "question"
      ? (d.pending.questions[0]?.question ?? decisionTitle(d))
      : decisionTitle(d);
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        disabled={!target || !peek}
        onClick={() => (target ? peek?.(target) : undefined)}
      >
        <DecisionIcon decision={d} />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 font-medium text-sm">{title}</span>
          <span className="block truncate text-muted-foreground text-xs">{sub}</span>
        </span>
      </button>
      {quick ? (
        <Button
          size="sm"
          variant={quick.primary ? "default" : "outline"}
          className="shrink-0"
          disabled={busy}
          onClick={() => {
            void (async () => {
              if (!(await confirmQuickChoice(d))) return;
              setBusy(true);
              await decideAldo(d, quick.choice);
              setBusy(false);
            })();
          }}
        >
          {busy ? <LoaderCircleIcon className="animate-spin" /> : quick.label}
        </Button>
      ) : target && peek ? (
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      ) : null}
    </li>
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
    <Button
      size="sm"
      variant="outline"
      className="rounded-full"
      aria-label={state === "playing" ? "Pause the brief" : "Listen to the brief"}
      onClick={toggle}
    >
      {state === "loading" ? (
        <LoaderCircleIcon className="animate-spin" />
      ) : state === "playing" ? (
        <PauseIcon />
      ) : (
        <PlayIcon />
      )}
      {label}
    </Button>
  );
}
