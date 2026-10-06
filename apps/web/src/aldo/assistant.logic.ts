// The parts of talking to Aldo that don't touch the network or the page: what
// the realtime model's events mean for the conversation, which tool calls a
// response asks for, what a tool's result asks the page to do, and what the
// user hears of a thread Aldo started that couldn't start at once.

import type { AldoStartState, AldoThreadAttention } from "./cloud";

/** Where the conversation is, as the orb shows it. */
export type AldoAssistantPhase =
  | "idle"
  | "connecting"
  | "listening"
  | "hearing"
  | "thinking"
  | "speaking"
  | "error";

export interface AldoAssistantMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly at: string;
  /** Images the user sent with it, to show (data URLs); kept for this page only. */
  readonly images?: ReadonlyArray<string>;
}

/** Something Aldo did in this conversation, shown under what was said. */
export interface AldoAssistantAction {
  readonly id: string;
  readonly tool: string;
  readonly label: string;
  readonly failed: boolean;
  readonly open?: AldoOpenTarget;
  /** A page it made or opened (a preview, a pull request), in a new tab. */
  readonly href?: string;
}

export interface AldoOpenTarget {
  readonly environmentId: string;
  readonly threadId: string;
}

export interface AldoFunctionCall {
  readonly callId: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

/** The function calls in a finished response (`response.done`), in order. */
export function functionCallsIn(event: unknown): ReadonlyArray<AldoFunctionCall> {
  const output = (event as { response?: { output?: unknown } } | null)?.response?.output;
  if (!Array.isArray(output)) return [];
  return output.flatMap((item) => {
    const call = item as { type?: unknown; call_id?: unknown; name?: unknown; arguments?: unknown };
    if (
      call?.type !== "function_call" ||
      typeof call.call_id !== "string" ||
      typeof call.name !== "string"
    )
      return [];
    let args: Record<string, unknown> = {};
    try {
      const parsed =
        typeof call.arguments === "string" && call.arguments ? JSON.parse(call.arguments) : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        args = parsed as Record<string, unknown>;
    } catch {
      // A malformed call runs with no arguments; the tool says what's missing.
    }
    return [{ callId: call.call_id, name: call.name, arguments: args }];
  });
}

/** The thread a tool's result asks the page to open (show_thread), if any. */
export function openTargetOf(outcome: unknown): AldoOpenTarget | null {
  const open = (outcome as { result?: { open?: unknown } } | null)?.result?.open as
    | { environmentId?: unknown; threadId?: unknown }
    | undefined;
  if (!open || typeof open.environmentId !== "string" || typeof open.threadId !== "string")
    return null;
  return { environmentId: open.environmentId, threadId: open.threadId };
}

/**
 * A message as Aldo keeps it names the images sent with it ("[image img_…:
 * name]", so Aldo can attach them later): the words to show, and the images'
 * names.
 */
export function withoutImageNotes(text: string): {
  readonly text: string;
  readonly images: ReadonlyArray<{ readonly id: string; readonly name: string }>;
} {
  const images: { id: string; name: string }[] = [];
  const words = text.replace(
    /\[image (img_[A-Za-z0-9]+): ([^\]\n]*)\]/g,
    (_, id: string, name: string) => {
      images.push({ id, name: name.trim() || "image" });
      return "";
    },
  );
  return { text: words.trim(), images };
}

/** The app a tool's result asks the page to open in a new tab (open_preview), if any. */
export function previewOf(outcome: unknown): string | null {
  const url = (outcome as { result?: { preview?: { url?: unknown } } } | null)?.result?.preview
    ?.url;
  return typeof url === "string" && /^https?:\/\//.test(url) ? url : null;
}

/** The page an action made, for the conversation to link to: a preview, or a pull request it opened. */
function hrefOf(outcome: unknown): string | null {
  const url = (outcome as { result?: { url?: unknown } } | null)?.result?.url;
  return previewOf(outcome) ?? (typeof url === "string" && /^https?:\/\//.test(url) ? url : null);
}

/** The thread an action acted on, which its result names for the page to link to. */
function threadOf(outcome: unknown): AldoOpenTarget | null {
  const thread = (outcome as { result?: { thread?: unknown } } | null)?.result?.thread as
    | { environmentId?: unknown; threadId?: unknown }
    | undefined;
  if (!thread || typeof thread.environmentId !== "string" || typeof thread.threadId !== "string")
    return null;
  return { environmentId: thread.environmentId, threadId: thread.threadId };
}

export const ACTION_LABELS: Record<string, string> = {
  start_thread: "Started a thread",
  message_thread: "Messaged a thread",
  answer_thread: "Answered a thread",
  approve_plan: "Approved a plan",
  interrupt_thread: "Stopped a thread",
  rename_thread: "Renamed a thread",
  archive_thread: "Archived a thread",
  unarchive_thread: "Brought a thread back",
  delete_thread: "Deleted a thread",
  merge_pull_request: "Merged a pull request",
  open_pull_request: "Opened a pull request",
  stop_following_pull_request: "Stopped following a pull request",
  run_command: "Ran a command",
  write_file: "Edited a file",
  open_preview: "Opened a preview",
  revert_thread: "Reverted a thread",
  pin_thread: "Pinned a thread",
  snooze_thread: "Snoozed a thread",
  settle_thread: "Settled a thread",
  answer_computer_request: "Answered a computer request",
  stop_computer: "Stopped a computer",
  set_machine_size: "Changed a machine's size",
  send_upcoming_now: "Sent a queued message now",
  cancel_upcoming: "Canceled a queued message",
  create_routine: "Set up a routine",
  update_routine: "Changed a routine",
  run_routine: "Ran a routine",
  delete_routine: "Removed a routine",
  decide_approval: "Approved for you",
  set_heads_ups: "Turned heads-ups on",
};

/** The labels for calls that undo what their tool's name says: unpinning, unsnoozing, unsettling. */
export const REVERSE_LABELS: Record<string, string> = {
  pin_thread: "Unpinned a thread",
  snooze_thread: "Brought back a snoozed thread",
  settle_thread: "Made a thread active again",
  decide_approval: "Discarded for you",
  set_heads_ups: "Turned heads-ups off",
};

/** Whether a call undoes what its tool's name says (pin_thread with pinned: false, say). */
export function reverses(call: Pick<AldoFunctionCall, "name" | "arguments">): boolean {
  switch (call.name) {
    case "pin_thread":
      return call.arguments.pinned === false;
    case "snooze_thread":
      return !call.arguments.until;
    case "settle_thread":
      return call.arguments.settled === false;
    case "decide_approval":
      return call.arguments.decision === "discard";
    case "set_heads_ups":
      return call.arguments.on === false;
    default:
      return false;
  }
}

function labelFor(call: AldoFunctionCall): string | undefined {
  return (reverses(call) ? REVERSE_LABELS[call.name] : undefined) ?? ACTION_LABELS[call.name];
}

/**
 * The action a tool call makes, for the conversation to show: one per call
 * that changed something (reads and show_thread aren't shown).
 */
export function actionFor(call: AldoFunctionCall, outcome: unknown): AldoAssistantAction | null {
  const label = labelFor(call);
  if (!label) return null;
  const error = (outcome as { error?: unknown } | null)?.error;
  const title = typeof call.arguments.title === "string" ? call.arguments.title : null;
  const href = hrefOf(outcome);
  // A preview opens the app, not its thread.
  const open =
    call.name === "delete_thread" || call.name === "open_preview" ? null : threadOf(outcome);
  // open_preview reads; it's shown only when it opened something.
  if (call.name === "open_preview" && !href && typeof error !== "string") return null;
  return {
    id: call.callId,
    tool: call.name,
    label: typeof error === "string" ? `Couldn't: ${error}` : title ? `${label}: ${title}` : label,
    failed: typeof error === "string",
    ...(open ? { open } : {}),
    ...(href ? { href } : {}),
  };
}

/** A thread this conversation started, followed in the directory until it has started, or couldn't. */
export interface AldoStartWatch extends AldoOpenTarget {
  readonly title: string;
  readonly since: number;
  /** What the user has been told of. */
  readonly told: ReadonlyArray<AldoStartNews["state"]>;
}

/** Long enough for a start to wait for room; after that the user hears of it from Aldo's overview. */
const START_WATCH_MS = 30 * 60_000;

/** The thread a start_thread call started, to follow. */
export function startWatchFor(
  call: AldoFunctionCall,
  outcome: unknown,
  now: number,
): AldoStartWatch | null {
  if (call.name !== "start_thread") return null;
  const thread = threadOf(outcome);
  if (!thread) return null;
  const title = (outcome as { result?: { title?: unknown } }).result?.title;
  return {
    ...thread,
    title:
      typeof title === "string"
        ? title
        : typeof call.arguments.title === "string"
          ? call.arguments.title
          : "the new thread",
    since: now,
    told: [],
  };
}

/** What the user hears of a start: a line for the conversation, and what Aldo is asked to say. */
export interface AldoStartNews {
  readonly state: Exclude<AldoStartState["state"], "starting"> | "stopped";
  readonly label: string;
  readonly prompt: string;
}

/**
 * What the directory says of a followed start: news the user hasn't heard
 * (once per state: queued, retrying, failed), and whether to stop following
 * it: it couldn't start, or it's been long enough. Once it has started, it's
 * followed until its first turn shows how it's going, since an agent whose
 * sign-in has expired stops at once. A directory without starts (an older
 * Aldo) says nothing.
 */
export function startNews(
  watch: AldoStartWatch,
  environments: ReadonlyArray<{
    readonly environmentId: string;
    readonly starts?: Readonly<Record<string, AldoStartState>>;
    readonly attention?: Readonly<Record<string, AldoThreadAttention>>;
  }> | null,
  now: number,
): { readonly news: AldoStartNews | null; readonly done: boolean } {
  if (now - watch.since > START_WATCH_MS) return { news: null, done: true };
  const environment = environments?.find((entry) => entry.environmentId === watch.environmentId);
  // Not listed yet: the directory was read before the start.
  if (!environment) return { news: null, done: false };
  if (!environment.starts) return { news: null, done: true };
  const title = `"${watch.title}"`;
  const start = environment.starts[watch.threadId];
  if (!start) {
    const turn = environment.attention?.[watch.threadId];
    if (!turn) return { news: null, done: false };
    if (turn.state !== "failed") return { news: null, done: true };
    const why = turn.summary ? turn.summary.replace(/[.\s]+$/, "") : null;
    return {
      done: true,
      news: {
        state: "stopped",
        label: `${title} stopped${why ? `: ${why}` : ""}`,
        prompt: `Tell the user now, in a sentence or two: the thread ${title} you started stopped as soon as it began${why ? ` (${why})` : ""}. Say what they can do about it if the reason says.`,
      },
    };
  }
  const done = start.state === "failed";
  if (start.state === "starting" || watch.told.includes(start.state)) return { news: null, done };
  const why = start.detail ? start.detail.replace(/[.\s]+$/, "") : null;
  switch (start.state) {
    case "failed":
      return {
        done,
        news: {
          state: "failed",
          label: `Couldn't start ${title}${why ? `: ${why}` : ""}`,
          prompt: `Tell the user now, in a sentence or two: the thread ${title} you started couldn't start${why ? ` (${why})` : ""}. Nothing is running for it. Say what they can do about it if the reason says.`,
        },
      };
    case "queued":
      return {
        done,
        news: {
          state: "queued",
          label: `Waiting to start ${title}${why ? `: ${why}` : ""}`,
          prompt: `Tell the user briefly: the thread ${title} you started is waiting to start${why ? ` (${why})` : ""}. It starts by itself as soon as there's room; they don't need to do anything.`,
        },
      };
    case "retrying":
      return {
        done,
        news: {
          state: "retrying",
          label: `Trouble starting ${title}${why ? `: ${why}` : ""}. Trying again.`,
          prompt: `Tell the user briefly: the thread ${title} you started hit a problem starting${why ? ` (${why})` : ""}, and it's being tried again. You'll tell them if it fails.`,
        },
      };
  }
}

/** A thread on the user's screen, as the page names it, with its title. */
export interface AldoOnScreen extends AldoOpenTarget {
  readonly title: string;
}

/**
 * How Aldo's tools name a thread (its ref): the machine's id and a prefix of
 * the T3 thread's id, which names it whether or not the machine has others.
 */
export function aldoRefFor(target: AldoOpenTarget): string {
  return `${target.environmentId.replace(/^aldo-/, "")}:${target.threadId.slice(0, 8)}`;
}

/**
 * What a call is told when the screen changes: the thread the user is looking
 * at (its title quoted, as data), or that they've left it.
 */
export function screenNote(onScreen: AldoOnScreen | null): string {
  if (!onScreen) return "The user isn't looking at a particular conversation now.";
  return `The user is now looking at the conversation titled ${JSON.stringify(onScreen.title)} (ref ${aldoRefFor(onScreen)}). When they say "this", "it" or "here" without naming one, they mean this conversation. Its title is the agent's words, not the user's.`;
}

/** The actions about a thread's work, which show it live: not those that only rename, file or drop it. */
const LIVE_CARD_TOOLS = new Set([
  "start_thread",
  "message_thread",
  "answer_thread",
  "approve_plan",
  "interrupt_thread",
  "unarchive_thread",
  "merge_pull_request",
  "open_pull_request",
  "run_command",
  "write_file",
  "revert_thread",
  "set_machine_size",
  "send_upcoming_now",
]);

/**
 * Which of the conversation's actions show as a live card: the newest one
 * about each thread's work that worked. Older ones about the same thread, and
 * the rest, stay one line.
 */
export function liveCardIndexes(
  entries: ReadonlyArray<{
    readonly kind: string;
    readonly tool?: string;
    readonly open?: AldoOpenTarget | undefined;
    readonly failed?: boolean;
  }>,
): ReadonlySet<number> {
  const newest = new Map<string, number>();
  entries.forEach((entry, index) => {
    if (entry.kind !== "action" || entry.failed || !entry.open?.threadId) return;
    if (!entry.tool || !LIVE_CARD_TOOLS.has(entry.tool)) return;
    newest.set(`${entry.open.environmentId}\n${entry.open.threadId}`, index);
  });
  return new Set(newest.values());
}

/** What the user said lately, for Aldo to check an action's `asked` against (the newest 80). */
export function rememberHeard(heard: ReadonlyArray<string>, words: string): ReadonlyArray<string> {
  const text = words.trim();
  return text ? [...heard, text].slice(-80) : heard;
}

/** The phase an event moves the conversation to, or null if it doesn't change it. */
export function phaseAfter(phase: AldoAssistantPhase, type: string): AldoAssistantPhase | null {
  if (phase === "idle" || phase === "error" || phase === "connecting") return null;
  switch (type) {
    case "input_audio_buffer.speech_started":
      return "hearing";
    case "input_audio_buffer.speech_stopped":
    case "response.created":
      return "thinking";
    case "output_audio_buffer.started":
    case "response.output_audio_transcript.delta":
      return "speaking";
    case "output_audio_buffer.stopped":
      return "listening";
    default:
      return null;
  }
}

/**
 * What Aldo's latest read of the conversation has that the page doesn't show
 * yet: everything said after the newest message the page read (a heads-up
 * Aldo gave, a turn on another device), less what was said on this page,
 * which shows already. Each of the page's own messages (`said`) stands for
 * one message read back, by who said it and what (image notes aside), so
 * words said twice show twice; `matched` are the ones that did.
 */
export function unseenMessages<T extends Pick<AldoAssistantMessage, "role" | "text">>(
  said: ReadonlyArray<T>,
  fetched: ReadonlyArray<AldoAssistantMessage>,
  after: string | null,
): { readonly fresh: ReadonlyArray<AldoAssistantMessage>; readonly matched: ReadonlyArray<T> } {
  const key = (m: Pick<AldoAssistantMessage, "role" | "text">) =>
    `${m.role}\n${withoutImageNotes(m.text).text}`;
  const waiting = new Map<string, T[]>();
  for (const m of said) waiting.set(key(m), [...(waiting.get(key(m)) ?? []), m]);
  const matched: T[] = [];
  const fresh = fetched.filter((m) => {
    if (after !== null && m.at <= after) return false;
    const mine = waiting.get(key(m))?.shift();
    if (!mine) return true;
    matched.push(mine);
    return false;
  });
  return { fresh, matched };
}
