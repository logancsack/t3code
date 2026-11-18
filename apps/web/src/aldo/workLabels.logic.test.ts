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

  it("says what a search tool looked for", () => {
    const search = openCode("websearch", { query: "fiverr motion graphics pricing" }, "1. …");
    expect(aldoWorkWords.step(search, false)).toBe(
      "Searched the web for “fiverr motion graphics pricing”",
    );
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
    // Nor with a short line of its own; a failure keeps T3's label.
    expect(aldoWorkWords.step(openCode("gig_lookup", {}, "Found 3 gigs"), false)).toBe(
      "Used gig lookup",
    );
    expect(
      aldoWorkWords.step(
        openCode("gig_lookup", {}, page, { toolLifecycleStatus: "failed" }),
        false,
      ),
    ).toBeNull();
    // Nor does one the provider or the user kept from running.
    for (const status of ["declined", "stopped"] as const) {
      expect(
        aldoWorkWords.step(openCode("gig_lookup", {}, "", { toolLifecycleStatus: status }), true),
      ).toBeNull();
    }
  });
});

describe("commands", () => {
  const ran = (command: string) =>
    ({
      id: "command-1",
      createdAt: "2026-10-20T08:00:00.000Z",
      label: "Ran command",
      tone: "tool",
      itemType: "command_execution",
      toolLifecycleStatus: "completed",
      command,
    }) as WorkLogEntry;

  it("names the file a video or image command makes", () => {
    expect(
      aldoWorkWords.step(
        ran("cd /w && ffmpeg -y -i frames/%04d.png -c:v libx264 clips/clip-01.mp4 2>&1 | tail"),
        false,
      ),
    ).toBe("Made clip-01.mp4");
    expect(aldoWorkWords.step(ran(`ffmpeg -i in.mov "Logo reveal.mp4"`), true)).toBe(
      "Making Logo reveal.mp4",
    );
    expect(aldoWorkWords.step(ran("magick in.png -resize 50% thumb.webp"), false)).toBe(
      "Made thumb.webp",
    );
    expect(aldoWorkWords.step(ran("ffmpeg -version"), false)).toBe("Worked on a video");
    expect(aldoWorkWords.step(ran("ffmpeg -i clip.mp4 -f null -"), false)).toBe(
      "Worked on a video",
    );
    expect(aldoWorkWords.step(ran("ffprobe clip.mp4"), false)).toBe("Checked a video");
  });

  it("doesn't call reading an image making it", () => {
    expect(aldoWorkWords.step(ran("magick identify photo.png"), false)).toBe("Checked an image");
    expect(aldoWorkWords.step(ran("identify -verbose photo.png"), true)).toBe("Checking an image");
    expect(aldoWorkWords.step(ran("magick photo.png -strip clean.png"), false)).toBe(
      "Made clean.png",
    );
  });
});
