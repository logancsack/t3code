// What the line under Aldo's name says at the top of the conversation
// (AldoPresence.tsx), the way a messaging app says someone is typing: what
// Aldo is doing on a call or in writing, else that it couldn't check (the
// home read failed before anything was read), else how many things need the
// user and how many agents work, else what its agents are at, else what waits
// on the user. Pure, so it's tested on its own.

import type { AldoAssistantPhase } from "./assistant.logic";
import type { AldoHomeConversation } from "./cloud";

/**
 * What Aldo's halo shows (AldoHalo.tsx): at rest (or its agents working, which
 * the line says), thinking, listening or speaking.
 */
export type AldoMood = "idle" | "working" | "thinking" | "listening" | "speaking";

/** The halo's mood for where a conversation with Aldo is. */
export function phaseMood(phase: AldoAssistantPhase): AldoMood {
  if (phase === "connecting" || phase === "thinking") return "thinking";
  if (phase === "listening" || phase === "hearing") return "listening";
  if (phase === "speaking") return "speaking";
  return "idle";
}

export function presenceLine(input: {
  readonly phase: AldoAssistantPhase;
  readonly replying: boolean;
  /** What's working now, newest first. */
  readonly working: ReadonlyArray<Pick<AldoHomeConversation, "title" | "browsing">>;
  readonly waiting: number;
  /** Nothing's been read: what's waiting and working isn't known. */
  readonly unread?: boolean;
}): { readonly text: string; readonly mood: AldoMood } {
  const { phase } = input;
  if (phase === "listening" || phase === "hearing")
    return { text: "Listening…", mood: "listening" };
  if (phase === "speaking") return { text: "Talking", mood: "speaking" };
  if (phase === "thinking" || phase === "connecting" || input.replying)
    return { text: "Typing…", mood: "thinking" };
  if (input.unread) return { text: "Couldn't check on your agents", mood: "idle" };
  const [first] = input.working;
  // Both: what needs the user leads, beside the dot that says so.
  if (first && input.waiting > 0)
    return {
      text: `${input.waiting} need${input.waiting === 1 ? "s" : ""} you · ${input.working.length} working`,
      mood: "working",
    };
  if (first) {
    const doing = first.browsing ? `On ${first.browsing.site}` : first.title;
    const more = input.working.length - 1;
    return { text: more > 0 ? `${doing} · ${more} more working` : doing, mood: "working" };
  }
  if (input.waiting > 0)
    return {
      text: input.waiting === 1 ? "1 thing needs you" : `${input.waiting} things need you`,
      mood: "idle",
    };
  return { text: "All caught up", mood: "idle" };
}
