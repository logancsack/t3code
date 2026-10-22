import { describe, expect, it } from "vite-plus/test";

import { BEAT_MS, MAX_BEATS, beatDelay, splitBeats } from "./beats.logic";

describe("splitBeats", () => {
  it("gives nothing for an empty reply", () => {
    expect(splitBeats("")).toEqual([]);
    expect(splitBeats("  \n\n ")).toEqual([]);
  });

  it("keeps a one-paragraph reply as one bubble", () => {
    expect(splitBeats("Sent. Jordan has it.")).toEqual(["Sent. Jordan has it."]);
  });

  it("splits on blank lines, not single line breaks", () => {
    expect(splitBeats("First line\nstill first.\n\nSecond.\n\n\nThird.")).toEqual([
      "First line\nstill first.",
      "Second.",
      "Third.",
    ]);
  });

  it("keeps a list with the line that introduces it", () => {
    expect(
      splitBeats("Three things:\n\n- the offer\n- the lunch\n\n- the badge\n\nThat's all."),
    ).toEqual(["Three things:\n\n- the offer\n- the lunch\n\n- the badge", "That's all."]);
  });

  it("keeps a numbered list whole across blank lines", () => {
    expect(splitBeats("1. Book it\n\n2. Pay\n\nDone after that.")).toEqual([
      "1. Book it\n\n2. Pay",
      "Done after that.",
    ]);
  });

  it("keeps a code block whole, blank lines and all", () => {
    const code = "```\nconst a = 1;\n\nconst b = 2;\n```";
    expect(splitBeats(`Here it is.\n\n${code}\n\nRun it once.`)).toEqual([
      "Here it is.",
      code,
      "Run it once.",
    ]);
  });

  it("keeps a tilde-fenced block whole too, and a backtick line inside it doesn't close it", () => {
    const code = "~~~\nconst a = 1;\n\n```\n\nconst b = 2;\n~~~";
    expect(splitBeats(`Here it is.\n\n${code}\n\nRun it once.`)).toEqual([
      "Here it is.",
      code,
      "Run it once.",
    ]);
  });

  it("runs anything past the last beat into the last bubble", () => {
    const beats = splitBeats("One.\n\nTwo.\n\nThree.\n\nFour.\n\nFive.\n\nSix.");
    expect(beats).toHaveLength(MAX_BEATS);
    expect(beats.at(-1)).toBe("Four.\n\nFive.\n\nSix.");
  });
});

describe("beatDelay", () => {
  it("waits longer for more to read, never past a beat", () => {
    expect(beatDelay("Ok.")).toBeLessThan(
      beatDelay("A sentence with a little more in it to read."),
    );
    expect(beatDelay("x".repeat(5000))).toBe(BEAT_MS);
  });
});
