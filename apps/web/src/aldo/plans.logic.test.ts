import { describe, expect, it } from "vite-plus/test";

import {
  aboutLabel,
  changedFromRecommended,
  chosenAnswers,
  countdownNote,
  countdownWords,
  inYourNameWords,
  newerPlan,
  openPlans,
  parseAldoPlan,
  parseAldoPlans,
  planCardState,
  sentence,
  startLabel,
  startedSummary,
} from "./plans.logic";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const at = (secondsFromNow: number) => new Date(NOW + secondsFromNow * 1000).toISOString();

/** A plan as Aldo's Home read sends it. */
function wire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "plan-1",
    goal: "Launch videos for Driftwood’s new site",
    steps: ["Gather the brand kit", "Cut three short videos", "Post them to the shop"],
    inYourName: "Sign up for Canva with logan@aldomail.com",
    cost: "Nothing: Canva’s free plan",
    leftForYou: "One step is yours: a 2-minute ID check",
    questions: [
      {
        id: "q1",
        question: "Which videos?",
        options: ["Logo reveals and short promos", "One long film"],
        recommended: "Logo reveals and short promos",
      },
      {
        id: "q2",
        question: "Whose name on them?",
        options: ["Logan Sack", "Driftwood"],
        recommended: "Logan Sack",
      },
    ],
    minutes: 30,
    costsMoney: false,
    status: "proposed",
    autoStartAt: at(118),
    proposedAt: at(-2),
    startedAt: null,
    startedBy: null,
    answers: null,
    thread: null,
    title: null,
    error: null,
    ...overrides,
  };
}

const plan = (overrides: Record<string, unknown> = {}) => {
  const parsed = parseAldoPlan(wire(overrides));
  if (!parsed) throw new Error("fixture didn't parse");
  return parsed;
};

describe("parseAldoPlans", () => {
  it("keeps a dismissed plan's cleared and removed marks, so Dismissed can leave it out", () => {
    const [read] = parseAldoPlans([
      wire({ chatDecision: { id: "d", dismissed: true, cleared: true, removed: true } }),
    ]);
    expect(read!.chatDecision).toEqual({ id: "d", dismissed: true, cleared: true, removed: true });
  });
  it("reads what Home sends", () => {
    const [read] = parseAldoPlans([wire()]);
    expect(read).toMatchObject({
      id: "plan-1",
      goal: "Launch videos for Driftwood’s new site",
      steps: ["Gather the brand kit", "Cut three short videos", "Post them to the shop"],
      inYourName: "Sign up for Canva with logan@aldomail.com",
      leftForYou: "One step is yours: a 2-minute ID check",
      minutes: 30,
      costsMoney: false,
      status: "proposed",
      autoStartAt: at(118),
      thread: null,
    });
    expect(read?.questions.map((q) => q.id)).toEqual(["q1", "q2"]);
  });

  it("shows nothing from an older Aldo, which sends no plans", () => {
    expect(parseAldoPlans(undefined)).toEqual([]);
    expect(parseAldoPlans(null)).toEqual([]);
    expect(parseAldoPlans({ plans: [] })).toEqual([]);
  });

  it("leaves out what doesn't read as a plan, and keeps the rest", () => {
    const plans = parseAldoPlans([
      wire({ id: "ok" }),
      null,
      "plan",
      wire({ id: "no-goal", goal: undefined }),
      wire({ id: "bad-status", status: "replaced" }),
      wire({ id: "no-time", minutes: 0 }),
      wire({ id: "bad-date", proposedAt: "soon" }),
      // A question it can't show would be answered unseen.
      wire({
        id: "bad-question",
        questions: [{ id: "q1", question: "Which?", options: ["A", "B"], recommended: "C" }],
      }),
    ]);
    expect(plans.map((p) => p.id)).toEqual(["ok"]);
  });

  it("reads a started plan with its thread and answers", () => {
    const started = plan({
      status: "started",
      autoStartAt: at(10),
      startedAt: at(-1),
      startedBy: "user",
      answers: { q1: "One long film", q2: "Driftwood", junk: 3 },
      thread: { environmentId: "aldo-m1", threadId: "t1" },
      title: "Driftwood launch videos",
    });
    expect(started.autoStartAt).toBeNull();
    expect(started.answers).toEqual({ q1: "One long film", q2: "Driftwood" });
    expect(started.thread).toEqual({ environmentId: "aldo-m1", threadId: "t1" });
    expect(started.title).toBe("Driftwood launch videos");
  });

  it("treats missing optional parts as absent", () => {
    const bare = plan({ inYourName: "", leftForYou: undefined, questions: undefined, thread: {} });
    expect(bare.inYourName).toBeNull();
    expect(bare.leftForYou).toBeNull();
    expect(bare.questions).toEqual([]);
    expect(bare.thread).toBeNull();
  });
});

describe("words", () => {
  it("names the Start button for what it does and how long", () => {
    expect(startLabel({ minutes: 30 })).toBe("Start · About 30 min");
    expect(aboutLabel(59)).toBe("About 59 min");
    expect(aboutLabel(60)).toBe("About 1 hr");
    expect(aboutLabel(150)).toBe("About 3 hr");
    expect(aboutLabel(24 * 60)).toBe("About 1 day");
    expect(aboutLabel(3 * 24 * 60)).toBe("About 3 days");
  });

  it("counts down in minutes and seconds, never below zero", () => {
    expect(countdownWords(118_000)).toBe("1:58");
    expect(countdownWords(117_200)).toBe("1:58");
    expect(countdownWords(5_000)).toBe("0:05");
    expect(countdownWords(-3_000)).toBe("0:00");
    expect(countdownNote("1:58", true)).toBe("Starts with these in 1:58 if you’re away.");
    expect(countdownNote("1:58", false)).toBe("Starts in 1:58 if you’re away.");
  });

  it("says what a started plan started with", () => {
    expect(
      startedSummary(
        plan({
          status: "started",
          startedBy: "user",
          answers: { q1: "Logo reveals and short promos", q2: "Logan Sack" },
        }),
      ),
    ).toBe("Started with: Logo reveals and short promos · Logan Sack");
    expect(startedSummary(plan({ status: "started", startedBy: "auto", answers: null }))).toBe(
      "Started on its own with: Logo reveals and short promos · Logan Sack",
    );
    expect(startedSummary(plan({ status: "started", startedBy: "aldo", questions: [] }))).toBe(
      "Started",
    );
  });
});

describe("in your name", () => {
  it("says what it does as the user, then what it costs, as sentences", () => {
    expect(inYourNameWords(plan())).toBe(
      "Sign up for Canva with logan@aldomail.com. Nothing: Canva’s free plan.",
    );
    expect(
      inYourNameWords(plan({ inYourName: null, cost: "It costs nothing; Fiverr keeps 20%." })),
    ).toBe("It costs nothing; Fiverr keeps 20%.");
    expect(sentence("  About $12 for the domain ")).toBe("About $12 for the domain.");
    expect(sentence("Is that all?")).toBe("Is that all?");
  });
});

describe("answers", () => {
  it("starts with the recommended answers unless the user picked another", () => {
    const p = plan();
    expect(chosenAnswers(p, {})).toEqual({ q1: "Logo reveals and short promos", q2: "Logan Sack" });
    expect(chosenAnswers(p, { q2: "Driftwood", q9: "x", q1: "not an option" })).toEqual({
      q1: "Logo reveals and short promos",
      q2: "Driftwood",
    });
  });

  it("knows when the user moved off what Aldo recommended", () => {
    const p = plan();
    expect(changedFromRecommended(p, {})).toBe(false);
    expect(changedFromRecommended(p, { q1: "Logo reveals and short promos" })).toBe(false);
    expect(changedFromRecommended(p, { q2: "Driftwood" })).toBe(true);
  });
});

describe("planCardState", () => {
  it("counts down to starting on its own", () => {
    expect(planCardState(plan(), { now: NOW })).toEqual({
      kind: "countdown",
      at: Date.parse(at(118)),
      left: "1:58",
    });
  });

  it("is due once the two minutes are up", () => {
    expect(planCardState(plan({ autoStartAt: at(-1) }), { now: NOW })).toEqual({ kind: "due" });
  });

  it("waits for the user's Start when it costs money, saying so", () => {
    expect(planCardState(plan({ costsMoney: true, autoStartAt: null }), { now: NOW })).toEqual({
      kind: "waiting",
      why: "It costs money, so it waits for your Start.",
    });
    // Even if a time came along with it.
    expect(planCardState(plan({ costsMoney: true }), { now: NOW }).kind).toBe("waiting");
  });

  it("waits without a countdown once held, or when the server set none", () => {
    const waits = { kind: "waiting", why: "It waits for your Start." };
    expect(planCardState(plan(), { now: NOW, held: true })).toEqual(waits);
    expect(planCardState(plan({ autoStartAt: null }), { now: NOW })).toEqual(waits);
  });

  it("says why its last start didn't go", () => {
    expect(
      planCardState(plan({ autoStartAt: null, error: "It didn’t start. Ask Aldo about it." }), {
        now: NOW,
      }),
    ).toEqual({ kind: "waiting", why: "It didn’t start. Ask Aldo about it." });
  });

  it("is starting while a Start is on its way, and started after", () => {
    expect(planCardState(plan(), { now: NOW, busy: true })).toEqual({ kind: "starting" });
    expect(
      planCardState(
        plan({ status: "started", startedBy: "user", answers: { q1: "One long film" } }),
        {
          now: NOW,
          busy: true,
        },
      ),
    ).toEqual({ kind: "started", summary: "Started with: One long film · Logan Sack" });
  });
});

describe("openPlans", () => {
  it("keeps the ones waiting on the user, oldest first", () => {
    const plans = [
      plan({ id: "new", proposedAt: at(-10) }),
      plan({ id: "started", status: "started" }),
      plan({ id: "old", proposedAt: at(-600) }),
    ];
    expect(openPlans(plans, null, NOW).map((p) => p.id)).toEqual(["old", "new"]);
  });

  it("leaves out those proposed before the conversation starts that wait for a Start", () => {
    const plans = [
      plan({ id: "new", proposedAt: at(-10), autoStartAt: null }),
      plan({ id: "old", proposedAt: at(-600), autoStartAt: null }),
    ];
    expect(openPlans(plans, at(-60), NOW).map((p) => p.id)).toEqual(["new"]);
  });

  it("keeps one Aldo proposed for the first message whatever this browser's clock says", () => {
    // The browser is three minutes ahead of Aldo: the plan reads as older than the message it answers.
    const waits = plan({ id: "waits", proposedAt: at(-170), autoStartAt: null });
    expect(openPlans([waits], at(0), NOW).map((p) => p.id)).toEqual(["waits"]);
    // One counting down to start on its own is never left out.
    const counts = plan({ id: "counts", proposedAt: at(-3_600), autoStartAt: at(30) });
    expect(openPlans([counts], at(0), NOW).map((p) => p.id)).toEqual(["counts"]);
  });

  it("leaves one put off out until it's back, then keeps it, however long ago it was proposed", () => {
    const putOff = plan({
      id: "later",
      proposedAt: at(-86_400),
      autoStartAt: null,
      deferredUntil: at(600),
    });
    expect(openPlans([putOff], at(0), NOW)).toEqual([]);
    const back = plan({
      id: "back",
      proposedAt: at(-86_400),
      autoStartAt: null,
      deferredUntil: at(-60),
    });
    expect(openPlans([back], at(0), NOW).map((p) => p.id)).toEqual(["back"]);
    expect(planCardState(back, { now: NOW })).toEqual({
      kind: "waiting",
      why: "You put it off, so it waits for your Start.",
    });
    // Brought back early, Aldo says so: it's back at once, whatever this browser's clock says.
    const early = plan({
      id: "early",
      proposedAt: at(-86_400),
      autoStartAt: null,
      deferredUntil: null,
      back: true,
    });
    expect(openPlans([early], at(0), NOW).map((p) => p.id)).toEqual(["early"]);
    expect(parseAldoPlans([{ ...early, back: true }])[0]?.back).toBe(true);
  });
});

describe("newerPlan", () => {
  it("keeps what the Start returned until the home read has it started too", () => {
    const shown = plan();
    const started = plan({ status: "started", startedBy: "user", startedAt: at(0) });
    expect(newerPlan(shown, null)).toBe(shown);
    expect(newerPlan(shown, started)).toBe(started);
    expect(newerPlan(started, shown)).toBe(started);
    const later = plan({ status: "started", startedBy: "user", title: "Driftwood videos" });
    expect(newerPlan(later, started)).toBe(later);
    expect(newerPlan(shown, plan({ id: "other", status: "started" }))).toBe(shown);
  });
});
