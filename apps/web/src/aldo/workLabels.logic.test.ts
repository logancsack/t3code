import { describe, expect, it } from "vite-plus/test";

import type { WorkLogEntry } from "../session-logic";
import {
  aldoShareOf,
  aldoSharesByTurn,
  aldoSiteOf,
  aldoStepsInOrder,
  aldoWorkingWords,
  aldoWorkRecap,
  aldoWorkStep,
} from "./workLabels.logic";

type Entry = Parameters<typeof aldoWorkStep>[0];

function entry(fields: Partial<WorkLogEntry>): Entry {
  return { label: "Tool call", tone: "tool", ...fields };
}

/** Codex records an MCP call's server, tool and arguments. */
function codex(server: string, tool: string, args: unknown, result?: unknown): Entry {
  return entry({
    label: "MCP tool call",
    itemType: "mcp_tool_call",
    toolTitle: `${server} · ${tool}`,
    toolData: {
      type: "mcpToolCall",
      id: "x",
      server,
      tool,
      status: "completed",
      arguments: args,
      result,
    },
  });
}

/** Claude records "name: {input}", cut at 400 characters. */
function claude(
  name: string,
  input: unknown,
  itemType: WorkLogEntry["itemType"] = "mcp_tool_call",
): Entry {
  return entry({ label: "MCP tool call", itemType, detail: `${name}: ${JSON.stringify(input)}` });
}

/** OpenCode titles a step with the tool's name and records its output. */
function opencode(tool: string, output?: string): Entry {
  return entry({
    label: tool,
    itemType: "mcp_tool_call",
    toolTitle: tool,
    ...(output ? { detail: output } : {}),
  });
}

function command(cmd: string): Entry {
  return entry({ label: "Ran command", itemType: "command_execution", command: cmd });
}

describe("aldoWorkStep", () => {
  it("puts the browser's steps in words, from each agent", () => {
    expect(
      aldoWorkStep(
        codex("playwright", "browser_navigate", { url: "https://www.opentable.com/r/x" }),
      )?.done,
    ).toBe("Opened opentable.com");
    expect(
      aldoWorkStep(
        claude("mcp__playwright__browser_navigate", { url: "https://resy.com/cities/ny" }),
      )?.done,
    ).toBe("Opened resy.com");
    expect(
      aldoWorkStep(
        opencode(
          "playwright_browser_navigate",
          "### Page state\n- Page URL: https://www.delta.com/\n",
        ),
      )?.done,
    ).toBe("Opened delta.com");
    expect(
      aldoWorkStep(
        claude("mcp__playwright__browser_click", { element: "Reserve button", ref: "e12" }),
      )?.done,
    ).toBe("Clicked Reserve button");
    expect(aldoWorkStep(codex("playwright", "browser_fill_form", { fields: [] }))?.done).toBe(
      "Filled in a form",
    );
  });

  it("reads what it can of an input cut short", () => {
    const long = `mcp__aldo__share_file: {"path":"/vercel/work/aldo/trip.html","title":"Lisbon in May","public":true,"notes":"${"x".repeat(400)}`;
    expect(
      aldoWorkStep(entry({ itemType: "file_change", detail: `${long.slice(0, 397)}...` }))?.done,
    ).toBe("Shared “Lisbon in May”");
  });

  it("names Aldo's own steps", () => {
    expect(aldoWorkStep(codex("aldo", "request_approval", { kind: "email" }))?.done).toBe(
      "Asked you to approve an email",
    );
    expect(
      aldoWorkStep(
        claude("mcp__aldo__add_routine", { title: "Morning brief", schedule: "0 8 * * *" }),
      )?.done,
    ).toBe("Created routine · Morning brief");
    expect(aldoWorkStep(opencode("aldo_notify_user"))?.done).toBe("Sent you a notification");
    expect(aldoWorkStep(codex("aldo", "list_threads", {}))?.done).toBe("Checked threads");
    expect(aldoWorkStep(codex("aldo", "something_new", {}))?.done).toBe("Something new");
  });

  it("knows the apps a command reaches", () => {
    expect(
      aldoWorkStep(
        command(
          `curl -s -H "Authorization: Bearer $GOOGLE_ACCESS_TOKEN" "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread"`,
        ),
      )?.done,
    ).toBe("Read your Gmail");
    expect(
      aldoWorkStep(
        command(
          `curl -X POST https://gmail.googleapis.com/gmail/v1/users/me/drafts -d @draft.json`,
        ),
      )?.done,
    ).toBe("Drafted an email");
    expect(
      aldoWorkStep(
        command(
          `curl -s "https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=x"`,
        ),
      )?.done,
    ).toBe("Checked your calendar");
    expect(
      aldoWorkStep(command(`curl -s https://api.agentmail.to/v0/inboxes/a@b/messages`))?.done,
    ).toBe("Checked the agent's inbox");
    expect(aldoWorkStep(command(`curl -sL https://www.example.com/menu`))?.done).toBe(
      "Fetched example.com",
    );
  });

  it("says what a command did without the command", () => {
    expect(aldoWorkStep(command("cd /tmp && python3 build_deck.py --final"))?.done).toBe(
      "Ran build_deck.py",
    );
    expect(aldoWorkStep(command("python3 - <<'EOF'\nprint(1)\nEOF"))?.done).toBe(
      "Ran a quick script",
    );
    expect(
      aldoWorkStep(command("soffice --headless --convert-to pdf --outdir out Report.docx"))?.done,
    ).toBe("Converted Report.docx to PDF");
    expect(aldoWorkStep(command("sudo apt-get install -y libreoffice-calc"))?.done).toBe(
      "Installed what it needs",
    );
    expect(aldoWorkStep(command("ls -la"))?.done).toBe("Looked through files");
    expect(aldoWorkStep(command("Bash: pdftotext invoice.pdf -"))?.done).toBe("Read invoice.pdf");
    expect(aldoWorkStep(command("make release"))?.done).toBe("Ran a command");
  });

  it("names the files it makes and edits", () => {
    expect(
      aldoWorkStep(
        claude(
          "Write",
          { file_path: "/vercel/work/aldo/Budget.xlsx", content: "…" },
          "file_change",
        ),
      )?.done,
    ).toBe("Made Budget.xlsx");
    expect(
      aldoWorkStep(
        claude("Edit", { file_path: "/vercel/work/aldo/notes.md", old_string: "a" }, "file_change"),
      )?.done,
    ).toBe("Edited notes.md");
    expect(
      aldoWorkStep(
        entry({
          itemType: "file_change",
          toolTitle: "File change",
          changedFiles: ["a/plan.md", "b.md"],
        }),
      )?.done,
    ).toBe("Saved plan.md and 1 more");
  });

  it("names searches, reads and plans", () => {
    expect(
      aldoWorkStep(claude("WebSearch", { query: "best ramen in Lisbon" }, "web_search"))?.done,
    ).toBe("Searched the web for “best ramen in Lisbon”");
    expect(aldoWorkStep(entry({ itemType: "web_search", detail: "flights to Lisbon" }))?.done).toBe(
      "Searched the web for “flights to Lisbon”",
    );
    expect(
      aldoWorkStep(claude("WebFetch", { url: "https://www.nytimes.com/a" }, "dynamic_tool_call"))
        ?.done,
    ).toBe("Read nytimes.com");
    expect(aldoWorkStep(claude("TodoWrite", { todos: [] }, "dynamic_tool_call"))?.done).toBe(
      "Updated its plan",
    );
  });

  it("leaves what it doesn't know, and errors, to T3", () => {
    expect(
      aldoWorkStep(entry({ itemType: "dynamic_tool_call", detail: "Something happened" })),
    ).toBeNull();
    expect(aldoWorkStep({ ...command("ls"), tone: "error" })).toBeNull();
    expect(aldoWorkStep(entry({ tone: "thinking", label: "Thinking" }))).toBeNull();
    // Failed, declined or stopped by the provider's own account, without an error tone.
    for (const status of ["failed", "declined", "stopped"] as const) {
      const share = codex("aldo", "share_file", { path: "/tmp/plan.html" });
      expect(aldoWorkStep({ ...share, toolLifecycleStatus: status })).toBeNull();
      expect(aldoWorkStep({ ...command("git push"), toolLifecycleStatus: status })).toBeNull();
    }
    expect(
      aldoWorkStep({ ...command("git push"), toolLifecycleStatus: "completed" }),
    ).not.toBeNull();
  });
});

describe("aldoSiteOf", () => {
  it("keeps a site's name and leaves out what isn't one", () => {
    expect(aldoSiteOf("https://www.opentable.com/x")).toBe("opentable.com");
    expect(aldoSiteOf("http://localhost:3000/")).toBe("a preview");
    expect(aldoSiteOf("file:///etc/passwd")).toBeNull();
    expect(aldoSiteOf("not a url")).toBeNull();
  });
});

describe("aldoStepsInOrder", () => {
  it("carries the page it's on to the clicks after it", () => {
    const steps = aldoStepsInOrder([
      codex("playwright", "browser_navigate", { url: "https://www.opentable.com" }),
      codex("playwright", "browser_click", { element: "Search" }),
    ]);
    expect(steps[1]?.site).toBe("opentable.com");
  });
});

describe("aldoWorkRecap", () => {
  it("says what a turn did in a line", () => {
    expect(
      aldoWorkRecap([
        codex("playwright", "browser_navigate", { url: "https://www.opentable.com" }),
        codex("playwright", "browser_click", { element: "Search" }),
        codex("playwright", "browser_navigate", { url: "https://resy.com" }),
        claude("Write", { file_path: "/w/Dinner.html" }, "file_change"),
        command("python3 build.py"),
        codex("aldo", "share_file", { path: "/w/Dinner.html", title: "Dinner options" }),
      ]),
    ).toBe("Visited opentable.com and resy.com, made Dinner.html and shared “Dinner options”");
  });

  it("counts many of a kind, and stops at three phrases", () => {
    expect(
      aldoWorkRecap([
        codex("playwright", "browser_navigate", { url: "https://a.com" }),
        codex("playwright", "browser_navigate", { url: "https://b.com" }),
        codex("playwright", "browser_navigate", { url: "https://c.com" }),
        claude("WebSearch", { query: "x" }, "web_search"),
        claude("WebSearch", { query: "y" }, "web_search"),
        claude("Write", { file_path: "/w/a.md" }, "file_change"),
        codex("aldo", "request_approval", { kind: "event" }),
      ]),
    ).toBe("Visited 3 sites, searched the web 2 times, made a.md and 1 more");
  });

  it("falls back to counting commands, or nothing", () => {
    expect(aldoWorkRecap([command("make"), command("make test")])).toBe("Ran 2 commands");
    expect(aldoWorkRecap([entry({ itemType: "dynamic_tool_call", detail: "?" })])).toBeNull();
  });
});

describe("aldoWorkingWords", () => {
  it("says what's under way", () => {
    expect(
      aldoWorkingWords([
        codex("playwright", "browser_navigate", { url: "https://www.opentable.com" }),
        codex("playwright", "browser_click", { element: "Search" }),
      ]),
    ).toBe("Working on opentable.com");
    expect(
      aldoWorkingWords([claude("Write", { file_path: "/w/Budget.xlsx" }, "file_change")]),
    ).toBe("Making Budget.xlsx");
    const ask = codex("aldo", "needs_you_now", { reason: "A quick check on OpenTable" });
    expect(aldoWorkingWords([{ ...ask, toolLifecycleStatus: "inProgress" }])).toBe(
      "Waiting for you",
    );
    expect(aldoWorkingWords([{ ...ask, toolLifecycleStatus: "completed" }])).toBeNull();
    expect(aldoWorkingWords([command("make")])).toBeNull();
    expect(aldoWorkingWords([])).toBeNull();
  });
});

describe("aldoShareOf", () => {
  it("reads the file, its title and the link aldod gave", () => {
    expect(
      aldoShareOf(
        codex(
          "aldo",
          "share_file",
          { path: "trip/plan.html", title: "Lisbon in May" },
          {
            content: [
              {
                type: "text",
                text: 'Shared "Lisbon in May": https://aldo.example/s/abc (anyone with the link can open it). Give the user the link.',
              },
            ],
          },
        ),
      ),
    ).toEqual({
      path: "trip/plan.html",
      title: "Lisbon in May",
      url: "https://aldo.example/s/abc",
    });
    expect(
      aldoShareOf(
        opencode("aldo_share_file", 'Shared "Menu": https://aldo.example/s/x (only the user)'),
      ),
    ).toEqual({ path: null, title: "Menu", url: "https://aldo.example/s/x" });
    expect(aldoShareOf(codex("aldo", "notify_user", { message: "hi" }))).toBeNull();
  });

  it("collects each turn's shares", () => {
    const share = { ...claude("mcp__aldo__share_file", { path: "a.pdf" }), turnId: "t1" as never };
    expect(aldoSharesByTurn([share, { ...command("ls"), turnId: "t1" as never }])).toEqual([
      ["t1", [{ path: "a.pdf", title: null, url: null }]],
    ]);
  });
});
