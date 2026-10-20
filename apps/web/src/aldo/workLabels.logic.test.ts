import { describe, expect, it } from "vite-plus/test";

import type { WorkLogEntry } from "../session-logic";
import { aldoShareOf, aldoSharesByTurn, aldoWorkWords } from "./workLabels.logic";

/** A step as OpenCode records it: the tool's name and its state, input and output. */
function openCode(
  tool: string,
  input: Record<string, unknown>,
  output: string,
  extra: Partial<WorkLogEntry> = {},
): WorkLogEntry {
  return {
    id: `${tool}-1`,
    createdAt: "2026-10-20T08:00:00.000Z",
    label: tool,
    detail: output,
    tone: "tool",
    itemType: "dynamic_tool_call",
    toolLifecycleStatus: "completed",
    toolData: { tool, state: { status: "completed", input, output } },
    ...extra,
  } as WorkLogEntry;
}

describe("OpenCode's steps", () => {
  it("finds what it shared, with its path, title and link", () => {
    const share = openCode(
      "aldo_share_file",
      { path: "/vercel/work/general/plan.md", title: "Launch plan" },
      'Shared "Launch plan": https://aldo.computer/s/abc (anyone with the link)',
      { turnId: "turn-1" as NonNullable<WorkLogEntry["turnId"]> },
    );
    expect(aldoShareOf(share)).toEqual({
      path: "/vercel/work/general/plan.md",
      title: "Launch plan",
      url: "https://aldo.computer/s/abc",
    });
    expect(aldoSharesByTurn([share])).toEqual([["turn-1", [aldoShareOf(share)]]]);
    expect(aldoWorkWords.step(share, false)).toBe("Shared “Launch plan”");
  });

  it("names the site a browser step opened, from what it was asked", () => {
    const open = openCode(
      "playwright_browser_navigate",
      { url: "https://www.fiverr.com/start_selling" },
      "### Ran Playwright code",
    );
    expect(aldoWorkWords.step(open, false)).toBe("Opened fiverr.com");
    expect(aldoWorkWords.step(open, true)).toBe("Opening fiverr.com");
  });

  it("never labels a step with what its tool said back", () => {
    const page = `{"results":[${'{"title":"Motion graphics gig","price":45},'.repeat(20)}]}`;
    expect(aldoWorkWords.step(openCode("gig_lookup", {}, page), false)).toBe("Used gig lookup");
    expect(aldoWorkWords.step(openCode("gig_lookup", {}, page), true)).toBe("Using gig lookup");
    expect(
      aldoWorkWords.step(openCode("src/odd.name", {}, page, { toolData: undefined }), false),
    ).toBe("Worked on it");
    // A warning's words are what it says, however long.
    expect(
      aldoWorkWords.step(
        openCode("gig_lookup", {}, page, { tone: "info", toolData: undefined }),
        false,
      ),
    ).toBeNull();
    // A short line of its own is a label already, and a failure keeps T3's.
    expect(aldoWorkWords.step(openCode("gig_lookup", {}, "Found 3 gigs"), false)).toBeNull();
    expect(
      aldoWorkWords.step(
        openCode("gig_lookup", {}, page, { toolLifecycleStatus: "failed" }),
        false,
      ),
    ).toBeNull();
  });
});
