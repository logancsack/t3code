import { describe, expect, it } from "vite-plus/test";

import {
  aldoStartReason,
  describeAldoThreadStart,
  formatAldoStartElapsed,
} from "./threadStart.logic";

const REPOS = ["logancsack/aldo", "logancsack/t3code"];

describe("describeAldoThreadStart", () => {
  it("says the machine is being made, with what it clones, while a new one comes up", () => {
    const view = describeAldoThreadStart({
      start: { state: "starting" },
      machine: "new",
      repos: REPOS,
    });
    expect(view).toMatchObject({
      tone: "progress",
      label: "Starting",
      title: "Creating your cloud agent",
      reason: null,
      step: 0,
    });
    expect(view.body).toContain("cloning logancsack/aldo and logancsack/t3code");
  });

  it("names no repository for a thread in none", () => {
    const view = describeAldoThreadStart({
      start: { state: "starting" },
      machine: "new",
      repos: [""],
    });
    expect(view.body).toBe(
      "Setting up its machine. The agent gets its first message as soon as it's up.",
    );
  });

  it("moves to the agent once the machine is up", () => {
    expect(
      describeAldoThreadStart({ start: { state: "starting" }, machine: "ready", repos: REPOS }),
    ).toMatchObject({ title: "Starting the agent", step: 1 });
  });

  it("wakes a machine that's asleep", () => {
    expect(
      describeAldoThreadStart({ start: { state: "starting" }, machine: "stopped", repos: REPOS }),
    ).toMatchObject({ title: "Waking your cloud agent", step: 0 });
  });

  it("says why it waits, without telling the user to try again themselves", () => {
    const view = describeAldoThreadStart({
      start: {
        state: "queued",
        detail:
          "Your plan runs 6 cloud agents at once, and they're all busy. Try again when one finishes.",
      },
      machine: "new",
      repos: REPOS,
    });
    expect(view).toMatchObject({
      tone: "waiting",
      label: "Queued",
      title: "Waiting for room to start",
      body: "Aldo starts it on its own as soon as it can.",
      reason: "Your plan runs 6 cloud agents at once, and they're all busy.",
      step: 0,
    });
  });

  it("says what went wrong while it tries again, on the step it was on", () => {
    expect(
      describeAldoThreadStart({
        start: { state: "retrying", detail: "fatal: could not read from remote repository." },
        machine: "ready",
        repos: REPOS,
      }),
    ).toMatchObject({
      tone: "retrying",
      label: "Retrying",
      reason: "fatal: could not read from remote repository.",
      step: 1,
    });
  });

  it("says why it couldn't start, and stops the steps", () => {
    expect(
      describeAldoThreadStart({
        start: { state: "failed", detail: "Claude isn't signed in." },
        machine: "failed",
        repos: REPOS,
      }),
    ).toMatchObject({
      tone: "failed",
      label: "Failed",
      title: "Couldn't start this thread",
      reason: "Claude isn't signed in.",
      step: null,
    });
  });

  it("says where a message to a thread that's there stands: on its way, trying again, or not sent", () => {
    expect(
      describeAldoThreadStart({
        start: { kind: "message", state: "starting" },
        machine: "stopped",
        repos: REPOS,
      }),
    ).toMatchObject({
      tone: "progress",
      label: "Sending",
      title: "Waking your cloud agent",
      step: 0,
    });
    expect(
      describeAldoThreadStart({
        start: { kind: "message", state: "starting" },
        machine: "ready",
        repos: REPOS,
      }),
    ).toMatchObject({ label: "Sending", title: "Sending your message", step: 1 });
    expect(
      describeAldoThreadStart({
        start: { kind: "message", state: "retrying", detail: "T3 didn't start within 90 seconds." },
        machine: "ready",
        repos: REPOS,
      }),
    ).toMatchObject({
      tone: "retrying",
      label: "Retrying",
      title: "Trying again",
      reason: "T3 didn't start within 90 seconds.",
      step: 1,
    });
    expect(
      describeAldoThreadStart({
        start: {
          kind: "message",
          state: "failed",
          detail: "Couldn't send your message: the machine is out of credits.",
        },
        machine: "stopped",
        repos: REPOS,
      }),
    ).toMatchObject({
      tone: "failed",
      label: "Failed",
      title: "Couldn't send your message",
      reason: "the machine is out of credits.",
      step: null,
    });
  });
});

describe("aldoStartReason", () => {
  it("takes out the error line's opening and advice to try again", () => {
    expect(aldoStartReason("Couldn't start: Claude isn't signed in.")).toBe(
      "Claude isn't signed in.",
    );
    expect(aldoStartReason("They're all busy. Try again when one finishes.")).toBe(
      "They're all busy.",
    );
  });

  it("is null when nothing's left", () => {
    expect(aldoStartReason(undefined)).toBeNull();
    expect(aldoStartReason("Try again later.")).toBeNull();
  });
});

describe("formatAldoStartElapsed", () => {
  it("counts seconds, then minutes, then hours", () => {
    expect(formatAldoStartElapsed(42_000)).toBe("42s");
    expect(formatAldoStartElapsed(125_000)).toBe("2m 05s");
    expect(formatAldoStartElapsed(3_720_000)).toBe("1h 02m");
    expect(formatAldoStartElapsed(Number.NaN)).toBe("0s");
  });
});
