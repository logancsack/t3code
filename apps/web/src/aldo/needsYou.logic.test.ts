import { describe, expect, it } from "vite-plus/test";

import { inWords, nearestOutOfView, needsYouWords } from "./needsYou.logic";

describe("needsYouWords", () => {
  it("says how many, in words to nine, with more once some show", () => {
    expect(needsYouWords(0, 3)).toBeNull();
    expect(needsYouWords(2, 2)).toBe("Two need you");
    expect(needsYouWords(1, 1)).toBe("One needs you");
    expect(needsYouWords(1, 3)).toBe("One more needs you");
    expect(needsYouWords(12, 12)).toBe("12 need you");
    expect(inWords(3)).toBe("three");
  });
});

describe("nearestOutOfView", () => {
  it("goes down to the nearest below, else up to the nearest above", () => {
    expect(
      nearestOutOfView([
        { card: "a", where: "above" },
        { card: "b", where: "in" },
        { card: "c", where: "below" },
        { card: "d", where: "below" },
      ]),
    ).toBe("c");
    expect(
      nearestOutOfView([
        { card: "a", where: "above" },
        { card: "b", where: "above" },
        { card: "c", where: "in" },
      ]),
    ).toBe("b");
    expect(nearestOutOfView([{ card: "a", where: "in" }])).toBeNull();
  });
});
