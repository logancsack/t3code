import { describe, expect, it } from "vite-plus/test";

import { addedWords, wordDiff } from "./diff.logic";

const marked = (before: string, after: string) =>
  wordDiff(before, after)
    .map((run) => (run.added ? `[${run.text}]` : run.text))
    .join("");

describe("wordDiff", () => {
  it("marks the words a rewrite added, a phrase as one mark", () => {
    expect(
      marked(
        "Hi Jordan,\n\nHere is your offer.",
        "Hi Jordan,\n\nWe're so glad to send your offer.",
      ),
    ).toBe("Hi Jordan,\n\n[We're so glad to send] your offer.");
  });

  it("gives back the new text whole, line breaks and all", () => {
    const after = "Hi Sam,\n\nWould noon work?\n\nThanks,\nLogan";
    expect(
      wordDiff("Hi Sam,\n\nLunch at noon?\n\nLogan", after)
        .map((r) => r.text)
        .join(""),
    ).toBe(after);
    // A mark never runs across a line: each line's new words are their own.
    expect(marked("Logan", "Thanks,\nLogan")).toBe("[Thanks,]\nLogan");
  });

  it("marks nothing when nothing was added, and everything when it's all new", () => {
    expect(marked("Here is your offer.", "Here is your offer.")).toBe("Here is your offer.");
    expect(marked("Here is your offer and the details.", "Here is your offer.")).toBe(
      "Here is your offer.",
    );
    expect(marked("", "All new words")).toBe("[All new words]");
    expect(wordDiff("Something", "")).toEqual([]);
  });

  it("counts what was added, and leaves a very long draft unmarked", () => {
    expect(marked("Here is your offer.", "Here is your offer, Jordan. Welcome!")).toBe(
      "Here is your offer[, Jordan]. [Welcome!]",
    );
    expect(
      addedWords(wordDiff("Here is your offer.", "Here is your offer, Jordan. Welcome!")),
    ).toBe(2);
    const long = Array.from({ length: 1_600 }, (_, i) => `w${i}`).join(" ");
    expect(wordDiff("short", long)).toEqual([{ text: long, added: false }]);
  });
});
