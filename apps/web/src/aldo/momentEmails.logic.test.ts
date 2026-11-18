import { describe, expect, it } from "vite-plus/test";

import {
  ALDO_MOMENT_EMAIL_ROWS,
  momentEmailsIntro,
  parseAldoMomentEmails,
  withMomentEmail,
} from "./momentEmails.logic";

describe("moment emails", () => {
  it("reads Aldo's answer, and nothing else as one", () => {
    expect(
      parseAldoMomentEmails({ done: true, needsYou: false, failed: true, to: "sam@example.com" }),
    ).toEqual({ done: true, needsYou: false, failed: true, to: "sam@example.com" });
    expect(parseAldoMomentEmails({ done: true, needsYou: true, failed: true })).toEqual({
      done: true,
      needsYou: true,
      failed: true,
      to: "",
    });
    // An older Aldo's page, an error, a half answer: not settings.
    expect(parseAldoMomentEmails("<!doctype html>")).toBeNull();
    expect(parseAldoMomentEmails(null)).toBeNull();
    expect(parseAldoMomentEmails({ error: "Not found" })).toBeNull();
    expect(parseAldoMomentEmails({ done: true, needsYou: "yes", failed: true })).toBeNull();
  });

  it("changes one kind and leaves the others", () => {
    const settings = { done: true, needsYou: true, failed: true, to: "sam@example.com" };
    expect(withMomentEmail(settings, "needsYou", false)).toEqual({ ...settings, needsYou: false });
    expect(settings.needsYou).toBe(true);
  });

  it("has a row for each kind, in the stylebook's words", () => {
    expect(ALDO_MOMENT_EMAIL_ROWS.map((row) => row.kind)).toEqual(["done", "needsYou", "failed"]);
    for (const row of ALDO_MOMENT_EMAIL_ROWS) {
      for (const words of [row.title, row.description]) {
        expect(words).not.toMatch(/[!—]/);
        expect(words).not.toMatch(/[A-Za-z]'[A-Za-z]/);
      }
    }
    expect(momentEmailsIntro("sam@example.com")).toContain("to sam@example.com,");
    expect(momentEmailsIntro("")).not.toContain(" to ,");
  });
});
