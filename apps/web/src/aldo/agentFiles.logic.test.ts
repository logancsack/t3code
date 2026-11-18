import { describe, expect, it } from "vite-plus/test";

import { isAgentFilePath, withoutAgentFiles } from "./agentFiles.logic";

describe("isAgentFilePath", () => {
  it("hides the agent's instructions, at any depth", () => {
    expect(isAgentFilePath("AGENTS.md")).toBe(true);
    expect(isAgentFilePath("CLAUDE.md")).toBe(true);
    expect(isAgentFilePath("trip/AGENTS.md")).toBe(true);
  });

  it("hides dotfiles, dot-folders and everything inside them", () => {
    expect(isAgentFilePath(".env")).toBe(true);
    expect(isAgentFilePath(".claude")).toBe(true);
    expect(isAgentFilePath(".codex/config.toml")).toBe(true);
    expect(isAgentFilePath("site/.venv/bin/python")).toBe(true);
  });

  it("hides tool folders and what's inside them", () => {
    expect(isAgentFilePath("node_modules")).toBe(true);
    expect(isAgentFilePath("render/node_modules/react/index.js")).toBe(true);
    expect(isAgentFilePath("scraper/__pycache__/main.cpython-312.pyc")).toBe(true);
    expect(isAgentFilePath("venv/lib")).toBe(true);
  });

  it("keeps the user's own files, including ones named like the agent's", () => {
    expect(isAgentFilePath("Fiverr gig listings.md")).toBe(false);
    expect(isAgentFilePath("portfolio/clip-1.mp4")).toBe(false);
    expect(isAgentFilePath("agents.md.bak")).toBe(false);
    expect(isAgentFilePath("notes/my-agents.md")).toBe(false);
    expect(isAgentFilePath("research/node_modules.txt")).toBe(false);
  });
});

describe("withoutAgentFiles", () => {
  it("keeps the user's entries in their order", () => {
    const entries = [
      { path: ".claude", kind: "directory" },
      { path: "AGENTS.md", kind: "file" },
      { path: "portfolio", kind: "directory" },
      { path: "portfolio/reel.mp4", kind: "file" },
      { path: "portfolio/.DS_Store", kind: "file" },
      { path: "plan.md", kind: "file" },
    ];
    expect(withoutAgentFiles(entries).map((entry) => entry.path)).toEqual([
      "portfolio",
      "portfolio/reel.mp4",
      "plan.md",
    ]);
  });
});
