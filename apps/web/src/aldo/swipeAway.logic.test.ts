import { expect, it } from "vite-plus/test";

import { isSideways, swipedAway } from "./swipeAway.logic";

it("takes a mostly sideways drag past the slop from the page", () => {
  expect(isSideways({ dx: -30, dy: 4 })).toBe(true);
  expect(isSideways({ dx: 6, dy: 0 })).toBe(false);
  expect(isSideways({ dx: -30, dy: 40 })).toBe(false);
});

it("dismisses on letting go far enough, either way, never on a scroll", () => {
  expect(swipedAway({ dx: -120, dy: 10 }, 350)).toBe(true);
  expect(swipedAway({ dx: 130, dy: 0 }, 350)).toBe(true);
  expect(swipedAway({ dx: -60, dy: 0 }, 350)).toBe(false);
  expect(swipedAway({ dx: -120, dy: 200 }, 350)).toBe(false);
  // A third of a wide row is more than the minimum.
  expect(swipedAway({ dx: -120, dy: 0 }, 600)).toBe(false);
  expect(swipedAway({ dx: -200, dy: 0 }, 600)).toBe(true);
});
