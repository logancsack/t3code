import { describe, expect, it } from "vite-plus/test";

import {
  aldoElapsedWords,
  aldoProgressHead,
  aldoProgressLine,
  aldoStepUnderWay,
  type AldoPlanStep,
} from "./progress.logic";

const plan = (current: number, steps: ReadonlyArray<string>): AldoPlanStep[] =>
  steps.map((step, index) => ({
    step,
    status: index < current ? "completed" : index === current ? "inProgress" : "pending",
  }));

const FIVERR = [
  "Research what sells on Fiverr, and at what price",
  "Pick three offers and price them",
  "Make a portfolio of samples",
  "Write the gig listings",
  "Set up your seller account",
  "Check everything and send you the results",
];

describe("aldoElapsedWords", () => {
  it("says the time so far in whole units", () => {
    expect(aldoElapsedWords(-5)).toBe("0 sec");
    expect(aldoElapsedWords(40_900)).toBe("40 sec");
    expect(aldoElapsedWords(119_000)).toBe("1 min");
    expect(aldoElapsedWords(18 * 60_000 + 59_000)).toBe("18 min");
    expect(aldoElapsedWords(60 * 60_000)).toBe("1 hr");
    expect(aldoElapsedWords(72 * 60_000 + 30_000)).toBe("1 hr 12 min");
  });
});

describe("aldoStepUnderWay", () => {
  it("says a plan's order as what's under way", () => {
    expect(aldoStepUnderWay("Set up your seller account")).toBe("Setting up your seller account");
    expect(aldoStepUnderWay("Pick three offers and price them")).toBe(
      "Picking three offers and pricing them",
    );
    expect(aldoStepUnderWay("Check everything and send you the results")).toBe(
      "Checking everything and sending you the results",
    );
    expect(aldoStepUnderWay("Research what sells on Fiverr, and at what price")).toBe(
      "Researching what sells on Fiverr, and at what price",
    );
  });

  it("leaves a step that doesn't start with an order as written", () => {
    expect(aldoStepUnderWay("Fiverr account")).toBe("Fiverr account");
    expect(aldoStepUnderWay("Researching gigs")).toBe("Researching gigs");
    // A noun after "and" stays one.
    expect(aldoStepUnderWay("Compare delivery and price")).toBe("Comparing delivery and price");
    expect(aldoStepUnderWay("Collect logos and design briefs")).toBe(
      "Collecting logos and design briefs",
    );
  });

  it("drops the marks and the full stop", () => {
    expect(aldoStepUnderWay("  Write `listings.md`  for **all** gigs. ")).toBe(
      "Writing listings.md for all gigs",
    );
  });
});

describe("aldoProgressHead and aldoProgressLine", () => {
  it("counts the plan's steps and says the one under way", () => {
    expect(aldoProgressLine(plan(4, FIVERR), "Working on fiverr.com", 18 * 60_000)).toBe(
      "Step 5 of 6 · Setting up your seller account · 18 min",
    );
  });

  it("takes the next step to do when none is under way", () => {
    const steps = plan(2, FIVERR).map((step) =>
      step.status === "inProgress" ? { ...step, status: "pending" as const } : step,
    );
    expect(aldoProgressHead(steps, null)).toBe("Step 3 of 6 · Making a portfolio of samples");
  });

  it("says the step under way in words once the plan is done or there's none", () => {
    expect(aldoProgressHead(plan(6, FIVERR), "Sharing “Gig listings”")).toBe(
      "Sharing “Gig listings”",
    );
    expect(aldoProgressLine(null, "Working on fiverr.com", 3 * 60_000)).toBe(
      "Working on fiverr.com · 3 min",
    );
    expect(aldoProgressLine([], null, 20_000)).toBe("Working · 20 sec");
  });

  it("doesn't count a plan of one step", () => {
    expect(aldoProgressHead(plan(0, ["Write the gig listings"]), "Making listings.md")).toBe(
      "Writing the gig listings",
    );
  });
});
