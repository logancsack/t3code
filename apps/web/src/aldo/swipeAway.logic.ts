// A row in a list is swiped away (Needs you, AldoPresence.tsx): a finger drags
// it sideways, and letting go past the threshold dismisses it. A mostly
// vertical drag is the page scrolling, and a short one is a slip: both leave it.

/** Sideways travel that dismisses, in CSS pixels, or a third of the row if that's more. */
const DISTANCE = 80;
/** How much more sideways than up or down a drag must be to be a swipe. */
const SIDEWAYS = 1.5;
/** Sideways travel before a drag takes the row over from the page. */
const SLOP = 10;

/** Whether a drag so far is the row's (mostly sideways, past the slop), not the page's or a tap's. */
export function isSideways(drag: { readonly dx: number; readonly dy: number }): boolean {
  return Math.abs(drag.dx) > SLOP && Math.abs(drag.dx) > Math.abs(drag.dy) * SIDEWAYS;
}

/** Whether letting go here dismisses the row: dragged far enough, either way. */
export function swipedAway(
  drag: { readonly dx: number; readonly dy: number },
  width: number,
): boolean {
  return isSideways(drag) && Math.abs(drag.dx) >= Math.max(DISTANCE, width / 3);
}
