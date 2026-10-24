// The Home presence label and A-frame state, derived from existing activity.
import type { AldoAssistantPhase } from "./assistant.logic";
import type { AldoHomeConversation } from "./homeApi";

export type AldoPresenceState =
  | "idle"
  | "connecting"
  | "working"
  | "thinking"
  | "listening"
  | "speaking"
  | "reading"
  | "success"
  | "acknowledgement"
  | "needs-you"
  | "error";

export function presenceState(
  state: AldoPresenceState,
  reactions: { readonly reading: boolean; readonly success: boolean },
): AldoPresenceState {
  if (["connecting", "listening", "speaking", "thinking", "error"].includes(state)) return state;
  if (reactions.success) return "success";
  if (reactions.reading) return "reading";
  return state;
}

export function voicePresenceState(phase: AldoAssistantPhase): AldoPresenceState {
  return phase === "hearing" ? "listening" : phase;
}

export function presenceLine(input: {
  readonly phase: AldoAssistantPhase;
  readonly replying: boolean;
  /** What's working now, newest first. */
  readonly working: ReadonlyArray<Pick<AldoHomeConversation, "title" | "browsing">>;
  readonly waiting: number;
  /** Nothing's been read: what's waiting and working isn't known. */
  readonly unread?: boolean;
}): { readonly text: string; readonly state: AldoPresenceState } {
  const { phase } = input;
  if (phase === "listening" || phase === "hearing")
    return { text: "Listening…", state: "listening" };
  if (phase === "speaking") return { text: "Talking", state: "speaking" };
  if (phase === "connecting") return { text: "Connecting…", state: "connecting" };
  if (phase === "thinking" || input.replying) return { text: "Typing…", state: "thinking" };
  if (phase === "error") return { text: "Tap to talk again", state: "error" };
  if (input.unread) return { text: "Couldn't check on your agents", state: "error" };
  const [first] = input.working;
  // Both: what needs the user leads, beside the dot that says so.
  if (first && input.waiting > 0)
    return {
      text: `${input.waiting} need${input.waiting === 1 ? "s" : ""} you · ${input.working.length} working`,
      state: "needs-you",
    };
  // One is what it's doing; more is how many, each in the menu (a title would hide the count).
  if (input.working.length > 1)
    return { text: `${input.working.length} working`, state: "working" };
  if (first)
    return { text: first.browsing ? `On ${first.browsing.site}` : first.title, state: "working" };
  if (input.waiting > 0)
    return {
      text: input.waiting === 1 ? "1 thing needs you" : `${input.waiting} things need you`,
      state: "needs-you",
    };
  return { text: "All caught up", state: "idle" };
}
