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
});
