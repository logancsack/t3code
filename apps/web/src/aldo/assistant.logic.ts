// The parts of talking to Aldo that don't touch the network or the page: what
// the realtime model's events mean for the conversation, which tool calls a
// response asks for, and what a tool's result asks the page to do.

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
}

/** Something Aldo did in this conversation, shown under what was said. */
export interface AldoAssistantAction {
  readonly id: string;
  readonly tool: string;
  readonly label: string;
  readonly failed: boolean;
  readonly open?: AldoOpenTarget;
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

/** The thread an action acted on, which its result names for the page to link to. */
function threadOf(outcome: unknown): AldoOpenTarget | null {
  const thread = (outcome as { result?: { thread?: unknown } } | null)?.result?.thread as
    | { environmentId?: unknown; threadId?: unknown }
    | undefined;
  if (!thread || typeof thread.environmentId !== "string" || typeof thread.threadId !== "string")
    return null;
  return { environmentId: thread.environmentId, threadId: thread.threadId };
}

const ACTION_LABELS: Record<string, string> = {
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
};

/**
 * The action a tool call makes, for the conversation to show: one per call
 * that changed something (reads and show_thread aren't shown).
 */
export function actionFor(call: AldoFunctionCall, outcome: unknown): AldoAssistantAction | null {
  const label = ACTION_LABELS[call.name];
  if (!label) return null;
  const error = (outcome as { error?: unknown } | null)?.error;
  const title = typeof call.arguments.title === "string" ? call.arguments.title : null;
  const open = call.name === "delete_thread" ? null : threadOf(outcome);
  return {
    id: call.callId,
    tool: call.name,
    label: typeof error === "string" ? `Couldn't: ${error}` : title ? `${label}: ${title}` : label,
    failed: typeof error === "string",
    ...(open ? { open } : {}),
  };
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
