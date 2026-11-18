// Aldo's reply as a messaging app shows a person's: a bubble a paragraph at a
// time, a beat apart, with the typing dots between (AldoAssistant.tsx
// AldoReply). A list stays with what introduces it and a quoted block stays
// whole, so no bubble breaks a thought in two. At most a few beats, each
// short, so nothing makes the user wait to read. Pure, so it's tested on its own.

/** More paragraphs than this run on in the last bubble. */
export const MAX_BEATS = 4;
/** The longest a beat waits before the next bubble: the whole reply is there in about a second. */
export const BEAT_MS = 400;
const BEAT_MIN_MS = 160;

const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s/;
/** A line that opens or closes a code block, with backticks or tildes. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** The reply's paragraphs, grouped into its bubbles. */
export function splitBeats(text: string): ReadonlyArray<string> {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const paragraphs: string[] = [];
  // The open code block's fence character, if one's open: only the same one closes it.
  let fence: string | null = null;
  for (const block of trimmed.split(/\n{2,}/)) {
    const previous = paragraphs.at(-1);
    // Inside a code block, a blank line is the block's own: it stays whole.
    const joins =
      previous !== undefined &&
      (fence !== null ||
        (LIST_ITEM.test(block) &&
          (previous.trimEnd().endsWith(":") || LIST_ITEM.test(lastLine(previous)))));
    if (joins) paragraphs[paragraphs.length - 1] = `${previous}\n\n${block}`;
    else paragraphs.push(block);
    for (const line of block.split("\n")) {
      const marker = FENCE.exec(line)?.[1]?.[0];
      if (marker === undefined) continue;
      if (fence === null) fence = marker;
      else if (marker === fence) fence = null;
    }
  }
  if (paragraphs.length <= MAX_BEATS) return paragraphs;
  return [...paragraphs.slice(0, MAX_BEATS - 1), paragraphs.slice(MAX_BEATS - 1).join("\n\n")];
}

function lastLine(text: string): string {
  return text.slice(text.lastIndexOf("\n") + 1);
}

/** How long the dots show before a bubble of this length: longer for more to read, never past BEAT_MS. */
export function beatDelay(text: string): number {
  return Math.min(BEAT_MS, BEAT_MIN_MS + text.length * 2);
}
