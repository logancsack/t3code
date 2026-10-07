// A call with Aldo on a phone, full screen: the orb, what Aldo is saying (its
// last sentence lighter, as it trails off or is still coming), what it did on
// this call, and mute, type and end. Folded away (the chevron) the call goes
// on: the page's composer has mute and hang up, and its mic button (or the
// capsule elsewhere) brings the screen back. Going through decisions with
// Aldo (walkthrough.ts) shows here too, on any screen (a panel on a wide
// one): which one is up, its choices to tap, skipping it, and its thread.
// Mounted once at the root, by AldoAssistantDock.tsx.

import { useLocation, useNavigate } from "@tanstack/react-router";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  ArrowUpRightIcon,
  CheckIcon,
  ChevronDownIcon,
  KeyboardIcon,
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
  Volume2Icon,
  VolumeXIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { requestConfirmDialog } from "../confirmDialog";
import { useIsMobile } from "../hooks/useMediaQuery";
import { cn } from "~/lib/utils";
import { AldoOrb } from "./AldoAssistant";
import { DecisionIcon } from "./AldoBrief";
import { PendingForm } from "./AldoHomeInbox";
import { openAldoSummon } from "./AldoSummon";
import { callDuration, captionParts } from "./assistant.logic";
import {
  disconnectAldo,
  seedAldoComposer,
  setAldoMuted,
  setAldoVoiceOff,
  useAldoAssistant,
} from "./assistantSession";
import { choiceWords, decideAldo, type AldoChoice } from "./decide";
import {
  decisionAsk,
  decisionOpen,
  decisionThread,
  decisionTitle,
  type AldoDecision,
} from "./decisions.logic";
import { minimizeAldoCall, useAldoCallView } from "./callView";
import { useAldoHomeFeed } from "./homeFeed";
import { advanceAldoWalkthrough, stopAldoWalkthrough, useAldoWalkthrough } from "./walkthrough";

function useTicking(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [on]);
  return now;
}

export function AldoCallScreen() {
  const mobile = useIsMobile();
  const phase = useAldoAssistant((s) => s.phase);
  const minimized = useAldoCallView((s) => s.minimized);
  const walking = useAldoWalkthrough((s) => s.active);
  const live = phase !== "idle" && phase !== "error";

  if (!live) return null;
  if (mobile && !minimized) return <CallScreen mobile />;
  if (!mobile && walking) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm">
        <div className="flex h-[min(46rem,92dvh)] w-full max-w-md overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl">
          <CallScreen mobile={false} />
        </div>
      </div>
    );
  }
  return null;
}

function CallScreen(props: { readonly mobile: boolean }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const phase = useAldoAssistant((s) => s.phase);
  const said = useAldoAssistant((s) => s.said);
  const error = useAldoAssistant((s) => s.error);
  const muted = useAldoAssistant((s) => s.muted);
  const micOn = useAldoAssistant((s) => s.micOn);
  const voiceOff = useAldoAssistant((s) => s.voiceOff);
  const connectedAt = useAldoAssistant((s) => s.connectedAt);
  const entries = useAldoAssistant((s) => s.entries);
  const walk = useAldoWalkthrough();
  const home = useAldoHomeFeed((s) => s.home);
  const now = useTicking(true);

  // What was said and done since this call connected.
  const callFrom = useAldoAssistant((s) => s.callFrom);
  const thisCall = connectedAt === null ? [] : entries.slice(callFrom);
  const lastSaid = thisCall.findLast((e) => e.kind === "message" && e.role === "assistant");
  const actions = thisCall.filter((e) => e.kind === "action").slice(-3);

  const current = walk.active ? (walk.decisions[walk.index] ?? null) : null;
  const finished = walk.active && walk.index >= walk.decisions.length;

  // Decided out loud (Aldo acted) or elsewhere: once it's left the home read, the next one comes up.
  useEffect(() => {
    if (!current || !home) return;
    if (!decisionOpen(home, current.key, Date.now())) advanceAldoWalkthrough("decided");
  }, [current, home]);

  const words =
    phase === "speaking" && said
      ? said
      : lastSaid?.kind === "message"
        ? lastSaid.text
        : phase === "connecting"
          ? "Connecting…"
          : "";
  // Going through them, the latest two sentences: the decision's card has the rest of the screen.
  const { lead, tail } = captionParts(words, walk.active ? 2 : Infinity);
  const status =
    phase === "connecting"
      ? "Connecting…"
      : muted
        ? "Muted"
        : phase === "hearing"
          ? "Listening…"
          : phase === "thinking"
            ? "Thinking…"
            : `On a call${connectedAt ? ` · ${callDuration(now - connectedAt)}` : ""}`;

  const type = () => {
    if (props.mobile) minimizeAldoCall();
    else stopAldoWalkthrough("The user went to type instead; stop going through them.");
    if (pathname === "/") seedAldoComposer("");
    else openAldoSummon();
  };
  const openThread = (decision: AldoDecision) => {
    const target = decisionThread(decision);
    stopAldoWalkthrough(
      "The user went to look at that thread themselves: stop going through them for now.",
    );
    if (props.mobile) minimizeAldoCall();
    if (target)
      void navigate({
        to: "/$environmentId/$threadId",
        params: {
          environmentId: target.environmentId as EnvironmentId,
          threadId: target.threadId as ThreadId,
        },
      });
  };

  return (
    <section
      aria-label="Call with Aldo"
      className={cn(
        "flex h-full w-full flex-col bg-background text-foreground",
        // Over the sidebar's floating button too.
        props.mobile && "fixed inset-0 z-[60] h-dvh pt-[env(safe-area-inset-top)]",
      )}
      data-aldo-call-screen=""
    >
      <header className="flex shrink-0 items-center gap-2 px-3 pt-2 pb-1">
        {props.mobile ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back to the page (the call goes on)"
            onClick={minimizeAldoCall}
          >
            <ChevronDownIcon />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Stop going through them (the call goes on)"
            onClick={() =>
              stopAldoWalkthrough("The user stopped going through them; carry on as before.")
            }
          >
            <XIcon />
          </Button>
        )}
        <div className="flex min-w-0 flex-1 flex-col items-center leading-tight">
          <span className="font-semibold text-sm">Aldo</span>
          <span className="flex items-center gap-1.5 text-success-foreground text-xs">
            <span aria-hidden className="size-1.5 rounded-full bg-success" />
            {status}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={voiceOff ? "Turn Aldo's voice on" : "Turn Aldo's voice off"}
          aria-pressed={voiceOff}
          onClick={() => setAldoVoiceOff(!voiceOff)}
        >
          {voiceOff ? <VolumeXIcon /> : <Volume2Icon />}
        </Button>
      </header>

      {walk.active && walk.decisions.length > 0 ? (
        <div className="flex shrink-0 flex-col items-center gap-1.5 px-6 pt-1">
          <div className="flex w-full gap-1.5" aria-hidden>
            {walk.decisions.map((d, i) => (
              <span
                key={d.key}
                className={cn(
                  "h-1 flex-1 rounded-full",
                  i <= walk.index ? "bg-primary" : "bg-muted",
                )}
              />
            ))}
          </div>
          <p className="max-w-full truncate text-muted-foreground text-xs">
            {finished
              ? "That's everything for now"
              : `${walk.index + 1} of ${walk.decisions.length} · ${current ? decisionTitle(current) : ""}`}
          </p>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6">
        <div
          className={cn(
            "flex shrink-0 items-center justify-center",
            walk.active ? (props.mobile ? "pt-6 pb-4" : "pt-3 pb-3") : "flex-1 pt-10 pb-6",
          )}
        >
          <AldoOrb size={walk.active ? "lg" : "xl"} display />
        </div>
        <p
          className={cn(
            "max-w-md text-center leading-snug",
            walk.active ? (props.mobile ? "text-lg" : "text-base") : "text-2xl",
          )}
          aria-live="polite"
        >
          {lead}
          {tail ? <span className="text-muted-foreground"> {tail}</span> : null}
        </p>
        {/* What went wrong (a blocked microphone): the call goes on, typed. */}
        {error ? (
          <p className="mt-2 max-w-md text-center text-destructive-foreground text-xs">{error}</p>
        ) : null}
        {current ? (
          <WalkCard
            key={current.key}
            decision={current}
            suggestion={walk.suggestions[current.key] ?? null}
            onOpen={() => openThread(current)}
          />
        ) : finished ? (
          <div className="mt-6 flex items-center gap-2 text-muted-foreground text-sm">
            <CheckIcon className="size-4 text-success-foreground" />
            That's everything for now
          </div>
        ) : actions.length > 0 ? (
          <ul className="mt-auto flex w-full max-w-md flex-col gap-2 pt-6 pb-2">
            {actions.map((a) =>
              a.kind === "action" ? (
                <li
                  key={a.id}
                  className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card/40 px-3 py-2.5 text-sm"
                >
                  {a.failed ? (
                    <XIcon className="size-4 shrink-0 text-destructive-foreground" />
                  ) : (
                    <CheckIcon className="size-4 shrink-0 text-success-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{a.label}</span>
                </li>
              ) : null,
            )}
          </ul>
        ) : null}
      </div>

      <footer className="flex shrink-0 items-start justify-center gap-8 px-6 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <RoundButton
          label={muted ? "Unmute" : "Mute"}
          disabled={!micOn}
          pressed={muted}
          onClick={() => setAldoMuted(!muted)}
        >
          {muted ? <MicOffIcon /> : <MicIcon />}
        </RoundButton>
        <RoundButton label="Type" onClick={type}>
          <KeyboardIcon />
        </RoundButton>
        <RoundButton
          label="End"
          tone="end"
          onClick={() => {
            stopAldoWalkthrough();
            disconnectAldo();
          }}
        >
          <PhoneOffIcon />
        </RoundButton>
      </footer>
    </section>
  );
}

function RoundButton(props: {
  readonly label: string;
  readonly children: ReactNode;
  readonly onClick: () => void;
  readonly tone?: "end";
  readonly disabled?: boolean;
  readonly pressed?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        aria-label={props.label}
        {...(props.pressed !== undefined ? { "aria-pressed": props.pressed } : {})}
        disabled={props.disabled}
        onClick={props.onClick}
        className={cn(
          "flex size-16 items-center justify-center rounded-full border transition-colors disabled:opacity-40 [&_svg]:size-6",
          props.tone === "end"
            ? "border-transparent bg-destructive text-white hover:bg-destructive/90"
            : props.pressed
              ? "border-transparent bg-foreground text-background"
              : "border-border bg-card hover:bg-accent",
        )}
      >
        {props.children}
      </button>
      <span className="text-muted-foreground text-xs">{props.label}</span>
    </div>
  );
}

/** The decision that's up, with its choices to tap ("Say it, or tap"). */
function WalkCard(props: {
  readonly decision: AldoDecision;
  readonly suggestion: string | null;
  readonly onOpen: () => void;
}) {
  const d = props.decision;
  const [busy, setBusy] = useState<string | null>(null);
  const choose = async (id: string, choice: AldoChoice) => {
    setBusy(id);
    const done = await decideAldo(d, choice);
    setBusy(null);
    if (done) advanceAldoWalkthrough("decided", choiceWords(d, choice));
  };
  const choices = useMemo((): ReadonlyArray<{
    id: string;
    label: string;
    choice: AldoChoice;
    primary?: boolean;
  }> => {
    switch (d.kind) {
      case "question": {
        const q = d.pending.questions[0];
        if (d.pending.questions.length !== 1 || !q || q.multiSelect) return [];
        return q.options.map((o) => ({
          id: o.label,
          label: o.label,
          choice: { kind: "answer", answers: { [q.id]: o.label } },
          primary: o.label === props.suggestion,
        }));
      }
      case "approval":
        return d.pending.options.map((o) => ({
          id: o.decision,
          label: o.label,
          choice: { kind: "decision", decision: o.decision, label: o.label },
          primary: o.decision !== "decline" && o.decision !== "cancel",
        }));
      case "plan":
        return [{ id: "plan", label: "Approve plan", choice: { kind: "plan" }, primary: true }];
      case "aldo-approval":
        return [
          {
            id: "approve",
            label: d.approval.approveLabel,
            choice: { kind: "aldo", decision: "approve" },
            primary: true,
          },
          {
            id: "discard",
            label: d.approval.discardLabel,
            choice: { kind: "aldo", decision: "discard" },
          },
        ];
      case "merge":
        return [{ id: "merge", label: "Merge", choice: { kind: "merge" }, primary: true }];
      default:
        return [];
    }
  }, [d, props.suggestion]);
  // A question the taps don't cover (several, or several choices each) is answered in full here.
  const fullForm = d.kind === "question" && choices.length === 0;
  const [words, setWords] = useState("");
  return (
    <div className="mt-6 flex w-full max-w-md flex-col gap-3 rounded-2xl border border-border/70 bg-card/40 p-4">
      <div className="flex items-start gap-2.5">
        <DecisionIcon decision={d} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-sm">{decisionTitle(d)}</p>
          <p className="line-clamp-3 text-muted-foreground text-xs">{decisionAsk(d)}</p>
        </div>
      </div>
      {d.kind === "aldo-approval" && d.approval.body ? (
        <p className="line-clamp-3 whitespace-pre-wrap rounded-lg bg-background/60 px-2.5 py-2 text-xs">
          {d.approval.body}
        </p>
      ) : null}
      {d.kind === "plan" ? (
        <p className="line-clamp-5 whitespace-pre-wrap rounded-lg bg-background/60 px-2.5 py-2 text-xs">
          {d.plan.text}
        </p>
      ) : null}
      {fullForm && d.kind === "question" ? (
        <PendingForm
          conversation={d.conversation}
          onActed={() => advanceAldoWalkthrough("decided", "answered it")}
        />
      ) : choices.length > 0 ? (
        <>
          <p className="text-muted-foreground text-xs">Say it, or tap</p>
          <div className={cn("grid gap-2", choices.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
            {choices.map((c) => (
              <Button
                key={c.id}
                size="lg"
                // A question's choices are equals (Aldo's pick is marked); elsewhere, going ahead leads.
                variant={d.kind !== "question" && c.primary ? "default" : "outline"}
                disabled={busy !== null}
                className={cn(
                  "h-11",
                  d.kind === "question" &&
                    (c.primary
                      ? "border-primary bg-primary/10 text-foreground hover:bg-primary/15"
                      : "bg-background"),
                )}
                onClick={() => {
                  if (
                    d.kind === "aldo-approval" &&
                    c.id === "discard" &&
                    d.approval.kind === "email"
                  ) {
                    void (
                      requestConfirmDialog(
                        "Discard this draft? It's deleted from your drafts, and isn't sent.",
                        { variant: "destructive" },
                      ) ?? Promise.resolve(true)
                    ).then((ok) => (ok ? choose(c.id, c.choice) : undefined));
                    return;
                  }
                  void choose(c.id, c.choice);
                }}
              >
                {busy === c.id ? "Working…" : c.label}
              </Button>
            ))}
          </div>
          {d.kind === "question" ? (
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const text = words.trim();
                if (text) void choose("words", { kind: "answer", text });
              }}
            >
              <Input
                size="sm"
                className="flex-1"
                placeholder="Or in your own words…"
                value={words}
                disabled={busy !== null}
                onChange={(event) => setWords(event.target.value)}
              />
              {words.trim() ? (
                <Button type="submit" size="sm" disabled={busy !== null}>
                  Send
                </Button>
              ) : null}
            </form>
          ) : null}
        </>
      ) : null}
      <div className="flex items-center justify-center gap-6 pt-1 text-muted-foreground text-sm">
        <button
          type="button"
          className="hover:text-foreground"
          disabled={busy !== null}
          onClick={() => advanceAldoWalkthrough("skipped")}
        >
          Skip for now
        </button>
        {decisionThread(d) ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 hover:text-foreground"
            onClick={props.onOpen}
          >
            Open the thread
            <ArrowUpRightIcon className="size-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
