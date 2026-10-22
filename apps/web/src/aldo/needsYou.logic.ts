// The words on the pill above the composer saying how many wait on the user
// out of view (NeedsYouPill.tsx). One to nine in words, as the stylebook
// says, and "more" once some are on the screen.

const WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/** A count as Aldo says it: "two", "12". */
export function inWords(count: number): string {
  return WORDS[count - 1] ?? String(count);
}

/** `out` of `total` out of view: "Two need you", "One more needs you", or null with none. */
export function needsYouWords(out: number, total: number): string | null {
  if (out <= 0) return null;
  const count = inWords(out);
  const more = out < total ? " more" : "";
  return `${count[0]!.toUpperCase()}${count.slice(1)}${more} ${out === 1 ? "needs" : "need"} you`;
}

/**
 * The card a tap brings into view: the nearest out of view below what's
 * read, else the nearest above. `cards` in the page's order, each with where
 * it is against the view (`above`, `below`, or in it).
 */
export function nearestOutOfView<T>(
  cards: ReadonlyArray<{ readonly card: T; readonly where: "above" | "in" | "below" }>,
): T | null {
  const below = cards.find((c) => c.where === "below");
  if (below) return below.card;
  return cards.findLast((c) => c.where === "above")?.card ?? null;
}
