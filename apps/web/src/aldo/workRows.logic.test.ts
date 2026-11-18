import { describe, expect, it } from "vite-plus/test";

import type { WorkLogEntry } from "../session-logic";
import {
  aldoDurationWords,
  aldoQuietWork,
  aldoStepCount,
  aldoWorkedLabel,
  aldoWorkGroups,
} from "./workRows.logic";

let seq = 0;
/** A minute apart, from 08:00, unless an entry says when. */
function at(minute: number): string {
  return new Date(Date.UTC(2026, 9, 20, 8, minute)).toISOString();
}

function tool(
  name: string,
  input: Record<string, unknown>,
  minute: number,
  extra: Partial<WorkLogEntry> = {},
): WorkLogEntry {
  seq += 1;
  return {
    id: `step-${seq}`,
    createdAt: at(minute),
    label: name,
    tone: "tool",
    itemType: "dynamic_tool_call",
    toolLifecycleStatus: "completed",
    toolData: { tool: name, state: { status: "completed", input, output: "ok" } },
    ...extra,
  } as WorkLogEntry;
}

function command(line: string, minute: number): WorkLogEntry {
  seq += 1;
  return {
    id: `step-${seq}`,
    createdAt: at(minute),
    label: "Ran command",
    tone: "tool",
    itemType: "command_execution",
    toolLifecycleStatus: "completed",
    command: line,
  } as WorkLogEntry;
}

function wrote(path: string, minute: number): WorkLogEntry {
  seq += 1;
  return {
    id: `step-${seq}`,
    createdAt: at(minute),
    label: "File change",
    tone: "tool",
    itemType: "file_change",
    toolLifecycleStatus: "completed",
    toolTitle: "write",
    changedFiles: [path],
  } as WorkLogEntry;
}

function thought(minute: number): WorkLogEntry {
  seq += 1;
  return {
    id: `step-${seq}`,
    createdAt: at(minute),
    label: "Thinking",
    tone: "thinking",
  } as WorkLogEntry;
}

const open = (url: string, minute: number) => tool("playwright_browser_navigate", { url }, minute);
const click = (element: string, minute: number) =>
  tool("playwright_browser_click", { element }, minute);
const snapshot = (minute: number) => tool("playwright_browser_snapshot", {}, minute);

describe("aldoDurationWords", () => {
  it("says seconds, minutes and hours as people do", () => {
    expect(aldoDurationWords(0)).toBe("1 sec");
    expect(aldoDurationWords(40_000)).toBe("40 sec");
    expect(aldoDurationWords(59_400)).toBe("59 sec");
    expect(aldoDurationWords(6 * 60_000 + 10_000)).toBe("6 min");
    expect(aldoDurationWords(31 * 60_000)).toBe("31 min");
    expect(aldoDurationWords(60 * 60_000)).toBe("1 hr");
    expect(aldoDurationWords(72 * 60_000)).toBe("1 hr 12 min");
  });
});

describe("aldoStepCount and aldoWorkedLabel", () => {
  it("counts tool calls, not thoughts, notices or a step's earlier updates", () => {
    const { toolLifecycleStatus: _status, ...opened } = open("https://www.fiverr.com", 0);
    const started = { ...opened, sourceActivityKind: "tool.started" } as WorkLogEntry;
    const done = { ...started, id: "done", sourceActivityKind: "tool.completed" } as WorkLogEntry;
    const notice = { ...thought(1), tone: "info", label: "Context compacted" } as WorkLogEntry;
    const entries = [started, done, thought(1), notice, command("ls", 2)];
    expect(aldoStepCount(entries)).toBe(2);
  });

  it("says how long it worked and how many steps it took", () => {
    const entries = Array.from({ length: 84 }, (_, index) => command("ls", index % 30));
    expect(aldoWorkedLabel(entries, 31 * 60_000)).toBe("Worked 31 min · 84 steps");
    expect(aldoWorkedLabel(entries.slice(0, 1), 40_000)).toBe("Worked 40 sec · 1 step");
    expect(aldoWorkedLabel(entries.slice(0, 2), null)).toBe("Worked · 2 steps");
  });

  it("says thinking alone as thinking", () => {
    expect(aldoWorkedLabel([thought(0)], 20_000)).toBe("Thought for 20 sec");
    expect(aldoWorkedLabel([thought(0)], null)).toBe("Thought it over");
  });

  it("says when the person stopped it", () => {
    const entries = Array.from({ length: 12 }, (_, index) => command("ls", index));
    expect(aldoWorkedLabel(entries, 4 * 60_000, true)).toBe("You stopped after 4 min · 12 steps");
    expect(aldoWorkedLabel([], null, true)).toBe("You stopped this response");
  });

  it("gives the timeline its row words with the plain step words", () => {
    expect(aldoQuietWork.worked).toBe(aldoWorkedLabel);
    expect(aldoQuietWork.step(open("https://www.fiverr.com/", 0), false)).toBe("Opened fiverr.com");
  });
});

describe("aldoWorkGroups", () => {
  it("puts a 30-minute run in plain-word groups, with no paths or commands", () => {
    const entries = [
      thought(0),
      tool("websearch", { query: "best selling motion graphics gigs" }, 0, {
        itemType: "web_search",
      }),
      open("https://www.fiverr.com/categories/video-animation", 1),
      snapshot(2),
      open("https://www.fiverr.com/gigs/logo-animation", 3),
      wrote("/vercel/work/general/Market and pricing.md", 5),
      wrote("/vercel/work/general/render.py", 6),
      ...Array.from({ length: 8 }, (_, index) =>
        command(
          `cd /vercel/work/general && ffmpeg -y -i frames/%04d.png -c:v libx264 clips/clip-0${index + 1}.mp4 2>&1 | tail -3`,
          7 + index,
        ),
      ),
      command("python3 render.py --final", 15),
      open("https://www.fiverr.com/join", 18),
      click("Continue with email button", 19),
      tool("aldo_fill_login", { site: "fiverr.com" }, 20),
      snapshot(21),
      tool(
        "aldo_share_file",
        { path: "/vercel/work/general/Gig listings.md", title: "Gig listings" },
        28,
      ),
    ];
    const groups = aldoWorkGroups(entries, at(31));
    expect(groups.map((group) => [group.kind, group.title])).toEqual([
      ["research", "Researched fiverr.com"],
      ["make", "Made a document and 8 videos"],
      ["site", "Worked on fiverr.com"],
      ["share", "Shared “Gig listings”"],
    ]);
    // A group is keyed by its first step, and thoughts aren't steps.
    expect(groups[0]!.key).toBe(entries[1]!.id);
    // Opening the sign-up page is a look until it acts there.
    expect(groups[0]!.elapsedMs).toBe(6 * 60_000);
    expect(groups.map((group) => group.steps)).toEqual([5, 11, 3, 1]);
    expect(groups.reduce((sum, group) => sum + (group.elapsedMs ?? 0), 0)).toBe(31 * 60_000);
    expect(groups.reduce((sum, group) => sum + group.steps, 0)).toBe(aldoStepCount(entries));
    const words = groups.flatMap((group) => [group.title, ...group.items]).join("\n");
    expect(words).not.toMatch(/\/vercel|ffmpeg|render\.py|playwright|aldo_|libx264|\.png/);
    expect(groups[0]!.items).toEqual([
      "Searched the web for “best selling motion graphics gigs”",
      "Opened fiverr.com",
    ]);
    expect(groups[2]!.items).toContain("Clicked Continue with email button");
  });

  it("names what it made by kind, and lists a few", () => {
    const clips = Array.from({ length: 8 }, (_, index) =>
      command(`ffmpeg -i in.mov -t 6 "clip ${index + 1}.mp4"`, index),
    );
    const [made] = aldoWorkGroups(clips, at(8));
    expect(made!.title).toBe("Made 8 videos");
    expect(made!.items).toEqual([
      "Made clip 1.mp4",
      "Made clip 2.mp4",
      "Made clip 3.mp4",
      "and 5 more",
    ]);
    expect(aldoWorkGroups([wrote("/w/Subscriptions.xlsx", 0)])[0]!.title).toBe(
      "Made Subscriptions.xlsx",
    );
  });

  it("says a script was written without naming it", () => {
    const [group] = aldoWorkGroups([wrote("/w/render.py", 0), command("python3 render.py", 1)]);
    expect(group!.title).toBe("Wrote a script");
    expect(group!.items).toEqual([]);
    expect(aldoWorkGroups([wrote("/w/render.py", 0), wrote("/w/build.sh", 1)])[0]!.title).toBe(
      "Wrote 2 scripts",
    );
  });

  it("keeps looking at a site with the work on it", () => {
    const groups = aldoWorkGroups([
      open("https://www.fiverr.com/join", 0),
      click("Join", 1),
      snapshot(2),
      open("https://www.fiverr.com/seller_onboarding", 3),
      click("Continue", 4),
    ]);
    // The first look is research until it acts on the site.
    expect(groups.map((group) => group.title)).toEqual([
      "Researched fiverr.com",
      "Worked on fiverr.com",
    ]);
    expect(groups[1]!.steps).toBe(4);
  });

  it("counts sites it looked at", () => {
    const [group] = aldoWorkGroups([
      open("https://www.fiverr.com", 0),
      open("https://www.upwork.com", 1),
      open("https://www.behance.net", 2),
    ]);
    expect(group!.title).toBe("Researched 3 sites");
  });

  it("puts steps it can't word in the group they came in", () => {
    const groups = aldoWorkGroups([
      open("https://www.fiverr.com", 0),
      tool("gig_lookup", {}, 1),
      command("ls -la", 2),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.steps).toBe(3);
    expect(groups[0]!.items).toEqual(["Opened fiverr.com", "Used gig lookup"]);
  });

  it("says work with no kind yet as what it did", () => {
    expect(aldoWorkGroups([command("pip install openpyxl", 0)])[0]!.title).toBe(
      "Installed what it needs",
    );
    expect(aldoWorkGroups([command("ls", 0), command("cat notes.txt", 1)])[0]!.title).toBe(
      "Looked through files",
    );
    expect(aldoWorkGroups([])).toEqual([]);
  });

  it("only adds to the end while the work streams", () => {
    const entries = [
      open("https://www.fiverr.com", 0),
      wrote("/w/notes.md", 1),
      open("https://www.upwork.com", 2),
      click("Sign up", 3),
      tool("aldo_share_file", { path: "/w/notes.md", title: "Notes" }, 4),
    ];
    let before = aldoWorkGroups([]);
    for (let count = 1; count <= entries.length; count += 1) {
      const now = aldoWorkGroups(entries.slice(0, count));
      expect(now.slice(0, before.length).map((group) => group.key)).toEqual(
        before.map((group) => group.key),
      );
      before = now;
    }
    expect(before.map((group) => group.kind)).toEqual(["research", "make", "site", "share"]);
    // A later look at another site goes back into the research it belongs to.
    expect(before[0]!.title).toBe("Researched 2 sites");
  });

  it("times the last step until the run ended, and leaves it out while it runs", () => {
    const entries = [open("https://www.fiverr.com", 0), snapshot(2)];
    expect(aldoWorkGroups(entries, at(5))[0]!.elapsedMs).toBe(5 * 60_000);
    expect(aldoWorkGroups(entries)[0]!.elapsedMs).toBe(2 * 60_000);
    expect(aldoWorkGroups([open("https://www.fiverr.com", 0)])[0]!.elapsedMs).toBeNull();
  });
});
