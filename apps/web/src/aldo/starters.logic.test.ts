import { describe, expect, it } from "vite-plus/test";

import { ALDO_INTERESTS } from "./onboarding.logic";
import {
  ALDO_STARTERS,
  aldoStarterPage,
  aldoStartersFor,
  aldoStarterTime,
  STARTERS_AT_A_TIME,
} from "./starters.logic";

const firstFour = (interests: Parameters<typeof aldoStartersFor>[0]) =>
  aldoStarterPage(aldoStartersFor(interests), 0).map((s) => s.id);

describe("Home's starters", () => {
  it("lead with what they said, the kinds they picked taken in turn", () => {
    expect(firstFour(["business"])).toEqual(["fiverr", "price", "customers", "business-plan"]);
    expect(firstFour(["business", "media"])).toEqual(["fiverr", "promo", "price", "logo"]);
    expect(firstFour(["finance", "documents", "research"])).toEqual([
      "budget",
      "deck",
      "research",
      "receipts",
    ]);
    expect(firstFour(["code"])).toEqual(["build", "bug", "script", "review"]);
  });

  it("start with a mix for someone who skipped, or was never asked", () => {
    expect(firstFour([])).toEqual(["research", "deck", "promo", "inbox"]);
    expect(firstFour(null)).toEqual(["research", "deck", "promo", "inbox"]);
  });

  it("offer code only for code, and to accounts from before the welcome", () => {
    const interests = (list: ReturnType<typeof aldoStartersFor>) =>
      new Set(list.map((s) => s.interest));
    expect(interests(aldoStartersFor([])).has("code")).toBe(false);
    expect(interests(aldoStartersFor(["business", "media"])).has("code")).toBe(false);
    expect(interests(aldoStartersFor(["code"])).has("code")).toBe(true);
    expect(interests(aldoStartersFor(null)).has("code")).toBe(true);
  });

  it("list every starter once, the picked kinds' first", () => {
    const all = aldoStartersFor(["media"]);
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    expect(all.length).toBe(ALDO_STARTERS.filter((s) => s.interest !== "code").length);
    expect(all.slice(0, 4).every((s) => s.interest === "media")).toBe(true);
  });

  it("each are a real request with a time, a good set for every kind of work", () => {
    for (const { id } of ALDO_INTERESTS) {
      expect(ALDO_STARTERS.filter((s) => s.interest === id).length).toBeGreaterThanOrEqual(4);
    }
    for (const starter of ALDO_STARTERS) {
      expect(starter.minutes).toBeGreaterThan(0);
      expect(aldoStarterTime(starter)).toMatch(/^About \d+ min$/);
      // Curly apostrophes and no em dashes (docs/stylebook.md).
      expect(`${starter.title} ${starter.detail} ${starter.words}`).not.toMatch(/['—]/);
      // A request to finish ends where the user's details go.
      expect(starter.words.endsWith(": ") || starter.words.endsWith(".")).toBe(true);
    }
    expect(ALDO_STARTERS.find((s) => s.id === "trip")).toBeUndefined();
    expect(ALDO_STARTERS.find((s) => s.id === "fiverr")).toMatchObject({
      title: "Start a Fiverr business",
      minutes: 30,
    });
  });

  it("keep what needs more than words: mail for the inbox, a repository for code", () => {
    expect(ALDO_STARTERS.find((s) => s.id === "inbox")?.needs).toBe("mail");
    expect(ALDO_STARTERS.find((s) => s.id === "build")?.needs).toBe("repository");
  });

  it("show four at a time, going round", () => {
    const list = ["a", "b", "c", "d", "e", "f"];
    expect(STARTERS_AT_A_TIME).toBe(4);
    expect(aldoStarterPage(list, 0)).toEqual(["a", "b", "c", "d"]);
    expect(aldoStarterPage(list, 1)).toEqual(["e", "f", "a", "b"]);
    expect(aldoStarterPage(["a", "b"], 3)).toEqual(["a", "b"]);
  });
});
