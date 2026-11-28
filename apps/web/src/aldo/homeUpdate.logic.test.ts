import { describe, expect, it } from "vite-plus/test";
import { distinctSources, homeUpdateOf, legacyHomeUpdate, safeUpdateUrl } from "./homeUpdate.logic";

const target = { environmentId: "aldo-demo", threadId: "work" };
const update = {
  id: "report-1",
  title: "Agent practices",
  thread: target,
  state: "unfinished",
  summary: "I’ve checked the safeguards. I still need to run the first real-world comparison.",
  checked: ["Type checking and lint passed."],
  notChecked: ["First live model comparison and its saved results."],
  links: [],
} as const;
const trigger =
  'I haven\'t finished "Plan: production-grade agent practices for Aldo". The agent reports the task is unfinished. The task is unfinished; its next step is saved.\n\nChecks reported with the task:\n\nChecked:\nIncluded usage limits, duplicate prevention, permissions and Stop handling passed focused checks. Type checking and lint passed.\n\nNot checked:\nFirst live model comparison and its saved results.\n\nThread: https://aldo.computer/aldo-demo/work';

describe("Home update compatibility", () => {
  it("reads a saved update without losing its evidence or changing its recorded state", () => {
    expect(homeUpdateOf(update)).toEqual(update);
    expect(homeUpdateOf({ ...update, state: "invented" })).toBeNull();
    expect(homeUpdateOf({ ...update, checked: "not a list" })).toBeNull();
    expect(homeUpdateOf({ ...update, thread: { environmentId: "aldo-demo" } })).toBeNull();
  });
  it("reads the full answer, every source and a partial result, leaving out only what doesn't fit", () => {
    const sources = Array.from({ length: 5 }, (_, i) => ({
      label: `Source ${i}`,
      url: `https://example.com/${i}`,
    }));
    const full = { ...update, answer: "**Gusto Plus**, at $80 a month.", sources, partial: true };
    expect(homeUpdateOf(full)).toEqual(full);
    expect(
      homeUpdateOf({
        ...full,
        answer: 42,
        sources: [{ label: "x", url: "javascript:alert(1)" }],
        partial: "yes",
      }),
    ).toEqual(update);
    expect(homeUpdateOf({ ...update, answer: "x".repeat(20_001) })).toEqual(update);
  });
  it("turns the exact old four-paragraph trigger into one conservative update, retaining original evidence", () => {
    const parsed = legacyHomeUpdate(trigger)!;
    expect(parsed.thread).toEqual(target);
    expect(parsed.state).toBe("unfinished");
    expect(parsed.summary).toBe("I haven’t finished this work yet.");
    expect(parsed.checked).toEqual([
      "Included usage limits, duplicate prevention, permissions and Stop handling passed focused checks. Type checking and lint passed.",
    ]);
    expect(parsed.notChecked).toEqual(update.notChecked);
    expect(legacyHomeUpdate("Here is the thread: https://aldo.computer/aldo-demo/work")).toBeNull();
    expect(
      legacyHomeUpdate("I’ve prepared a draft.\n\nThread: https://aldo.computer/aldo-demo/work")
        ?.state,
    ).toBe("update");
  });
  it("rejects unsafe and malformed links while accepting named destinations", () => {
    for (const url of [
      "javascript:alert(1)",
      "//evil.example",
      "/\\evil.example",
      "https://",
      "https://user:password@example.com",
    ]) {
      expect(safeUpdateUrl(url), url).toBe(false);
      expect(homeUpdateOf({ ...update, links: [{ label: "Open", url }] }), url).toBeNull();
    }
    for (const url of ["/admin/reliability", "https://aldo.computer/s/result"])
      expect(safeUpdateUrl(url)).toBe(true);
  });
  it("keeps the original legacy report when its summary needs a plain fallback", () => {
    const original =
      "I couldn’t finish the deployment. The agent needs you to add the production API key in Settings before it can continue.";
    const parsed = legacyHomeUpdate(`${original}\n\nThread: https://aldo.computer/aldo-demo/work`)!;
    expect(parsed.summary).toBe("I couldn’t finish this attempt.");
    expect(parsed.notes).toEqual([original]);
    expect(parsed.checked).toEqual([]);
  });
});

describe("distinctSources", () => {
  it("says which page a source is when its site names more than one", () => {
    const shown = distinctSources([
      { url: "https://nodejs.org/en", label: "nodejs.org" },
      { url: "https://www.nodejs.org/en/download/", label: "nodejs.org" },
      { url: "https://nodejs.org/", label: "nodejs.org" },
      { url: "https://github.com/nodejs/release#release-schedule", label: "github.com" },
      { url: "https://example.com/a", label: "Release notes" },
      { url: "https://example.com/b", label: "Release notes" },
    ]).map((s) => s.label);
    expect(shown).toEqual([
      "nodejs.org/en",
      "nodejs.org/en/download",
      "nodejs.org",
      "github.com",
      "Release notes",
      "Release notes",
    ]);
  });

  it("leaves a lone site or an agent's own words as they are", () => {
    const sources = [
      { url: "https://nodejs.org/en", label: "nodejs.org" },
      { url: "https://nodejs.org/en/download", label: "Node downloads" },
    ];
    expect(distinctSources(sources)).toEqual(sources);
  });
});
