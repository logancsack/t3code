import { describe, expect, it } from "vite-plus/test";
import { aldoWaitingCount } from "./decisions.logic";
import type { AldoHome, AldoHomeConversation, AldoHomePullRequest } from "./homeApi";
import {
  presenceBoard,
  presenceLine,
  presenceState,
  readIsFresh,
  voicePresenceState,
} from "./presence.logic";

const NOW = Date.parse("2026-10-26T12:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const ahead = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

const quiet = {
  phase: "idle" as const,
  replying: false,
  working: [],
  stuck: 0,
  waiting: 0,
  moved: 0,
  fresh: true,
};
const job = { title: "Close September", browsing: null };

describe("Aldo presence header", () => {
  it("keeps needs-you and working counts together while showing the attention state", () => {
    expect(presenceLine({ ...quiet, waiting: 2, working: [job] })).toEqual({
      text: "2 need you · 1 working",
      state: "needs-you",
      dot: "needs-you",
    });
    expect(presenceLine({ ...quiet, waiting: 1 }).state).toBe("needs-you");
  });
  it("leads with what needs them, then what moved", () => {
    expect(presenceLine({ ...quiet, waiting: 2, moved: 3, working: [job] }).text).toBe(
      "2 need you · 3 moved",
    );
    expect(presenceLine({ ...quiet, moved: 3, working: [job] })).toMatchObject({
      text: "3 moved · 1 working",
      dot: "moved",
    });
  });
  it("says a lone count in full, with its dot", () => {
    expect(presenceLine({ ...quiet, waiting: 1 }).text).toBe("1 thing needs you");
    expect(presenceLine({ ...quiet, moved: 3 })).toMatchObject({
      text: "3 threads moved",
      dot: "moved",
    });
    expect(presenceLine({ ...quiet, moved: 1 }).text).toBe("1 thread moved");
    expect(presenceLine({ ...quiet, working: [job] })).toMatchObject({
      text: "Close September",
      dot: null,
    });
  });
  it("says a thread with no word for an hour isn't working", () => {
    expect(presenceLine({ ...quiet, stuck: 1 })).toMatchObject({
      text: "1 with no word",
      state: "idle",
    });
    expect(presenceLine({ ...quiet, stuck: 1, working: [job, job] }).text).toBe(
      "2 working · 1 with no word",
    );
  });
  it("says all caught up only after a recent read, else a dimmed checking", () => {
    expect(presenceLine(quiet)).toEqual({ text: "All caught up", state: "idle", dot: null });
    expect(presenceLine({ ...quiet, fresh: false })).toEqual({
      text: "Checking…",
      state: "idle",
      dot: null,
      dim: true,
    });
    expect(readIsFresh(0, NOW)).toBe(false);
    expect(readIsFresh(NOW - 89_000, NOW)).toBe(true);
    expect(readIsFresh(NOW - 91_000, NOW)).toBe(false);
  });
  it("distinguishes connecting and real errors from an idle mark", () => {
    expect(presenceLine({ ...quiet, phase: "connecting" }).state).toBe("connecting");
    expect(presenceLine({ ...quiet, phase: "error" }).state).toBe("error");
    expect(presenceLine({ ...quiet, unread: true }).state).toBe("error");
    expect(presenceLine(quiet).state).toBe("idle");
    expect(voicePresenceState("hearing")).toBe("listening");
  });
  it("never lets local success or typing mask a voice state or error", () => {
    for (const state of ["connecting", "thinking", "listening", "speaking", "error"] as const)
      expect(presenceState(state, { reading: true, success: true })).toBe(state);
    expect(presenceState("working", { reading: true, success: true })).toBe("success");
    expect(presenceState("needs-you", { reading: true, success: false })).toBe("reading");
  });
});

const conversation = (over: Partial<AldoHomeConversation> = {}): AldoHomeConversation => ({
  ref: "t1",
  thread: { environmentId: "aldo-t1", threadId: "th1" },
  title: "Fix checkout",
  repos: [],
  branch: "",
  state: "done",
  machine: "running",
  at: ago(5),
  ...over,
});
const pullRequest = (over: Partial<AldoHomePullRequest> = {}): AldoHomePullRequest =>
  ({
    repo: "acme/shop",
    number: 7,
    title: "Fix it",
    status: "watching",
    stage: "merged",
    mergesAt: null,
    thread: { environmentId: "aldo-t1", threadId: "th1" },
    greenSince: null,
    mergedAt: null,
    updatedAt: ago(5),
    ...over,
  }) as AldoHomePullRequest;
const home = (over: Record<string, unknown> = {}) =>
  ({
    conversations: [],
    pullRequests: [],
    upcoming: [],
    approvals: [],
    ...over,
  }) as unknown as AldoHome;
const board = (read: AldoHome, seenAt: number | null = null) =>
  presenceBoard(read, { now: NOW, seenAt });

describe("presenceBoard needs you", () => {
  const hidden = { id: "h", dismissed: true };
  const putOff = { id: "p", dismissed: true, until: ahead(60) };
  it("counts what's hidden from chat, tagged, as the app badge does", () => {
    const b = board(
      home({
        conversations: [
          conversation({ ref: "a", title: "Shown", state: "waiting" }),
          conversation({ ref: "b", title: "Hidden", state: "waiting", chatDecision: hidden }),
        ],
      }),
    );
    expect(b.needsYou.rows.map((r) => r.title)).toEqual(
      expect.arrayContaining(["Shown", "Hidden"]),
    );
    expect(b.needsYou.rows).toHaveLength(2);
    const row = b.needsYou.rows.find((r) => r.title === "Hidden")!;
    expect(row.detail).toContain("hidden from chat");
    expect(row.hidden).toEqual(hidden);
    expect(row.target).toEqual({ environmentId: "aldo-t1", threadId: "th1" });
    expect(b.needsYou.preview).toContain("1 hidden from chat");
  });
  it("leaves what they put off out of the count, and reports it", () => {
    const b = board(
      home({ conversations: [conversation({ state: "waiting", chatDecision: putOff })] }),
    );
    expect(b.needsYou.rows).toEqual([]);
    expect(b.putOff).toBe(1);
    expect(b.needsYou.preview).toBe("Nothing now · 1 put off");
  });
  it("reports a deferred plan as put off, so its list stays reachable", () => {
    const plan = {
      id: "p",
      goal: "Reconcile the books",
      cost: "Free",
      steps: [],
      minutes: 30,
      status: "proposed",
      proposedAt: ago(60),
      deferredUntil: ahead(600),
    };
    const b = board(home({ plans: [plan] }));
    expect(b.needsYou.rows).toEqual([]);
    expect(b.putOff).toBe(1);
    expect(b.needsYou.preview).toBe("Nothing now · 1 put off");
    expect(board(home({ plans: [{ ...plan, deferredUntil: ago(1) }] })).putOff).toBe(0);
  });
  it("counts a thread paused mid-turn, once", () => {
    const b = board(
      home({ conversations: [conversation({ state: "working", machine: "asleep" })] }),
    );
    expect(b.needsYou.rows).toHaveLength(1);
    expect(b.needsYou.rows[0]!.detail).toContain("Paused thread");
    expect(b.working.rows).toEqual([]);
  });
  it("says so when nothing waits", () => {
    expect(board(home()).needsYou.preview).toBe("Nothing waiting on you");
  });
  it("leaves what they dismissed out of every count, and lists it to restore", () => {
    const cleared = { id: "c", dismissed: true, cleared: true };
    const read = home({
      conversations: [
        conversation({ ref: "a", title: "Shown", state: "waiting" }),
        conversation({ ref: "b", title: "Dismissed", state: "failed", chatDecision: cleared }),
        conversation({
          ref: "p",
          title: "Paused",
          state: "paused",
          machine: "asleep",
          chatDecision: { ...cleared, id: "d" },
        }),
      ],
    });
    const b = board(read);
    expect(b.needsYou.rows.map((r) => r.title)).toEqual(["Shown"]);
    expect(b.dismissed.map((r) => r.title).sort()).toEqual(["Dismissed", "Paused"]);
    expect(b.dismissed[0]!.decision?.cleared).toBe(true);
    // The header, the Needs you row and the app badge say the same.
    expect(presenceLine({ ...quiet, waiting: b.needsYou.rows.length, fresh: true }).text).toBe(
      "1 thing needs you",
    );
    expect(aldoWaitingCount(read, NOW)).toBe(b.needsYou.rows.length);
  });
  it("keeps Needs you openable when only dismissed items remain, and says so", () => {
    const cleared = { id: "c", dismissed: true, cleared: true };
    const b = board(
      home({ conversations: [conversation({ state: "failed", chatDecision: cleared })] }),
    );
    expect(b.needsYou.rows).toEqual([]);
    expect(b.dismissed).toHaveLength(1);
    expect(b.needsYou.preview).toBe("Nothing now · 1 dismissed");
    // A different ask from the same thread has another id: it isn't dismissed.
    const next = { id: "n", dismissed: false };
    expect(
      board(home({ conversations: [conversation({ state: "failed", chatDecision: next })] }))
        .dismissed,
    ).toEqual([]);
  });
});

describe("presenceBoard moved", () => {
  it("lists finished threads and pull request milestones, newest first", () => {
    const b = board(
      home({
        conversations: [
          conversation({ ref: "a", title: "Alpha", stateAt: ago(30) }),
          conversation({
            ref: "b",
            title: "Beta",
            thread: { environmentId: "aldo-b", threadId: "b" },
            stateAt: ago(300),
          }),
        ],
        pullRequests: [
          pullRequest({
            number: 9,
            stage: "deploy-failed",
            updatedAt: ago(10),
            thread: { environmentId: "aldo-t1", threadId: "th1" },
          }),
        ],
      }),
    );
    expect(b.moved.rows.map((r) => [r.title, r.detail])).toEqual([
      ["Alpha", "#9 deploy failed · 10 min ago"],
      ["Beta", "Finished · 5 h ago"],
    ]);
    expect(b.moved.rows[0]!.tone).toBe("bad");
    expect(b.moved.preview).toBe("1 deploy failed · 1 finished");
  });
  it("counts from when they last looked, for a day", () => {
    const read = home({
      conversations: [
        conversation({ ref: "new", stateAt: ago(20) }),
        conversation({ ref: "seen", stateAt: ago(120) }),
        conversation({ ref: "old", stateAt: ago(25 * 60) }),
      ],
    });
    expect(board(read, NOW - 60 * 60_000).moved.rows).toHaveLength(1);
    expect(board(read, null).moved.rows).toHaveLength(2);
    expect(board(read, null).moved.preview).toBe("2 finished");
  });
  it("drops a thread that has moved on", () => {
    const read = (state: AldoHomeConversation["state"]) =>
      home({ conversations: [conversation({ state, stateAt: ago(5) })] });
    expect(board(read("done")).moved.rows).toHaveLength(1);
    expect(board(read("working")).moved.rows).toEqual([]);
    expect(board(read("waiting")).moved.rows).toEqual([]);
  });
  it("counts a routine's runs once, and a pull request that isn't news not at all", () => {
    const b = board(
      home({
        conversations: [
          conversation({ ref: "r1", routine: "daily", stateAt: ago(60) }),
          conversation({ ref: "r2", routine: "daily", stateAt: ago(20) }),
        ],
        pullRequests: [pullRequest({ stage: "checks-running", updatedAt: ago(1) })],
      }),
    );
    expect(b.moved.rows).toHaveLength(1);
    expect(b.moved.rows[0]!.detail).toMatch(/^Finished/);
  });
  it("prefers a pull request's word when it ties with finishing", () => {
    const b = board(
      home({
        conversations: [conversation({ stateAt: ago(5) })],
        pullRequests: [pullRequest({ stage: "merged", mergedAt: ago(5) })],
      }),
    );
    expect(b.moved.rows[0]!.detail).toMatch(/^#7 merged/);
  });
  it("treats green as news only when it merges itself", () => {
    const green = (mergesAt: string | null) =>
      board(
        home({
          conversations: [conversation({ stateAt: ago(500) })],
          pullRequests: [pullRequest({ stage: "green", greenSince: ago(5), mergesAt })],
        }),
      ).moved.rows[0]!.detail;
    expect(green(ahead(10))).toMatch(/^#7 checks passed/);
    expect(green(null)).toMatch(/^Finished/);
  });
});

describe("presenceBoard working and coming up", () => {
  it("says a thread with no word for an hour instead of working", () => {
    const b = board(
      home({
        conversations: [
          conversation({
            ref: "a",
            title: "Live",
            state: "working",
            stateAt: ago(3),
            summary: "Editing",
          }),
          conversation({
            ref: "b",
            title: "Silent",
            state: "working",
            at: ago(1),
            stateAt: ago(90),
          }),
        ],
      }),
    );
    expect(b.stuck).toBe(1);
    expect(b.working.rows.map((r) => r.detail)).toEqual(
      expect.arrayContaining(["Editing · for 3 min", "No word for 1 h 30 min"]),
    );
    expect(b.working.preview).toBe("1 with no word for over an hour");
  });
  it("previews the first working thread and the rest", () => {
    const two = board(
      home({
        conversations: [
          conversation({ ref: "a", title: "One", state: "working" }),
          conversation({ ref: "b", title: "Two", state: "working" }),
        ],
      }),
    );
    expect(two.working.preview).toMatch(/ \+ 1 more$/);
    expect(board(home()).working.preview).toBe("Nothing running");
  });
  it("lists deliveries and routines soonest first", () => {
    const b = board(
      home({
        upcoming: [
          {
            id: "d",
            dueAt: ahead(120),
            message: "Send the report",
            threadTitle: "Reports",
            thread: null,
            kind: "message",
          },
        ],
        routines: [
          {
            id: "r",
            title: "Morning brief",
            enabled: true,
            nextRunAt: ahead(30),
            when: "Daily",
            thread: null,
          },
          {
            id: "off",
            title: "Paused",
            enabled: false,
            nextRunAt: ahead(10),
            when: "Daily",
            thread: null,
          },
        ],
      }),
    );
    expect(b.coming.rows.map((r) => r.title)).toEqual(["Morning brief", "Send the report"]);
    expect(b.coming.preview).toMatch(/^Morning brief · /);
    expect(board(home()).coming.preview).toBe("Nothing scheduled");
  });
});
