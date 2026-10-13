// Steps in plain words, for threads that aren't code (General and the user's
// Aldo projects): "Opened opentable.com", "Made Subscriptions.xlsx", "Shared
// “Dinner options”", "Asked you to approve an email". Built from what each
// agent records about a tool call (Codex: the MCP call's server, tool and
// arguments; Claude: "tool: {input}"; OpenCode and Muse: the tool's name and
// its output), and from the command or files a step ran or changed. A step
// this doesn't recognize keeps T3's own label. The timeline asks through
// `aldoWorkWords` (MessagesTimeline.logic.ts `WorkWords`); repository threads
// keep T3's labels.

import type { WorkWords } from "../components/chat/MessagesTimeline.logic";
import type { WorkLogEntry } from "../session-logic";

type Entry = Pick<
  WorkLogEntry,
  | "label"
  | "detail"
  | "command"
  | "rawCommand"
  | "changedFiles"
  | "toolTitle"
  | "toolData"
  | "itemType"
  | "requestKind"
  | "tone"
  | "toolLifecycleStatus"
>;

export type AldoStepKind =
  | "browse"
  | "make"
  | "edit"
  | "read"
  | "share"
  | "ask"
  | "search"
  | "app"
  | "run"
  | "other";

export interface AldoStep {
  readonly kind: AldoStepKind;
  /** Done: "Opened opentable.com". */
  readonly done: string;
  /** Under way: "Opening opentable.com". */
  readonly doing: string;
  /** The site it was on, where the step says. */
  readonly site?: string;
  /** What it was about, to count and name in a recap: a file's name, a share's title, an app's line. */
  readonly subject?: string;
}

interface ToolCall {
  readonly server: string | null;
  readonly tool: string;
  readonly args: Record<string, unknown> | null;
  /** What the tool said back, where the agent records it (OpenCode's output, Codex's result). */
  readonly output: string | null;
}

const ALDO_TOOLS = new Set([
  "add_repository",
  "add_routine",
  "agent_inbox",
  "attach_to_pull_request",
  "cancel_payment",
  "cancel_reminder",
  "comment_on_pull_request",
  "compute_usage",
  "confirm_with_user",
  "connect_app",
  "continue_in_new_thread",
  "copy_from_thread",
  "create_project",
  "fill_login",
  "fill_payment",
  "hold_machine",
  "list_approvals",
  "list_apps",
  "list_holds",
  "list_logins",
  "list_ports",
  "list_reminders",
  "list_routines",
  "list_services",
  "list_threads",
  "message_thread",
  "needs_you_now",
  "notify_user",
  "open_pull_request",
  "pay",
  "payment_status",
  "preview_link",
  "public_routes",
  "pull_request_status",
  "read_thread",
  "read_thread_changes",
  "record_spend",
  "release_machine",
  "remember",
  "remind_me",
  "remove_routine",
  "request_approval",
  "request_computer",
  "request_secret",
  "residential_ip",
  "save_environment",
  "save_login",
  "save_secret",
  "save_skill",
  "service_logs",
  "set_policy",
  "share_file",
  "start_recording",
  "start_service",
  "stop_computer",
  "stop_following_pr",
  "stop_recording",
  "stop_service",
  "take_screenshot",
  "update_routine",
  "watch_mail",
  "withdraw_approval",
  "workspace_policy",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** JSON as the agent recorded it, or what can be read of it when it was cut short ("…"). */
function parseArgs(raw: string): Record<string, unknown> | null {
  try {
    return record(JSON.parse(raw));
  } catch {
    // Claude's detail stops at 400 characters: take the string fields that made it.
    const found: Record<string, unknown> = {};
    for (const match of raw.matchAll(/"([a-z_]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/gi)) {
      try {
        found[match[1]!] = JSON.parse(`"${match[2]!}"`);
      } catch {
        found[match[1]!] = match[2];
      }
    }
    return Object.keys(found).length > 0 ? found : null;
  }
}

/** "mcp__playwright__browser_navigate", "playwright · browser_navigate", "aldo_share_file" → server and tool. */
function splitName(
  name: string,
  server: string | null = null,
): { server: string | null; tool: string } {
  const trimmed = name.trim();
  const mcp = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(trimmed);
  if (mcp) return { server: mcp[1]!.toLowerCase(), tool: mcp[2]! };
  const dotted = /^([\w-]+)\s*·\s*([\w-]+)$/.exec(trimmed);
  if (dotted) return { server: dotted[1]!.toLowerCase(), tool: dotted[2]! };
  for (const prefix of ["playwright_", "aldo_"]) {
    if (trimmed.toLowerCase().startsWith(prefix)) {
      return { server: prefix.slice(0, -1), tool: trimmed.slice(prefix.length) };
    }
  }
  if (server) return { server: server.toLowerCase(), tool: trimmed };
  if (trimmed.startsWith("browser_")) return { server: "playwright", tool: trimmed };
  if (ALDO_TOOLS.has(trimmed)) return { server: "aldo", tool: trimmed };
  return { server: null, tool: trimmed };
}

function resultText(value: unknown): string | null {
  const direct = text(value);
  if (direct) return direct;
  const content = record(value)?.content;
  if (typeof content === "string") return text(content);
  if (Array.isArray(content)) {
    return text(
      content
        .map((part) => (typeof record(part)?.text === "string" ? record(part)!.text : ""))
        .join("\n"),
    );
  }
  return null;
}

/** The tool call a step made, as far as its agent recorded it. */
export function aldoToolCall(entry: Entry): ToolCall | null {
  const data = record(entry.toolData);
  const dataTool = text(data?.tool);
  if (dataTool) {
    const { server, tool } = splitName(dataTool, text(data?.server));
    const raw = data?.arguments;
    const args = typeof raw === "string" ? parseArgs(raw) : record(raw);
    return { server, tool, args, output: resultText(data?.result) };
  }
  const detail = entry.detail?.trim() ?? "";
  const named = /^([A-Za-z][\w.-]*(?:__[\w-]+)*)\s*:\s*(\{[\s\S]*)$/.exec(detail);
  if (named) {
    const { server, tool } = splitName(named[1]!);
    return { server, tool, args: parseArgs(named[2]!), output: null };
  }
  // OpenCode and Muse title a step with the tool's own name ("playwright_browser_navigate").
  const title = entry.toolTitle?.trim();
  if (title && !/\s/.test(title.replace(/\s*·\s*/, ""))) {
    const { server, tool } = splitName(title);
    return { server, tool, args: null, output: detail || null };
  }
  return null;
}

/** A file a step shared by link (share_file): its path, title and, where the agent recorded aldod's reply, the link. */
export function aldoShareOf(
  entry: Entry,
): { path: string | null; title: string | null; url: string | null } | null {
  const call = aldoToolCall(entry);
  if (call?.server !== "aldo" || call.tool !== "share_file") return null;
  if (entry.tone === "error" || entry.toolLifecycleStatus === "failed") return null;
  // aldod answers 'Shared "<title>": <url> (…)'.
  const reply = call.output ? /^Shared "([\s\S]*?)": (https:\/\/\S+)/m.exec(call.output) : null;
  return {
    path: text(call.args?.path),
    title: text(call.args?.title) ?? text(reply?.[1]),
    url: reply?.[2] ?? null,
  };
}

/** The files a timeline's turns shared by link, by turn. */
export function aldoSharesByTurn(
  entries: ReadonlyArray<Entry & Pick<WorkLogEntry, "turnId">>,
): Array<[string, Array<NonNullable<ReturnType<typeof aldoShareOf>>>]> {
  const byTurn = new Map<string, Array<NonNullable<ReturnType<typeof aldoShareOf>>>>();
  for (const entry of entries) {
    if (!entry.turnId) continue;
    // Cheaply past every step that isn't one.
    const tool = record(entry.toolData)?.tool;
    if (
      tool !== "share_file" &&
      !entry.detail?.includes("share_file") &&
      !entry.toolTitle?.includes("share_file")
    )
      continue;
    const share = aldoShareOf(entry);
    if (!share) continue;
    const list = byTurn.get(entry.turnId) ?? [];
    list.push(share);
    byTurn.set(entry.turnId, list);
  }
  return [...byTurn];
}

/** "https://www.opentable.com/r/x" → "opentable.com". */
export function aldoSiteOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") return "a preview";
    return parsed.hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** The page a browser step's output says it ended on (Playwright's "Page URL: …"). */
function siteInOutput(output: string | null): string | null {
  const url = output ? /Page URL:\s*(\S+)/.exec(output)?.[1] : null;
  return aldoSiteOf(url);
}

function baseName(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts.at(-1) || path;
}

function clip(value: string, max = 60): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function step(
  kind: AldoStepKind,
  done: string,
  doing: string,
  extra: { site?: string | null | undefined; subject?: string | null | undefined } = {},
): AldoStep {
  return {
    kind,
    done,
    doing,
    ...(extra.site ? { site: extra.site } : {}),
    ...(extra.subject ? { subject: extra.subject } : {}),
  };
}

function browserStep(call: ToolCall): AldoStep {
  const args = call.args ?? {};
  const site = siteInOutput(call.output);
  const element = text(args.element);
  switch (call.tool) {
    case "browser_navigate": {
      const target = aldoSiteOf(text(args.url)) ?? site;
      return target
        ? step("browse", `Opened ${target}`, `Opening ${target}`, { site: target })
        : step("browse", "Opened a page", "Opening a page");
    }
    case "browser_navigate_back":
      return step("browse", "Went back a page", "Going back a page", { site });
    case "browser_click":
      return element
        ? step("browse", `Clicked ${clip(element, 48)}`, `Clicking ${clip(element, 48)}`, { site })
        : step("browse", "Clicked on the page", "Clicking on the page", { site });
    case "browser_type":
      return element
        ? step("browse", `Typed into ${clip(element, 44)}`, `Typing into ${clip(element, 44)}`, {
            site,
          })
        : step("browse", "Typed on the page", "Typing on the page", { site });
    case "browser_fill_form":
      return step("browse", "Filled in a form", "Filling in a form", { site });
    case "browser_select_option":
      return step("browse", "Picked an option", "Picking an option", { site });
    case "browser_file_upload":
      return step("browse", "Uploaded a file", "Uploading a file", { site });
    case "browser_take_screenshot":
      return step("browse", "Took a screenshot", "Taking a screenshot", { site });
    case "browser_snapshot":
    case "browser_find":
      return step("browse", "Read the page", "Reading the page", { site });
    case "browser_wait_for":
      return step("browse", "Waited for the page", "Waiting for the page", { site });
    case "browser_tabs": {
      const target = aldoSiteOf(text(args.url));
      return target
        ? step("browse", `Opened ${target}`, `Opening ${target}`, { site: target })
        : step("browse", "Switched tabs", "Switching tabs", { site });
    }
    default:
      return step("browse", "Used the browser", "Using the browser", { site });
  }
}

const APPROVAL_KIND: Record<string, string> = {
  email: "an email",
  event: "an event",
};

const CONFIRM_ACTION: Record<string, string> = {
  purchase: "a purchase",
  booking: "a booking",
  cancellation: "a cancellation",
  submission: "a submission",
  call: "a call",
};

function aldoStep(call: ToolCall): AldoStep {
  const args = call.args ?? {};
  switch (call.tool) {
    case "share_file": {
      const title = text(args.title) ?? (text(args.path) ? baseName(text(args.path)!) : null);
      return title
        ? step("share", `Shared “${clip(title, 48)}”`, `Sharing “${clip(title, 48)}”`, {
            subject: title,
          })
        : step("share", "Shared a file", "Sharing a file");
    }
    case "request_approval": {
      const what = APPROVAL_KIND[text(args.kind) ?? ""] ?? "something";
      const title = text(args.title);
      return step(
        "ask",
        title ? `Asked you to approve ${what}: ${clip(title, 40)}` : `Asked you to approve ${what}`,
        "Waiting for you",
      );
    }
    case "confirm_with_user": {
      const what = text(args.what);
      const action = CONFIRM_ACTION[text(args.action) ?? ""] ?? "a step";
      return step(
        "ask",
        what ? `Asked you to confirm: ${clip(what, 52)}` : `Asked you to confirm ${action}`,
        "Waiting for you",
      );
    }
    case "needs_you_now": {
      const reason = text(args.reason);
      return step(
        "ask",
        reason ? `Asked you: ${clip(reason, 56)}` : "Asked for your help",
        "Waiting for you",
      );
    }
    case "pay": {
      const merchant = text(args.merchant);
      return step(
        "ask",
        merchant ? `Asked you to pay ${clip(merchant, 40)}` : "Asked you to approve a payment",
        "Waiting for you",
      );
    }
    case "request_secret":
      return step("ask", "Asked you for a key", "Waiting for you");
    case "connect_app": {
      const app = text(args.app);
      return step(
        "ask",
        app ? `Asked you to connect ${clip(app, 30)}` : "Asked you to connect an app",
        "Waiting for you",
      );
    }
    case "fill_login":
      return step("browse", "Signed in with your saved login", "Signing in");
    case "fill_payment":
      return step("browse", "Filled in the card", "Filling in the card");
    case "preview_link":
      return step("other", "Made a preview link", "Making a preview link");
    case "start_service": {
      const name = text(args.name);
      return step("run", name ? `Started ${clip(name, 40)}` : "Started a preview", "Starting it");
    }
    case "take_screenshot":
      return step("other", "Took a screenshot", "Taking a screenshot");
    case "start_recording":
      return step("other", "Started recording", "Recording");
    case "stop_recording":
      return step("other", "Recorded a demo", "Recording");
    case "remind_me": {
      const when = text(args.in);
      return step(
        "other",
        when ? `Set a reminder for ${clip(when, 20)}` : "Set a reminder",
        "Setting a reminder",
      );
    }
    case "notify_user":
      return step("other", "Sent you a notification", "Telling you");
    case "add_routine": {
      const title = text(args.title);
      return step(
        "other",
        title ? `Created routine · ${clip(title, 44)}` : "Created a routine",
        "Creating a routine",
        { subject: title },
      );
    }
    case "remember":
      return step("other", "Saved to your instructions", "Remembering it");
    case "save_skill":
      return step("other", "Saved a skill", "Saving a skill");
    case "save_secret":
    case "save_login":
      return step("other", "Saved to your vault", "Saving to your vault");
    case "record_spend":
      return step("other", "Recorded a spend", "Recording a spend");
    case "continue_in_new_thread":
      return step("other", "Started a new thread", "Starting a new thread");
    case "message_thread":
      return step("other", "Messaged another thread", "Messaging another thread");
    case "read_thread":
    case "read_thread_changes":
      return step("read", "Read another thread", "Reading another thread");
    case "watch_mail":
      return step("app", "Watching for an email", "Waiting for an email", {
        subject: "Watching for an email",
      });
    case "request_computer": {
      const kind = text(args.kind);
      return step(
        "other",
        kind === "gpu" ? "Asked for the GPU computer" : "Asked for the Windows computer",
        "Waiting for a computer",
      );
    }
    case "residential_ip": {
      const site = text(args.site);
      return step(
        "other",
        site ? `Switched how it reaches ${clip(site, 30)}` : "Switched how it reaches a site",
        "Switching networks",
      );
    }
    case "open_pull_request":
      return step("other", "Opened a pull request", "Opening a pull request");
    case "hold_machine":
      return step("other", "Kept its computer on", "Keeping its computer on");
    case "release_machine":
      return step("other", "Let its computer rest", "Letting its computer rest");
    case "create_project":
      return step("other", "Created a project", "Creating a project");
    default: {
      if (call.tool.startsWith("desktop_"))
        return step("other", "Used the desktop", "Using the desktop");
      const words = call.tool.replace(/_/g, " ");
      if (/^(list|workspace|compute|payment|pull request|service) /.test(`${words} `)) {
        return step(
          "other",
          `Checked ${words.replace(/^list /, "")}`,
          `Checking ${words.replace(/^list /, "")}`,
        );
      }
      const phrase = `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
      return step("other", phrase, phrase);
    }
  }
}

/** A request to an app's API, by its address and method: Gmail, Calendar, Drive, Outlook, the agent inbox… */
function appStep(url: URL, method: string): AldoStep | null {
  const host = url.hostname;
  const path = url.pathname;
  const writes = method !== "GET";
  const app = (done: string, doing: string) => step("app", done, doing, { subject: done });
  if (host === "gmail.googleapis.com") {
    if (/\/(drafts|messages)\/send/.test(path)) return app("Sent an email", "Sending an email");
    if (/\/drafts/.test(path) && writes) return app("Drafted an email", "Drafting an email");
    if (/\/(labels|modify)/.test(path) || (writes && /\/messages/.test(path)))
      return app("Sorted your Gmail", "Sorting your Gmail");
    return app("Read your Gmail", "Reading your Gmail");
  }
  if (host === "www.googleapis.com" || host === "googleapis.com") {
    if (path.startsWith("/calendar/") && /freeBusy/i.test(path))
      return app("Checked when you're free", "Checking when you're free");
    if (path.startsWith("/calendar/"))
      return writes
        ? app("Added to your calendar", "Adding to your calendar")
        : app("Checked your calendar", "Checking your calendar");
    if (path.startsWith("/upload/drive/"))
      return app("Saved to your Drive", "Saving to your Drive");
    if (path.startsWith("/drive/"))
      return /\/export|alt=media/.test(path + url.search)
        ? app("Opened a file from your Drive", "Opening a file from your Drive")
        : app("Looked in your Drive", "Looking in your Drive");
  }
  const googleFile: Record<string, string> = {
    "docs.googleapis.com": "Google Doc",
    "sheets.googleapis.com": "Google Sheet",
    "slides.googleapis.com": "Google Slides deck",
  };
  const file = googleFile[host];
  if (file) {
    if (writes && /^\/v\d+\/(documents|spreadsheets|presentations)\/?$/.test(path))
      return app(`Made a ${file}`, `Making a ${file}`);
    return writes
      ? app(`Edited a ${file}`, `Editing a ${file}`)
      : app(`Read a ${file}`, `Reading a ${file}`);
  }
  if (host === "people.googleapis.com")
    return app("Looked up your contacts", "Looking up your contacts");
  if (host === "graph.microsoft.com") {
    if (/sendMail|\/send$/.test(path)) return app("Sent an email", "Sending an email");
    if (/\/messages|\/mailFolders/.test(path))
      return writes
        ? app("Drafted an email", "Drafting an email")
        : app("Read your Outlook mail", "Reading your Outlook mail");
    if (/\/events|\/calendar/.test(path))
      return writes
        ? app("Added to your calendar", "Adding to your calendar")
        : app("Checked your calendar", "Checking your calendar");
    if (/\/drive/.test(path)) return app("Looked in your OneDrive", "Looking in your OneDrive");
    return null;
  }
  if (host === "api.agentmail.to") {
    if (/\/(send|reply)$/.test(path)) return app("Sent an email", "Sending an email");
    return app("Checked the agent's inbox", "Checking the agent's inbox");
  }
  if (host.endsWith("runwayml.com"))
    return writes
      ? app("Asked Runway to make it", "Making it with Runway")
      : app("Checked on Runway", "Waiting on Runway");
  return null;
}

/** The program a command runs, past `cd …&&`, `sudo` and environment settings. */
function program(command: string): { name: string; rest: string } | null {
  let rest = command.trim();
  for (;;) {
    const cd = /^cd\s+\S+\s*(?:&&|;)\s*/.exec(rest);
    if (cd) {
      rest = rest.slice(cd[0].length);
      continue;
    }
    const prefix = /^(?:sudo|env|time|timeout\s+\d+[smh]?)\s+|^[A-Z_][A-Z0-9_]*=\S*\s+/.exec(rest);
    if (prefix) {
      rest = rest.slice(prefix[0].length);
      continue;
    }
    break;
  }
  const name = /^[\w./+-]+/.exec(rest)?.[0];
  return name ? { name: baseName(name), rest: rest.slice(name.length).trim() } : null;
}

function commandStep(command: string): AldoStep {
  // Claude's records lead with the tool: "Bash: ls -la".
  const run = program(command.replace(/^(?:Bash|Shell|Terminal|run_shell_command):\s*/i, ""));
  const ran = (done: string, doing: string) => step("run", done, doing);
  if (!run) return ran("Ran a command", "Running a command");
  const { name, rest } = run;
  if (name === "curl" || name === "wget") {
    const url = /https?:\/\/[^\s'"<>]+/.exec(rest)?.[0];
    if (url) {
      let parsed: URL | null = null;
      try {
        parsed = new URL(url);
      } catch {
        parsed = null;
      }
      if (parsed) {
        const explicit = /(?:-X|--request)\s*['"]?([A-Z]+)/.exec(rest)?.[1];
        const method =
          explicit ??
          (/(^|\s)(-d|--data[\w-]*|-F|--form|-T|--upload-file)(\s|=)/.test(rest) ? "POST" : "GET");
        const app = appStep(parsed, method);
        if (app) return app;
        const site = aldoSiteOf(url);
        if (name === "wget" || /(^|\s)(-o|-O|--output)\s/.test(rest)) {
          const file = baseName(parsed.pathname);
          return step("read", `Downloaded ${clip(file || site || "a file", 40)}`, "Downloading", {
            site,
          });
        }
        return step(
          "read",
          site ? `Fetched ${site}` : "Fetched a page",
          site ? `Fetching ${site}` : "Fetching a page",
          {
            site,
          },
        );
      }
    }
    return ran("Fetched from the web", "Fetching from the web");
  }
  if (/^python3?(\.\d+)?$/.test(name) || name === "node" || name === "bun" || name === "deno") {
    const script = /^([\w./-]+\.(py|js|mjs|ts))\b/.exec(rest)?.[1];
    return script
      ? ran(`Ran ${baseName(script)}`, `Running ${baseName(script)}`)
      : ran("Ran a quick script", "Running a quick script");
  }
  if (name === "soffice" || name === "libreoffice") {
    const to = /--convert-to\s+(\w+)/.exec(rest)?.[1];
    const file = /([\w.-]+\.(?:docx?|xlsx?|pptx?|odt|ods|odp|csv|html))\b/.exec(rest)?.[1];
    return to
      ? ran(
          `Converted ${file ?? "a document"} to ${to.toUpperCase()}`,
          `Converting ${file ?? "a document"}`,
        )
      : ran("Opened a document", "Opening a document");
  }
  if (name === "pdftotext" || name === "pdfinfo") {
    const file = /([\w.-]+\.pdf)\b/i.exec(rest)?.[1];
    return step(
      "read",
      file ? `Read ${file}` : "Read a PDF",
      file ? `Reading ${file}` : "Reading a PDF",
      {
        subject: file,
      },
    );
  }
  if (/^(pip3?|uv|apt|apt-get|npm|pnpm|yarn|brew)$/.test(name) && /\b(install|add|i)\b/.test(rest))
    return ran("Installed what it needs", "Installing what it needs");
  if (/^(ls|cat|head|tail|find|grep|rg|wc|tree|file|stat|du|less|jq)$/.test(name))
    return step("read", "Looked through files", "Looking through files");
  if (/^(mkdir|cp|mv|rm|touch|ln|chmod|rsync)$/.test(name))
    return ran("Organized files", "Organizing files");
  if (/^(unzip|tar|7z|gunzip|zip)$/.test(name))
    return ran("Packed or unpacked files", "Unpacking files");
  if (name === "sleep") return ran("Waited a moment", "Waiting a moment");
  if (name === "aldo") {
    const service = /^service\s+start\s+(\S+)/.exec(rest)?.[1];
    if (service) return ran(`Started ${service}`, `Starting ${service}`);
    return ran("Checked with Aldo", "Checking with Aldo");
  }
  if (name === "gh") return ran("Used GitHub", "Using GitHub");
  if (name === "git") return ran("Used git", "Using git");
  return ran("Ran a command", "Running a command");
}

function fileStep(entry: Entry, call: ToolCall | null): AldoStep | null {
  const files = entry.changedFiles ?? [];
  const path =
    files[0] ??
    text(call?.args?.file_path) ??
    text(call?.args?.path) ??
    text(call?.args?.filePath) ??
    null;
  if (!path) return null;
  const name = baseName(path);
  const more = files.length > 1 ? ` and ${files.length - 1} more` : "";
  const tool = (call?.tool ?? entry.toolTitle ?? "").toLowerCase();
  if (/^(write|create|create_file|new_file)$/.test(tool))
    return step("make", `Made ${name}${more}`, `Making ${name}`, { subject: name });
  if (/edit|replace|patch/.test(tool))
    return step("edit", `Edited ${name}${more}`, `Editing ${name}`, { subject: name });
  return step("edit", `Saved ${name}${more}`, `Working on ${name}`, { subject: name });
}

// Entries are kept objects (session-logic caches them per activity), so a
// timeline that updates as the agent streams labels each step once.
const stepCache = new WeakMap<Entry, AldoStep | null>();

/** One step in plain words, or null to keep T3's label. */
export function aldoWorkStep(entry: Entry): AldoStep | null {
  const cached = stepCache.get(entry);
  if (cached !== undefined) return cached;
  const found = workStep(entry);
  stepCache.set(entry, found);
  return found;
}

function workStep(entry: Entry): AldoStep | null {
  if (entry.tone === "thinking" || entry.tone === "error") return null;
  // Failed, declined or stopped by the provider's account: T3's label says so.
  const status = entry.toolLifecycleStatus;
  if (status === "failed" || status === "declined" || status === "stopped") return null;
  const call = aldoToolCall(entry);
  if (call?.server === "playwright") return browserStep(call);
  if (call?.server === "aldo") return aldoStep(call);
  const tool = call?.tool.toLowerCase() ?? "";
  if (/^(todowrite|todo_write|update_plan)$/.test(tool))
    return step("other", "Updated its plan", "Planning");
  if (/^(grep|glob|ls|list|search_files|list_directory)$/.test(tool))
    return step("read", "Looked through files", "Looking through files");
  if (tool === "skill") {
    const skill = text(call?.args?.skill) ?? text(call?.args?.name);
    return skill
      ? step(
          "other",
          `Followed the ${clip(skill, 30)} skill`,
          `Following the ${clip(skill, 30)} skill`,
        )
      : step("other", "Followed a skill", "Following a skill");
  }
  if (entry.itemType === "file_change" || entry.requestKind === "file-change")
    return fileStep(entry, call);
  if (entry.requestKind === "file-read" || /^(read|view|read_file)$/.test(tool)) {
    const path =
      text(call?.args?.file_path) ?? text(call?.args?.path) ?? text(call?.args?.filePath);
    return path
      ? step("read", `Read ${baseName(path)}`, `Reading ${baseName(path)}`, {
          subject: baseName(path),
        })
      : step("read", "Read a file", "Reading a file");
  }
  if (entry.itemType === "image_view")
    return step("read", "Looked at an image", "Looking at an image");
  if (/^(webfetch|web_fetch|fetch)$/.test(tool)) {
    const site = aldoSiteOf(text(call?.args?.url));
    return step(
      "read",
      site ? `Read ${site}` : "Read a web page",
      site ? `Reading ${site}` : "Reading a web page",
      {
        site,
      },
    );
  }
  if (entry.itemType === "web_search") {
    const query = text(call?.args?.query) ?? (call ? null : text(entry.detail)) ?? null;
    return query
      ? step("search", `Searched the web for “${clip(query, 48)}”`, "Searching the web", {
          subject: query,
        })
      : step("search", "Searched the web", "Searching the web");
  }
  const command =
    entry.command ?? (entry.itemType === "command_execution" ? text(entry.detail) : null);
  if (command) return commandStep(command);
  return null;
}

/**
 * Each step's site where it doesn't say (a click is on the page the agent
 * last opened): in order, the last site a step named carries to the steps after it.
 */
export function aldoStepsInOrder(entries: ReadonlyArray<Entry>): Array<AldoStep | null> {
  let site: string | null = null;
  return entries.map((entry) => {
    const found = aldoWorkStep(entry);
    if (!found) return null;
    if (found.site) site = found.site;
    else if (found.kind === "browse" && site) return { ...found, site };
    return found;
  });
}

function listed(phrases: ReadonlyArray<string>): string {
  if (phrases.length <= 1) return phrases[0] ?? "";
  return `${phrases.slice(0, -1).join(", ")} and ${phrases.at(-1)}`;
}

function some(count: number, one: string, many: string): string {
  return count === 1 ? one : many.replace("#", String(count));
}

/** Phrases at most, before "and N more". */
const RECAP_PHRASES = 3;

/**
 * What a run of steps did, in a line: "Visited opentable.com and resy.com,
 * made Subscriptions.xlsx and shared “Dinner options”". Steps on one site
 * count once; commands only when there's nothing else to say. Null when
 * none of the steps could be put in words.
 */
export function aldoWorkRecap(entries: ReadonlyArray<Entry>): string | null {
  const steps = aldoStepsInOrder(entries).filter((s): s is AldoStep => s !== null);
  if (steps.length === 0) return null;
  const order: AldoStepKind[] = [];
  const byKind = new Map<AldoStepKind, AldoStep[]>();
  for (const s of steps) {
    const group = byKind.get(s.kind);
    if (group) group.push(s);
    else {
      byKind.set(s.kind, [s]);
      order.push(s.kind);
    }
  }
  const unique = (values: Array<string | undefined>) => [
    ...new Set(values.filter((v): v is string => !!v)),
  ];
  const phrase = (kind: AldoStepKind): string | null => {
    const group = byKind.get(kind) ?? [];
    switch (kind) {
      case "browse": {
        const sites = unique(group.map((s) => s.site));
        if (sites.length === 0) return "Used the browser";
        return sites.length <= 2 ? `Visited ${listed(sites)}` : `Visited ${sites.length} sites`;
      }
      case "make": {
        const files = unique(group.map((s) => s.subject));
        return files.length <= 2 ? `Made ${listed(files)}` : `Made ${files.length} files`;
      }
      case "edit": {
        const files = unique(group.map((s) => s.subject));
        return files.length <= 2 ? `Edited ${listed(files)}` : `Edited ${files.length} files`;
      }
      case "read": {
        const named = unique(group.map((s) => s.subject ?? s.site));
        if (named.length === 0) return null;
        return named.length <= 2 ? `Read ${listed(named)}` : `Read ${named.length} files`;
      }
      case "share": {
        const titles = unique(group.map((s) => s.subject));
        return titles.length === 1
          ? `Shared “${clip(titles[0]!, 40)}”`
          : some(group.length, "Shared a file", "Shared # files");
      }
      case "ask":
        return group[0]!.done;
      case "search":
        return some(group.length, "Searched the web", "Searched the web # times");
      case "app":
        return listed(unique(group.map((s) => s.subject ?? s.done)).slice(0, 2));
      case "other":
        return group.length === 1 ? group[0]!.done : null;
      case "run":
        return null;
    }
  };
  const phrases = order
    .map(phrase)
    .filter((p): p is string => !!p)
    .map((p, index) => (index === 0 ? p : `${p.charAt(0).toLowerCase()}${p.slice(1)}`));
  if (phrases.length === 0) {
    const runs = byKind.get("run")?.length ?? 0;
    return runs > 0 ? some(runs, "Ran a command", "Ran # commands") : null;
  }
  const shown = phrases.slice(0, RECAP_PHRASES);
  const rest = phrases.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : listed(shown);
}

/**
 * The working line's words for the step under way, given the turn's steps so
 * far: "Working on opentable.com", "Making Subscriptions.xlsx", "Waiting for
 * you". Null when the latest step it can name says nothing worth a status.
 */
export function aldoWorkingWords(entries: ReadonlyArray<Entry>): string | null {
  const steps = aldoStepsInOrder(entries);
  const index = steps.findLastIndex((s) => s !== null);
  const latest = steps[index];
  if (!latest) return null;
  if (latest.kind === "browse" && latest.site) return `Working on ${latest.site}`;
  // An ask stops the turn only while it's open; once answered the agent goes on.
  if (latest.kind === "ask")
    return entries[index]?.toolLifecycleStatus === "inProgress" ? latest.doing : null;
  if (latest.kind === "run" && latest.done === "Ran a command") return null;
  return latest.doing;
}

export const aldoWorkWords: WorkWords = {
  step: (entry, active) => {
    const found = aldoWorkStep(entry);
    return found ? (active ? found.doing : found.done) : null;
  },
  recap: aldoWorkRecap,
  working: aldoWorkingWords,
};
