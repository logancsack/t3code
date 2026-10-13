import { describe, expect, it } from "vite-plus/test";

import {
  ALDO_WARM_EVERY_MS,
  aldoWarmDue,
  answeredAldoWarm,
  askingAldoWarm,
  INITIAL_ALDO_WARM_STATE,
} from "./warm.logic";

const T0 = 1_800_000_000_000;
const typing = { text: "Plan a trip to Lis", newThreads: true, general: true, now: T0 };

describe("aldoWarmDue", () => {
  it("asks on the first words typed", () => {
    expect(aldoWarmDue(INITIAL_ALDO_WARM_STATE, typing)).toBe(true);
  });

  it("asks again only once a minute has passed while the typing goes on", () => {
    const asked = askingAldoWarm(INITIAL_ALDO_WARM_STATE, T0);
    expect(aldoWarmDue(asked, { ...typing, now: T0 + 1_000 })).toBe(false);
    expect(aldoWarmDue(asked, { ...typing, now: T0 + ALDO_WARM_EVERY_MS - 1 })).toBe(false);
    expect(aldoWarmDue(asked, { ...typing, now: T0 + ALDO_WARM_EVERY_MS })).toBe(true);
  });

  it("doesn't ask for an empty or blank composer", () => {
    expect(aldoWarmDue(INITIAL_ALDO_WARM_STATE, { ...typing, text: "" })).toBe(false);
    expect(aldoWarmDue(INITIAL_ALDO_WARM_STATE, { ...typing, text: "  \n" })).toBe(false);
  });

  it("doesn't ask when new threads' machines don't start right away", () => {
    expect(aldoWarmDue(INITIAL_ALDO_WARM_STATE, { ...typing, newThreads: false })).toBe(false);
  });

  it("doesn't ask an Aldo that can't start a thread outside a repository", () => {
    expect(aldoWarmDue(INITIAL_ALDO_WARM_STATE, { ...typing, general: false })).toBe(false);
  });
});

describe("answeredAldoWarm", () => {
  it("stops asking an Aldo without warm machines (404)", () => {
    const asked = askingAldoWarm(INITIAL_ALDO_WARM_STATE, T0);
    const older = answeredAldoWarm(asked, 404);
    expect(older.unsupported).toBe(true);
    expect(aldoWarmDue(older, { ...typing, now: T0 + 10 * ALDO_WARM_EVERY_MS })).toBe(false);
  });

  it("leaves be anything else, an error or no answer included: the next ask waits its minute", () => {
    for (const status of [202, 204, 401, 500, null]) {
      const answered = answeredAldoWarm(askingAldoWarm(INITIAL_ALDO_WARM_STATE, T0), status);
      expect(answered).toEqual({ askedAt: T0, unsupported: false });
      expect(aldoWarmDue(answered, { ...typing, now: T0 + ALDO_WARM_EVERY_MS })).toBe(true);
    }
  });
});
