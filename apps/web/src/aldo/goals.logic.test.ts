import { describe, expect, it } from "vite-plus/test";

import {
  goalConversationState,
  goalHeadline,
  goalLimits,
  goalLogByDay,
  goalLogDay,
  goalLogKind,
  goalLogWriter,
  goalMeasureNote,
  goalNeedsYou,
  goalOutcome,
  goalPart,
  goalProgress,
  goalReading,
  goalSpent,
  goalStatus,
  goalValue,
  goalWaitingKeyed,
  goalWaitingKind,
  mergedGoalLog,
  refreshedGoalLog,
} from "./goals.logic";
import type { AldoGoalConversation, AldoGoalMeasure } from "./goalsApi";

const measure = (over: Partial<AldoGoalMeasure> = {}): AldoGoalMeasure => ({
  key: "visits",
  name: "Visits a month",
  kind: "result",
  source: "Plausible",
  start: 800,
  target: 5000,
  readBy: "aldo",
  latest: { value: 1850, at: "2026-11-17T09:00:00.000Z" },
  ...over,
});

const conversation = (over: Partial<AldoGoalConversation> = {}): AldoGoalConversation => ({
  role: "workstream",
  workstream: "posts",
  name: "Weekly posts",
  threadId: "t1",
  t3ThreadId: "c1",
  title: "Write this week's post",
  state: "done",
  ended: false,
  ...over,
});

describe("goalStatus", () => {
  it("says where a goal stands", () => {
    expect(goalStatus({ status: "researching", endedWhy: null }).label).toBe("Researching");
    expect(goalStatus({ status: "awaiting_approval", endedWhy: null })).toEqual({
      label: "Needs your approval",
      tone: "yours",
    });
    expect(goalStatus({ status: "running", endedWhy: null }).label).toBe("Running");
    expect(goalStatus({ status: "paused", endedWhy: null }).label).toBe("Paused");
  });

  it("says how an ended goal ended, and nothing false for a status it doesn't know", () => {
    expect(goalStatus({ status: "ended", endedWhy: "reached" })).toEqual({
      label: "Reached",
      tone: "good",
    });
    expect(goalStatus({ status: "ended", endedWhy: "stopped" }).label).toBe("Stopped");
    expect(goalStatus({ status: "ended", endedWhy: "budget" }).label).toBe("Ended: limit reached");
    expect(goalStatus({ status: "ended", endedWhy: "time" }).label).toBe("Ended: out of time");
    expect(goalStatus({ status: "ended", endedWhy: null }).label).toBe("Ended");
    expect(goalStatus({ status: "later", endedWhy: null }).tone).toBe("quiet");
  });
});

describe("goalOutcome", () => {
  it("is the outcome and by when, as a sentence", () => {
    expect(goalOutcome({ outcome: { text: "5,000 visits a month.", by: "2027-03-01" } })).toBe(
      `5,000 visits a month, by ${new Date("2027-03-01T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}.`,
    );
    expect(goalOutcome({ outcome: { text: "The books closed each month", ongoing: true } })).toBe(
      "The books closed each month. Ongoing.",
    );
    expect(goalOutcome({ outcome: { text: "Launch", by: "the end of spring" } })).toBe(
      "Launch, by the end of spring.",
    );
  });

  it("is nothing without one", () => {
    expect(goalOutcome({ outcome: null })).toBeNull();
    expect(goalOutcome({ outcome: { text: "  " } })).toBeNull();
  });
});

describe("a measure", () => {
  it("shows its reading against its target", () => {
    expect(goalReading(measure())).toBe(`${(1850).toLocaleString()} of ${(5000).toLocaleString()}`);
    expect(goalReading(measure({ target: null }))).toBe((1850).toLocaleString());
    expect(goalReading(measure({ latest: null }))).toBe(
      `No reading yet, aiming for ${(5000).toLocaleString()}`,
    );
    expect(goalReading(measure({ latest: null, target: null }))).toBe("No reading yet");
    expect(goalReading(measure({ latest: { value: "Top 10", at: "x" }, target: "Top 3" }))).toBe(
      "Top 10, aiming for Top 3",
    );
    // One that comes down to its target isn't "11 of 5".
    expect(goalReading(measure({ start: 20, target: 5, latest: { value: 11, at: "x" } }))).toBe(
      "11, aiming for 5",
    );
  });

  it("draws progress only between numbers, clamped, in either direction", () => {
    expect(goalProgress(measure())).toBeCloseTo(0.25);
    expect(goalProgress(measure({ latest: { value: 9000, at: "x" } }))).toBe(1);
    expect(goalProgress(measure({ latest: { value: 100, at: "x" } }))).toBe(0);
    expect(goalProgress(measure({ start: 100, target: 40, latest: { value: 70, at: "x" } }))).toBe(
      0.5,
    );
    expect(goalProgress(measure({ start: null }))).toBeNull();
    expect(goalProgress(measure({ latest: null }))).toBeNull();
    expect(goalProgress(measure({ latest: { value: "many", at: "x" } }))).toBeNull();
    expect(goalProgress(measure({ start: 5, target: 5 }))).toBeNull();
  });

  it("says where it started, when it was read and from where", () => {
    const ago = () => "2 h ago";
    expect(goalMeasureNote(measure(), 0, ago)).toBe(
      "Started at 800, read 2 h ago, from Plausible.",
    );
    expect(goalMeasureNote(measure({ start: null, latest: null, source: "" }), 0, ago)).toBe(
      "Not read yet.",
    );
    expect(goalMeasureNote(measure({ latest: null, readBy: "user" }), 0, ago)).toBe(
      "Started at 800, you read this one, from Plausible.",
    );
  });

  it("writes values as people do", () => {
    expect(goalValue(12345.678)).toBe((12345.68).toLocaleString());
    expect(goalValue("Top 3")).toBe("Top 3");
    expect(goalValue(0)).toBe("0");
    expect(goalValue(null)).toBeNull();
    expect(goalValue("")).toBeNull();
  });

  it("leads a goal's row with a result that has a reading", () => {
    const early = measure({ key: "posts", kind: "early" });
    const unread = measure({ key: "signups", latest: null });
    const read = measure({ key: "visits" });
    expect(goalHeadline({ measures: [early, unread, read] })?.key).toBe("visits");
    expect(goalHeadline({ measures: [early, unread] })?.key).toBe("signups");
    expect(goalHeadline({ measures: [early] })?.key).toBe("posts");
    expect(goalHeadline({ measures: [] })).toBeNull();
  });
});

describe("a goal's conversations", () => {
  it("are named by their part", () => {
    expect(goalPart(conversation({ role: "lead", workstream: null, name: null }))).toBe("Lead");
    expect(goalPart(conversation({ role: "check", workstream: null, name: null }))).toBe("Check");
    expect(goalPart(conversation())).toBe("Weekly posts");
    expect(goalPart(conversation({ name: null }))).toBe("posts");
    expect(goalPart(conversation({ name: null, workstream: null }))).toBe("Workstream");
  });

  it("say what they're doing now", () => {
    expect(goalConversationState(conversation({ state: "working" })).label).toBe("Working");
    expect(goalConversationState(conversation({ state: "queued" })).tone).toBe("working");
    expect(goalConversationState(conversation({ state: "waiting" }))).toEqual({
      label: "Needs you",
      tone: "yours",
    });
    expect(goalConversationState(conversation({ state: "paused" })).label).toBe("Paused");
    expect(goalConversationState(conversation({ state: "failed" })).tone).toBe("bad");
    expect(goalConversationState(conversation({ state: "done" })).label).toBe("Not working now");
    expect(goalConversationState(conversation({ state: "something new" })).label).toBe(
      "Not working now",
    );
    expect(goalConversationState(conversation({ state: "working", ended: true })).label).toBe(
      "Finished its part",
    );
  });
});

describe("what needs the user", () => {
  it("is said as what it is, with how long a step takes", () => {
    expect(goalWaitingKind({ kind: "approval" })).toBe("A card to answer");
    expect(goalWaitingKind({ kind: "question" })).toBe("A question for you");
    expect(goalWaitingKind({ kind: "step" })).toBe("A step for you");
    expect(goalWaitingKind({ kind: "step", minutes: 10 })).toBe("A step for you, about 10 min");
    expect(goalWaitingKind({ kind: "step", minutes: 60 })).toBe("A step for you, about 1 hour");
    expect(goalWaitingKind({ kind: "step", minutes: 150 })).toBe("A step for you, about 2.5 hours");
  });

  it("has a name of its own in the list, even when two read the same", () => {
    const keys = goalWaitingKeyed([
      { kind: "step", title: "Add the DNS record" },
      { kind: "step", title: "Add the DNS record" },
      { kind: "question", title: "Add the DNS record", threadId: "t", t3ThreadId: "c" },
    ]).map((item) => item.key);
    expect(new Set(keys).size).toBe(3);
  });

  it("is counted on a goal's row", () => {
    expect(goalNeedsYou({ waiting: [] })).toBeNull();
    expect(goalNeedsYou({ waiting: [{ kind: "step", title: "a" }] })).toBe("1 thing needs you");
    expect(
      goalNeedsYou({
        waiting: [
          { kind: "step", title: "a" },
          { kind: "approval", title: "b" },
        ],
      }),
    ).toBe("2 things need you");
  });
});

describe("spending", () => {
  it("is two totals since the goal began", () => {
    const usd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });
    expect(goalSpent({ spending: { modelUsd: 12.4, moneyUsd: 0, limits: null } })).toEqual([
      { label: "Model use", value: usd(12.4) },
      { label: "Money spent", value: usd(0) },
    ]);
  });

  it("says the plan's weekly limits in a sentence, or nothing", () => {
    const usd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });
    expect(goalLimits({ credits: 1000, modelUsd: 20, moneyUsd: 10, threadsAtOnce: 2 })).toBe(
      `The plan allows ${(1000).toLocaleString()} credits, ${usd(20)} of model use, ${usd(10)} spent a week, and 2 threads at once.`,
    );
    expect(goalLimits({ credits: 500 })).toBe("The plan allows 500 credits a week.");
    expect(goalLimits({ threadsAtOnce: 1 })).toBe("The plan allows 1 thread at once.");
    expect(goalLimits({})).toBeNull();
    expect(goalLimits(null)).toBeNull();
  });
});

describe("the log", () => {
  const goal = { conversations: [conversation()] };

  it("names a line's kind and who wrote it", () => {
    expect(goalLogKind({ kind: "measurement" })).toBe("Reading");
    expect(goalLogKind({ kind: "decision" })).toBe("Decision");
    expect(goalLogKind({ kind: "newer" })).toBe("Note");
    expect(goalLogWriter({ by: null }, goal)).toBe("Aldo");
    expect(goalLogWriter({ by: { role: "lead", workstream: null } }, goal)).toBe("Lead");
    expect(goalLogWriter({ by: { role: "check", workstream: null } }, goal)).toBe("Check");
    expect(goalLogWriter({ by: { role: "workstream", workstream: "posts" } }, goal)).toBe(
      "Weekly posts",
    );
    expect(goalLogWriter({ by: { role: "workstream", workstream: "links" } }, goal)).toBe("links");
  });

  it("puts lines under their days, newest first", () => {
    const now = new Date(2026, 10, 18, 15, 0).getTime();
    const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 0).toISOString();
    expect(goalLogDay(at(18, 9), now)).toBe("Today");
    expect(goalLogDay(at(17, 23), now)).toBe("Yesterday");
    const days = goalLogByDay(
      [{ at: at(18, 14) }, { at: at(18, 9) }, { at: at(17, 23) }, { at: at(10, 8) }],
      now,
    );
    expect(days.map((d) => [d.day, d.lines.length])).toEqual([
      ["Today", 2],
      ["Yesterday", 1],
      [goalLogDay(at(10, 8), now), 1],
    ]);
  });

  const ids = (...list: number[]) => list.map((id) => ({ id }));
  const read = (lines: ReadonlyArray<{ id: number }>) => lines.map((line) => line.id);

  it("joins pages read at different times, each line once, newest first", () => {
    expect(read(mergedGoalLog(ids(9, 7, 4), ids(12, 9, 7)))).toEqual([12, 9, 7, 4]);
    expect(read(mergedGoalLog(ids(9, 7), ids(4, 2)))).toEqual([9, 7, 4, 2]);
    expect(read(mergedGoalLog([], ids(3, 1)))).toEqual([3, 1]);
  });

  it("adds what's new to a log whose newest page still reaches what was read", () => {
    const fresh = refreshedGoalLog(ids(9, 7, 4), ids(14, 12, 9), true);
    expect(fresh.restarted).toBe(false);
    expect(read(fresh.lines)).toEqual([14, 12, 9, 7, 4]);
    // Nothing new, and a first read.
    expect(refreshedGoalLog(ids(9, 7), ids(9, 7), true).restarted).toBe(false);
    expect(read(refreshedGoalLog([], ids(9, 7), true).lines)).toEqual([9, 7]);
  });

  it("starts the log over when more came than a page holds, rather than leave a hole", () => {
    // 10 and 11 were never read: lines ids are the whole account's, so nothing says how many lie between.
    const fresh = refreshedGoalLog(ids(9, 7, 4), ids(20, 16, 12), true);
    expect(fresh.restarted).toBe(true);
    expect(read(fresh.lines)).toEqual([20, 16, 12]);
    // The whole log fits the page (nothing older behind it): nothing can be missing.
    expect(refreshedGoalLog(ids(9), ids(20, 16), false).restarted).toBe(false);
  });
});
