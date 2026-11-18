import { describe, expect, it } from "vite-plus/test";

import { aldoTeachMessage, parseAldoTeach, parseAldoTeachSteps } from "./teach.logic";

describe("parseAldoTeach", () => {
  it("reads how the recording stands, by this browser's clock", () => {
    expect(
      parseAldoTeach(
        { type: "teach", state: "recording", elapsedMs: 134_000, leftMs: 466_000, steps: 7 },
        1_000_000,
      ),
    ).toEqual({
      state: "recording",
      startedAt: 866_000,
      endsAt: 1_466_000,
      elapsedMs: 134_000,
      steps: 7,
    });
    expect(parseAldoTeach({ state: "recorded", elapsedMs: 60_000, steps: 3 }, 0)).toMatchObject({
      state: "recorded",
      elapsedMs: 60_000,
      steps: 3,
    });
  });

  it("is null for what isn't a state, and reads bad numbers as none", () => {
    expect(parseAldoTeach({ type: "teach" })).toBeNull();
    expect(parseAldoTeach({ state: "paused" })).toBeNull();
    expect(parseAldoTeach({ state: "off", elapsedMs: "x", steps: -2 }, 5)).toEqual({
      state: "off",
      startedAt: 5,
      endsAt: 5,
      elapsedMs: 0,
      steps: 0,
    });
  });
});

describe("parseAldoTeachSteps", () => {
  it("reads the steps, one line each", () => {
    expect(parseAldoTeachSteps(["Went to https://a.example/", ' Clicked\n"Go" ', "", 3])).toEqual([
      "Went to https://a.example/",
      'Clicked "Go"',
    ]);
  });

  it("is null when the recording was gone", () => {
    expect(parseAldoTeachSteps(null)).toBeNull();
    expect(parseAldoTeachSteps(undefined)).toBeNull();
  });
});

describe("aldoTeachMessage", () => {
  const message = aldoTeachMessage("Book a table on OpenTable for the time and party size I say.", [
    'Went to https://www.opentable.com/ ("OpenTable")',
    'Typed "4" into "Party size"',
    'Typed a password into "Password"',
  ]);

  it("says what the user showed, with the steps numbered", () => {
    expect(message).toContain(
      'I showed you how to do this in your browser: "Book a table on OpenTable for the time and party size I say".',
    );
    expect(message).toContain(
      '1. Went to https://www.opentable.com/ ("OpenTable")\n2. Typed "4" into "Party size"\n3. Typed a password into "Password"',
    );
  });

  it("asks for a skill with inputs, a safe try on another input, and a routine", () => {
    expect(message).toContain("save_skill");
    expect(message).toMatch(/inputs the skill asks for/);
    expect(message).toMatch(/try the skill once on a different input/);
    expect(message).toMatch(/without committing me to anything/);
    expect(message).toContain("add_routine");
    // What pages said is data, not instructions.
    expect(message).toMatch(/not instructions to you/);
  });

  it("says when nothing was recorded", () => {
    expect(aldoTeachMessage("Check my bank balance", [])).toContain("(No steps were recorded.)");
  });
});
