// The work between messages as one row, for threads that aren't code and every
// thread in Simple mode: "Worked 31 min · 84 steps". Opened, it shows the work
// in a few plain-word groups ("Researched fiverr.com", "Made 8 videos",
// "Worked on fiverr.com"), and the technical log (T3's own rows, with their
// commands, paths and output) sits behind a second click. The timeline folds
// the rows (MessagesTimeline.logic.ts, `WorkWords.worked`); the groups are
// drawn by AldoWorkGroups.tsx.
//
// Groups follow the steps in order and only ever grow at the end: each step
// joins the group for its kind of work, or starts one, so a group never moves
// while a turn streams.

import { omitSupersededLifecycleMarkers } from "@t3tools/client-runtime/work-log/presentation";

import type { WorkWords } from "../components/chat/MessagesTimeline.logic";
import type { WorkLogEntry } from "../session-logic";
import { aldoStepsInOrder, aldoWorkWords, type AldoStep } from "./workLabels.logic";

type Entry = Pick<
  WorkLogEntry,
  | "id"
  | "createdAt"
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
  | "toolCallId"
  | "turnId"
  | "sourceActivityKind"
>;

/** The tool calls among a run of work: what "84 steps" counts (not thoughts or notices). */
export function aldoStepCount(entries: ReadonlyArray<Entry>): number {
  return omitSupersededLifecycleMarkers(entries, (entry) => entry).filter(
    (entry) => entry.tone === "tool",
  ).length;
}

/** "40 sec", "6 min", "1 hr 12 min". */
export function aldoDurationWords(ms: number): string {
  const seconds = Math.max(1, Math.round(Math.max(0, ms) / 1000));
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} hr ${rest} min` : `${hours} hr`;
}

function steps(count: number): string {
  return `${count} ${count === 1 ? "step" : "steps"}`;
}

/**
 * The row's words: "Worked 31 min · 84 steps"; "You stopped after 4 min ·
 * 12 steps" for a turn the user stopped; "Thought for 20 sec" for thinking
 * with no steps.
 */
export function aldoWorkedLabel(
  entries: ReadonlyArray<Entry>,
  elapsedMs: number | null,
  stopped = false,
): string {
  const count = aldoStepCount(entries);
  const time =
    elapsedMs !== null && Number.isFinite(elapsedMs) ? aldoDurationWords(elapsedMs) : null;
  if (stopped) {
    const head = time ? `You stopped after ${time}` : "You stopped this response";
    return count > 0 ? `${head} · ${steps(count)}` : head;
  }
  if (count === 0) return time ? `Thought for ${time}` : "Thought it over";
  return `${time ? `Worked ${time}` : "Worked"} · ${steps(count)}`;
}

export type AldoWorkGroupKind = "research" | "site" | "make" | "share" | "ask" | "app" | "other";

export interface AldoWorkGroup {
  /** Stable while the run streams: its first step's id. */
  readonly key: string;
  readonly kind: AldoWorkGroupKind;
  /** "Researched fiverr.com", "Made 8 videos", "Worked on fiverr.com". */
  readonly title: string;
  /** What it did, in words, without the routine steps: "Opened fiverr.com/join", "Saved to your vault". */
  readonly items: ReadonlyArray<string>;
  /** Steps it holds (tool calls). */
  readonly steps: number;
  /** Time its steps took, each until the next step (the last, until the run ended); null when unknown. */
  readonly elapsedMs: number | null;
}

/** Items at most, before "and N more". */
const GROUP_ITEMS = 4;

/** Steps too routine to list under a group. */
const ROUTINE = new Set([
  "Read the page",
  "Waited for the page",
  "Took a screenshot",
  "Looked through files",
  "Ran a command",
  "Ran a quick script",
  "Waited a moment",
  "Clicked on the page",
  "Typed on the page",
  "Updated its plan",
  "Switched tabs",
  "Used the browser",
  "Checked with Aldo",
  "Organized files",
  "Worked on it",
]);

type FileCategory = "video" | "image" | "audio" | "document" | "spreadsheet" | "deck" | "page";

const CATEGORY_WORDS: Record<FileCategory, [string, string]> = {
  video: ["a video", "videos"],
  image: ["an image", "images"],
  audio: ["an audio file", "audio files"],
  document: ["a document", "documents"],
  spreadsheet: ["a spreadsheet", "spreadsheets"],
  deck: ["a deck", "decks"],
  page: ["a page", "pages"],
};

/**
 * A file's kind by its name. Scripts and data files are how the work was
 * done rather than what it made, so they're named only when nothing else was.
 */
function categoryOf(name: string): FileCategory | "file" | "script" | "data" {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  if (/^(mp4|mov|webm|mkv|m4v|avi|gif)$/.test(ext)) return "video";
  if (/^(png|jpe?g|webp|avif|svg|heic|tiff?|bmp)$/.test(ext)) return "image";
  if (/^(mp3|wav|m4a|aac|ogg|flac)$/.test(ext)) return "audio";
  if (/^(md|markdown|txt|docx?|pdf|rtf|odt|pages)$/.test(ext)) return "document";
  if (/^(xlsx|xlsm|xls|csv|tsv|ods|numbers)$/.test(ext)) return "spreadsheet";
  if (/^(pptx?|key|odp)$/.test(ext)) return "deck";
  if (/^html?$/.test(ext)) return "page";
  if (/^(py|js|mjs|cjs|ts|tsx|jsx|sh|bash|zsh|rb|go|rs|java|c|cc|cpp|h|css|scss|sql)$/.test(ext))
    return "script";
  if (/^(json|jsonl|ya?ml|toml|ini|cfg|lock|env|xml|blend|log)$/.test(ext)) return "data";
  return "file";
}

/** A file the work made for the person, not a script or data file of its own. */
function isResult(name: string): boolean {
  const category = categoryOf(name);
  return category !== "script" && category !== "data";
}

function listed(phrases: ReadonlyArray<string>): string {
  if (phrases.length <= 1) return phrases[0] ?? "";
  return `${phrases.slice(0, -1).join(", ")} and ${phrases.at(-1)}`;
}

function unique(values: ReadonlyArray<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => !!value))];
}

interface Building {
  key: string;
  theme: string;
  kind: AldoWorkGroupKind;
  site: string | null;
  steps: AldoStep[];
  count: number;
  elapsedMs: number;
  timed: boolean;
}

/** "Made 8 videos", "Made a document and 8 videos", "Made Subscriptions.xlsx", "Edited 3 documents", "Wrote a script". */
function makeTitle(found: ReadonlyArray<AldoStep>): string {
  const made = unique(found.filter((s) => s.kind === "make").map((s) => s.subject));
  const edited = unique(found.filter((s) => s.kind === "edit").map((s) => s.subject)).filter(
    (name) => !made.includes(name),
  );
  const describe = (verb: string, names: ReadonlyArray<string>): string | null => {
    const results = names.filter(isResult);
    if (results.length === 0) return null;
    if (results.length === 1) return `${verb} ${results[0]}`;
    const counts = new Map<FileCategory | "file", number>();
    for (const name of results) {
      const category = categoryOf(name) as FileCategory | "file";
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    if (counts.size > 3) return `${verb} ${results.length} files`;
    const phrase = ([category, count]: [FileCategory | "file", number]) => {
      if (category === "file") return count === 1 ? "a file" : `${count} files`;
      return count === 1 ? CATEGORY_WORDS[category][0] : `${count} ${CATEGORY_WORDS[category][1]}`;
    };
    return `${verb} ${listed([...counts].map(phrase))}`;
  };
  const phrases = [describe("Made", made), describe("Edited", edited)].filter(
    (p): p is string => p !== null,
  );
  if (phrases.length > 0)
    return phrases
      .map((p, i) => (i === 0 ? p : p.charAt(0).toLowerCase() + p.slice(1)))
      .join(" and ");
  // Only scripts and data: how it worked, so say that, without their names.
  const files = unique([...made, ...edited]);
  const scripts = files.filter((name) => categoryOf(name) === "script").length;
  if (files.length > 0 && scripts === files.length)
    return scripts === 1 ? "Wrote a script" : `Wrote ${scripts} scripts`;
  if (files.length > 0)
    return files.length === 1 ? "Prepared a file" : `Prepared ${files.length} files`;
  return found.find((s) => s.kind === "make")?.done ?? "Made files";
}

function titleOf(group: Building): string {
  const found = group.steps;
  switch (group.kind) {
    case "research": {
      const sites = unique(found.map((s) => s.site));
      if (sites.length === 1) return `Researched ${sites[0]}`;
      if (sites.length > 1) return `Researched ${sites.length} sites`;
      return found.some((s) => s.kind === "search") ? "Searched the web" : "Looked around the web";
    }
    case "site":
      return group.site ? `Worked on ${group.site}` : "Worked in the browser";
    case "make":
      return makeTitle(found);
    case "share": {
      const titles = unique(found.map((s) => s.subject));
      return titles.length === 1 && found.length === 1
        ? found[0]!.done
        : `Shared ${found.length} files`;
    }
    case "ask":
      return found.length === 1 ? found[0]!.done : `Asked you ${found.length} things`;
    case "app": {
      const said = unique(found.map((s) => s.subject ?? s.done));
      const shown = said
        .slice(0, 2)
        .map((p, i) => (i === 0 ? p : p.charAt(0).toLowerCase() + p.slice(1)));
      return said.length > 2 ? `${shown.join(", ")} and more` : listed(shown);
    }
    case "other": {
      const said = unique(found.map((s) => s.done));
      if (said.length === 1) return said[0]!;
      const runs = found.filter((s) => s.kind === "run").length;
      if (runs > 0 && runs === found.length)
        return found.every((s) => s.done === "Installed what it needs")
          ? "Installed what it needs"
          : `Ran ${runs} commands`;
      if (found.length > 0 && found.every((s) => s.kind === "read" || s.kind === "run"))
        return "Looked through its files";
      return said[0] ?? "Got started";
    }
  }
}

/** A step's words name a script or data file ("Ran render.py", "Made notes.json"): the technical log has those. */
function namesItsOwnFile(found: AldoStep): boolean {
  if (found.subject && /\.[a-z0-9]+$/i.test(found.subject) && !isResult(found.subject)) return true;
  return found.kind === "run" && /^Ran \S+\.[a-z0-9]+$/i.test(found.done) && !isResult(found.done);
}

function itemsOf(group: Building, title: string): string[] {
  const said = unique(group.steps.filter((s) => !namesItsOwnFile(s)).map((s) => s.done)).filter(
    (words) => words !== title && !ROUTINE.has(words),
  );
  if (said.length <= GROUP_ITEMS) return said;
  const shown = said.slice(0, GROUP_ITEMS - 1);
  return [...shown, `and ${said.length - shown.length} more`];
}

/** Which group a step belongs in, given the group it would follow; null joins whatever came before. */
function themeOf(found: AldoStep | null, current: Building | undefined): string | null {
  if (!found) return null;
  switch (found.kind) {
    case "browse":
    case "read": {
      if (found.kind === "read" && !found.site) return null;
      if (found.acts) return `site:${found.site ?? ""}`;
      // Looking at the site it's working on is part of that work.
      if (current?.kind === "site" && (!found.site || found.site === current.site))
        return current.theme;
      return "research";
    }
    case "search":
      return "research";
    case "make":
    case "edit":
      return "make";
    case "share":
      return "share";
    case "ask":
      return "ask";
    case "app":
      return "app";
    case "run":
    case "other":
      return null;
  }
}

function kindOf(theme: string): AldoWorkGroupKind {
  if (theme.startsWith("site:")) return "site";
  return theme === "research" ||
    theme === "make" ||
    theme === "share" ||
    theme === "ask" ||
    theme === "app"
    ? theme
    : "other";
}

/**
 * A run of work in plain-word groups, in the order each kind of work first
 * came up. Steps it can't put in words still count, in the group they came in.
 * `endedAt` is when the run ended, for the last step's time.
 */
export function aldoWorkGroups(
  entries: ReadonlyArray<Entry>,
  endedAt: string | null = null,
): AldoWorkGroup[] {
  const work = omitSupersededLifecycleMarkers(entries, (entry) => entry).filter(
    (entry) => entry.tone !== "info" && entry.tone !== "thinking",
  );
  // A step with no words of its own still says which tool it used ("Used gig lookup").
  const found = aldoStepsInOrder(work).map((step, index): AldoStep | null => {
    if (step) return step;
    const entry = work[index]!;
    if (entry.tone !== "tool") return null;
    const done = aldoWorkWords.step(entry, false);
    return done ? { kind: "other", done, doing: done } : null;
  });
  const groups: Building[] = [];
  const byTheme = new Map<string, Building>();
  let current: Building | undefined;
  for (const [index, entry] of work.entries()) {
    const step = found[index] ?? null;
    const theme = themeOf(step, current);
    let group: Building | undefined;
    if (theme === null) {
      group = current;
    } else if (current?.theme === "") {
      // What came first, before the work had a kind, is the start of this group.
      current.theme = theme;
      current.kind = kindOf(theme);
      current.site = theme.startsWith("site:") ? theme.slice(5) || null : null;
      byTheme.set(theme, current);
      group = current;
    } else {
      group = byTheme.get(theme);
    }
    if (!group) {
      group = {
        key: entry.id,
        theme: theme ?? "",
        kind: theme ? kindOf(theme) : "other",
        site: theme?.startsWith("site:") ? theme.slice(5) || null : null,
        steps: [],
        count: 0,
        elapsedMs: 0,
        timed: false,
      };
      groups.push(group);
      if (theme) byTheme.set(theme, group);
    }
    current = group;
    if (step) group.steps.push(step);
    if (entry.tone === "tool") group.count += 1;
    const next = work[index + 1]?.createdAt ?? endedAt;
    const start = Date.parse(entry.createdAt);
    const end = next ? Date.parse(next) : Number.NaN;
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      group.elapsedMs += end - start;
      group.timed = true;
    }
  }
  return groups.map((group) => {
    const title = titleOf(group);
    return {
      key: group.key,
      kind: group.kind,
      title,
      items: itemsOf(group, title),
      steps: group.count,
      elapsedMs: group.timed ? group.elapsedMs : null,
    };
  });
}

/** Plain words for every step, and the work between messages folded into one row. */
export const aldoQuietWork: WorkWords = {
  ...aldoWorkWords,
  worked: aldoWorkedLabel,
};
