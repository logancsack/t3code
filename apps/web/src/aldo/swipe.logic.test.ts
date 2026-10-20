import { describe, expect, it } from "vite-plus/test";

import { swipeStep } from "./swipe.logic";

describe("swipeStep", () => {
  it("goes to the next item on a swipe to the left, and back on one to the right", () => {
    expect(swipeStep({ dx: -120, dy: 10, ms: 200 })).toBe(1);
    expect(swipeStep({ dx: 120, dy: -10, ms: 200 })).toBe(-1);
  });

  it("leaves short, slow and mostly vertical strokes alone", () => {
    expect(swipeStep({ dx: -30, dy: 0, ms: 100 })).toBeNull();
    expect(swipeStep({ dx: -200, dy: 0, ms: 900 })).toBeNull();
    expect(swipeStep({ dx: -80, dy: 70, ms: 200 })).toBeNull();
    expect(swipeStep({ dx: 0, dy: 300, ms: 200 })).toBeNull();
  });

  it("ignores a stroke with no sensible time", () => {
    expect(swipeStep({ dx: -120, dy: 0, ms: Number.NaN })).toBeNull();
    expect(swipeStep({ dx: -120, dy: 0, ms: -5 })).toBeNull();
  });
});
