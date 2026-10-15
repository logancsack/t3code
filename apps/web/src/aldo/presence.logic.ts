// What Aldo's face says under its name at the top of the conversation
// (AldoPresence.tsx), the way a messaging app says someone is typing: what
// Aldo is doing on a call or in writing, else what its agents are at, else
// what waits on the user. Pure, so it's tested on its own.

import type { AldoAssistantPhase } from "./assistant.logic";
import type { AldoHomeConversation } from "./cloud";

/** How Aldo's eyes move: still, looking about while agents work, up while it thinks. */
export type AldoMood = "idle" | "working" | "thinking" | "listening" | "speaking";

export function presenceLine(input: {
  readonly phase: AldoAssistantPhase;
  readonly replying: boolean;
  /** What's working now, newest first. */
  readonly working: ReadonlyArray<Pick<AldoHomeConversation, "title" | "browsing">>;
  readonly waiting: number;
}): { readonly text: string; readonly mood: AldoMood } {
  const { phase } = input;
  if (phase === "listening" || phase === "hearing")
    return { text: "Listening…", mood: "listening" };
  if (phase === "speaking") return { text: "Talking", mood: "speaking" };
  if (phase === "thinking" || phase === "connecting" || input.replying)
    return { text: "Typing…", mood: "thinking" };
  const [first] = input.working;
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
