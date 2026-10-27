import { describe, expect, it } from "vite-plus/test";

import { liveLineOf, liveLineText, planWords, renderLeft } from "./liveWork.logic";

const NOW = Date.parse("2026-10-27T12:00:00Z");
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

describe("liveLineOf", () => {
  it("says the step, and how long once it's run a minute", () => {
    const line = liveLineOf({ kind: "tool", doing: "Running tests", since: ago(20) }, NOW)!;
    expect(liveLineText(line, NOW)).toBe("Running tests");
    const long = liveLineOf({ kind: "tool", doing: "Running tests", since: ago(130) }, NOW)!;
    expect(liveLineText(long, NOW)).toBe("Running tests · 2 min");
  });

  it("says thinking and writing in words of its own", () => {
    expect(liveLineOf({ kind: "thinking", doing: null, since: ago(5) }, NOW)?.text).toBe(
      "Thinking",
    );
    expect(liveLineOf({ kind: "writing", doing: null, since: ago(5) }, NOW)?.text).toBe(
      "Writing its reply",
    );
  });

  it("says a render's frame, never how long", () => {
    const line = liveLineOf(
      {
        kind: "tool",
        doing: null,
        since: ago(600),
        render: { frame: 37, frames: 120, leftMs: 6 * 60_000 },
      },
      NOW,
    )!;
    expect(liveLineText(line, NOW)).toBe("Rendering frame 37 of 120");
    const unknown = {
      kind: "tool",
      doing: null,
      since: ago(600),
      render: { frame: 3, frames: null, leftMs: null },
    } as const;
    expect(liveLineOf(unknown, NOW)?.text).toBe("Rendering frame 3");
  });

  it("says nothing without a live step", () => {
    expect(liveLineOf(null, NOW)).toBeNull();
    expect(liveLineOf({ kind: "tool", doing: null, since: ago(5) }, NOW)).toBeNull();
  });
});

describe("words", () => {
  it("says what's left of a render", () => {
    expect(renderLeft(null)).toBeNull();
    expect(renderLeft(5 * 60_000 + 1)).toBe("6 min left");
    expect(renderLeft(70 * 60_000)).toBe("about an hour left");
    expect(renderLeft(150 * 60_000)).toBe("about 3 h left");
  });

  it("says the plan's step, only for a plan of steps", () => {
    expect(planWords({ done: 2, total: 6 })).toBe("Step 3 of 6");
    expect(planWords({ done: 6, total: 6 })).toBe("Step 6 of 6");
    expect(planWords({ done: 0, total: 1 })).toBeNull();
    expect(planWords(null)).toBeNull();
  });
});
