import { describe, expect, it } from "vite-plus/test";

import type { AldoHeadsUpsTuning } from "./accountApi";
import {
  appsEveryOptions,
  appsNote,
  quietHoursNote,
  quietTimeOptions,
  topicsChange,
} from "./headsUps.logic";

const tuning = (over: Partial<AldoHeadsUpsTuning> = {}): AldoHeadsUpsTuning => ({
  quietStart: 1260,
  quietEnd: 420,
  appsEvery: 4,
  tell: "",
  skip: "",
  apps: [],
  ...over,
});

describe("quietTimeOptions", () => {
  it("offers every half hour of the day", () => {
    const options = quietTimeOptions(1260);
    expect(options).toHaveLength(48);
    expect(options[0]?.value).toBe("0");
    expect(options.at(-1)?.value).toBe("1410");
  });

  it("keeps a time set another way, in its place", () => {
    const values = quietTimeOptions(1275).map((o) => o.value);
    expect(values).toHaveLength(49);
    expect(values.indexOf("1275")).toBe(values.indexOf("1260") + 1);
  });
});

describe("appsEveryOptions", () => {
  it("offers 2, 4 and 8 hours, then Never", () => {
    expect(appsEveryOptions(4)).toEqual([
      { value: "2", label: "Every 2 hours" },
      { value: "4", label: "Every 4 hours" },
      { value: "8", label: "Every 8 hours" },
      { value: "0", label: "Never" },
    ]);
    expect(appsEveryOptions(0)).toHaveLength(4);
  });

  it("keeps an interval set another way", () => {
    expect(appsEveryOptions(6).map((o) => o.value)).toEqual(["2", "4", "6", "8", "0"]);
  });
});

describe("appsNote", () => {
  it("names the apps Aldo reads, or won't", () => {
    expect(appsNote(tuning())).toBeNull();
    expect(appsNote(tuning({ apps: ["Linear"] }))).toBe("Aldo reads only what's new in Linear.");
    expect(appsNote(tuning({ apps: ["Linear", "Notion"], appsEvery: 0 }))).toBe(
      "Aldo won't read Linear and Notion.",
    );
    expect(appsNote(tuning({ apps: ["Linear", "Notion", "Asana"] }))).toBe(
      "Aldo reads only what's new in Linear, Notion and Asana.",
    );
    expect(appsNote(tuning({ apps: ["Linear", "Notion", "Asana", "Jira"] }))).toBe(
      "Aldo reads only what's new in Linear, Notion and 2 more.",
    );
  });
});

describe("quietHoursNote", () => {
  it("says when the same two times mean never quiet", () => {
    expect(quietHoursNote(tuning())).toBeNull();
    expect(quietHoursNote(tuning({ quietStart: 0, quietEnd: 0 }))).toBe(
      "The same time: never quiet.",
    );
  });
});

describe("topicsChange", () => {
  it("sends only what differs from what's saved, as Aldo keeps it", () => {
    const saved = { tell: "flight changes", skip: "" };
    expect(topicsChange(saved, { tell: "  flight\nchanges ", skip: "" })).toEqual({});
    expect(topicsChange(saved, { tell: "flight changes", skip: " newsletters " })).toEqual({
      skip: "newsletters",
    });
    expect(topicsChange(saved, { tell: "", skip: "" })).toEqual({ tell: "" });
  });
});
