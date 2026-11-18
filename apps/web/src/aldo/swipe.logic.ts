// A swipe across the full-screen viewer (ExpandedImageDialog) goes to the next
// or previous item: a quick, mostly sideways stroke of one finger. A slow drag
// or a mostly vertical one is left to the page.

/** How far a finger goes, in CSS pixels, before a stroke is a swipe. */
const DISTANCE = 48;
/** How much more sideways than up or down it goes. */
const SIDEWAYS = 1.5;
/** How long it may take, in milliseconds. */
const QUICK_MS = 600;

/** The step a stroke makes: 1 to the next item (a swipe to the left), -1 to the previous, null for none. */
export function swipeStep(stroke: {
  readonly dx: number;
  readonly dy: number;
  readonly ms: number;
}): 1 | -1 | null {
  const { dx, dy, ms } = stroke;
  if (!(ms >= 0 && ms <= QUICK_MS)) return null;
  if (Math.abs(dx) < DISTANCE || Math.abs(dx) < Math.abs(dy) * SIDEWAYS) return null;
  return dx < 0 ? 1 : -1;
}
