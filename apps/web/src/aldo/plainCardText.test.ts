import { expect, it } from "vite-plus/test";
import { plainCardText } from "./plainCardText";
it("removes summary formatting while preserving technical paths, names and operators", () => {
  expect(plainCardText("Add **Settings → Models** and [Home](/home).")).toBe(
    "Add Settings → Models and Home.",
  );
  expect(plainCardText("Use `~/.codex`, `api_key` and `a * b`.")).toBe(
    "Use ~/.codex, api_key and a * b.",
  );
  expect(plainCardText("# Review\n*Keep it free*, __wait__ and ~~discard~~.")).toBe(
    "Review\nKeep it free, wait and discard.",
  );
  expect(plainCardText("Rename `__init__` to `__call__`.")).toBe("Rename __init__ to __call__.");
  expect(plainCardText("Return `Promise<void>` instead of `Promise<string>`.")).toBe(
    "Return Promise<void> instead of Promise<string>.",
  );
});
