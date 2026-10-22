import { describe, expect, it } from "vite-plus/test";

import { backWhen, clockTime, fieldTime, notNowChoices, pickedTime } from "./notNow.logic";

// Wednesday, Oct 21 2026, in the user's own time.
const at = (hour: number, minute = 0, day = 21) => new Date(2026, 9, day, hour, minute);

describe("notNowChoices", () => {
  it("offers later today, tomorrow morning and next week, each with when", () => {
    expect(notNowChoices(at(15, 10)).map((c) => [c.label, c.when])).toEqual([
      ["Later today", "6:30 PM"],
      ["Tomorrow morning", "8:00 AM"],
      ["Next week", "Mon 8:00 AM"],
    ]);
    const [later, morning, week] = notNowChoices(at(15, 10));
    expect(later?.until).toEqual(at(18, 30));
    expect(morning?.until).toEqual(at(8, 0, 22));
    expect(week?.until).toEqual(at(8, 0, 26));
  });

  it("leaves out later today once it would be past 9 PM", () => {
    expect(notNowChoices(at(18, 0)).map((c) => c.key)).toEqual(["later", "morning", "next-week"]);
    expect(notNowChoices(at(18, 1)).map((c) => c.key)).toEqual(["morning", "next-week"]);
    expect(notNowChoices(at(23, 0)).map((c) => c.key)).toEqual(["morning", "next-week"]);
  });

  it("before dawn, the morning is this one", () => {
    const [, morning] = notNowChoices(at(2, 0));
    expect(morning).toMatchObject({ label: "This morning", until: at(8, 0) });
  });

  it("on a Sunday, next week's morning is tomorrow's, so it's offered once", () => {
    const sunday = at(15, 0, 25);
    expect(notNowChoices(sunday).map((c) => c.key)).toEqual(["later", "morning"]);
  });
});

describe("backWhen", () => {
  it("says when in the fewest words that are clear", () => {
    const now = at(15, 0);
    expect(backWhen(at(18, 30), now)).toBe("at 6:30 PM");
    expect(backWhen(at(8, 0, 22), now)).toBe("tomorrow at 8:00 AM");
    expect(backWhen(at(8, 0, 26), now)).toBe("Mon at 8:00 AM");
    expect(backWhen(new Date(2026, 10, 3, 8), now)).toBe("Nov 3 at 8:00 AM");
    expect(clockTime(at(0, 5))).toBe("12:05 AM");
    expect(clockTime(at(12, 0))).toBe("12:00 PM");
  });
});

describe("pickedTime", () => {
  it("takes a time from a minute to 30 days on, in the user's own time", () => {
    const now = at(15, 0);
    expect(pickedTime(fieldTime(at(18, 30)), now)).toEqual({ until: at(18, 30) });
    expect(pickedTime("", now)).toEqual({ error: "Pick a day and a time." });
    expect(pickedTime(fieldTime(at(14, 0)), now)).toEqual({ error: "Pick a time later than now." });
    expect(pickedTime(fieldTime(new Date(2026, 10, 30, 8)), now)).toEqual({
      error: "Pick a time within 30 days.",
    });
  });

  it("refuses a time that doesn't happen, rather than come back at another", () => {
    // As 2:30 the night the clocks go forward would: the date moves it on, and the field still says 2:30.
    expect(pickedTime("2026-11-31T10:00", at(15, 0))).toEqual({
      error: "That time doesn't happen here. Pick another.",
    });
  });
});
