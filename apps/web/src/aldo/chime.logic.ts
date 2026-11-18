// When the optional sound plays (chime.ts): a conversation in Aldo's home
// read that finished, or came to need the user, since the read before. Only
// conversations seen in that read count, so the first read and one that
// comes back with the page are only remembered; one the user put away, or
// is looking at, stays quiet. Several at once make one sound, and sounds
// come no closer than a few seconds apart.

import { type AldoHomeConversation, type AldoHomeTarget } from "./homeApi";
import { putAway } from "./decisions.logic";
import { needsYouKind, sameTarget } from "./home.logic";

/** The closest two sounds come. */
export const CHIME_GAP_MS = 5_000;

/** What the sound remembers of a conversation between reads. */
export interface ChimeSeen {
  readonly done: boolean;
  /** What it needs the user for, down to the question or plan; null when nothing. */
  readonly needs: string | null;
}

export type ChimeMemory = ReadonlyMap<string, ChimeSeen>;

/** What it needs the user for, keyed so a new question after another is news too. */
function needsKey(c: AldoHomeConversation): string | null {
  const kind = needsYouKind(c);
  if (!kind) return null;
  const which =
    c.pending && "requestId" in c.pending
      ? c.pending.requestId
      : kind === "plan" && c.plan
        ? c.plan.id
        : (c.stateAt ?? "");
  return `${kind}:${which}`;
}

export function chimeMemory(conversations: ReadonlyArray<AldoHomeConversation>): ChimeMemory {
  return new Map(
    conversations.map((c) => [c.ref, { done: c.state === "done", needs: needsKey(c) }]),
  );
}

/**
 * The conversations that finished or came to need the user since `previous`
 * (null before the first read): not new ones, not ones put away, and not the
 * one the user is looking at (`watching`).
 */
export function chimeNews(
  previous: ChimeMemory | null,
  conversations: ReadonlyArray<AldoHomeConversation>,
  now: number,
  watching: AldoHomeTarget | null,
): ReadonlyArray<AldoHomeConversation> {
  if (!previous) return [];
  return conversations.filter((c) => {
    const before = previous.get(c.ref);
    if (!before || putAway(c, now) || sameTarget(watching, c.thread)) return false;
    const needs = needsKey(c);
    const finished = c.state === "done" && !before.done;
    return finished || (needs !== null && needs !== before.needs);
  });
}

/** Whether to play: there's news, and the last sound was long enough ago. */
export function shouldChime(news: number, lastChimeAt: number | null, now: number): boolean {
  return news > 0 && (lastChimeAt === null || now - lastChimeAt >= CHIME_GAP_MS);
}
