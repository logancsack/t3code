import { describe, expect, it } from "vite-plus/test";

import { type AldoHomeConversation } from "./homeApi";
import { workstreamMeta, workstreamState } from "./workstream.logic";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const ahead = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

function conversation(over: Partial<AldoHomeConversation> = {}): AldoHomeConversation {
  return {
    ref: "t1",
    thread: { environmentId: "aldo-t1", threadId: "th1" },
    title: "Offer for Jordan",
    repos: [],
    branch: "aldo/t1",
    state: "working",
    machine: "running",
    at: ago(5),
    ...over,
  };
}

describe("workstreamState", () => {
  it("reads what the board reads", () => {
    expect(workstreamState(conversation(), NOW)).toBe("working");
    expect(workstreamState(conversation({ state: "queued" }), NOW)).toBe("working");
    expect(workstreamState(conversation({ state: "waiting" }), NOW)).toBe("needs");
    expect(workstreamState(conversation({ state: "failed" }), NOW)).toBe("needs");
    expect(workstreamState(conversation({ state: "done" }), NOW)).toBe("done");
    expect(workstreamState(conversation({ state: "new" }), NOW)).toBeNull();
  });

  it("needs the user once it's paused mid-turn; with no word for an hour it's still working", () => {
    expect(workstreamState(conversation({ machine: "asleep" }), NOW)).toBe("needs");
    expect(workstreamState(conversation({ at: ago(90) }), NOW)).toBe("working");
    expect(workstreamMeta(conversation({ at: ago(90) }), "working", NOW)).toBe(
      "no word for 1 h 30 min",
    );
  });

  it("keeps a long turn that is still moving working, counted from its start", () => {
    const c = conversation({ at: ago(1), stateAt: ago(62) });
    expect(workstreamMeta(c, "working", NOW)).toBe("for 1 h 2 min");
  });

  it("is put off while snoozed or settled, whatever it's doing", () => {
    expect(workstreamState(conversation({ state: "waiting", snoozedUntil: ahead(60) }), NOW)).toBe(
      "later",
    );
    expect(workstreamState(conversation({ state: "done", settled: true }), NOW)).toBe("later");
    expect(workstreamState(conversation({ state: "waiting", snoozedUntil: ago(1) }), NOW)).toBe(
      "needs",
    );
  });

  it("needs the user when a snoozed thread asks something new", () => {
    const pending = { kind: "approval", requestId: "r1", summary: "Run it?", options: [] } as const;
    expect(
      workstreamState(conversation({ state: "waiting", snoozedUntil: ahead(60), pending }), NOW),
    ).toBe("needs");
  });
});

describe("workstreamMeta", () => {
  it("says how long, or when it's back", () => {
    expect(workstreamMeta(conversation({ at: ago(4) }), "working", NOW)).toBe("for 4 min");
    expect(workstreamMeta(conversation({ at: ago(12) }), "needs", NOW)).toBe("waiting 12 min");
    expect(workstreamMeta(conversation({ at: ago(60) }), "done", NOW)).toBe("finished 1 h ago");
    expect(workstreamMeta(conversation({ snoozedUntil: ahead(120) }), "later", NOW)).toBe(
      "back in 2 h",
    );
    expect(workstreamMeta(conversation({ settled: true }), "later", NOW)).toBe("put away");
  });

  it("counts from when its state was reported, not a rename or a pin", () => {
    expect(workstreamMeta(conversation({ at: ago(1), stateAt: ago(30) }), "working", NOW)).toBe(
      "for 30 min",
    );
  });
});
