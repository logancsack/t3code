// The results block at the end of a finished turn in a thread that isn't code
// (AldoMadeCards): what the turn made and shared (made.logic.ts), laid out as
// the work itself. One main item large (a video, or a page with a preview),
// then a gallery of images and clips, live links as cards, and documents as
// rows that open a reader, each saying who can open it. What the answer
// already shows in place (an image, a video on a line of its own) isn't shown
// again, and a screenshot the answer links to a live page becomes that page's
// card.

import { classifyMarkdownImageSource } from "@t3tools/client-runtime/markdown-images";
import { mediaKindFromPath } from "@t3tools/shared/filePreview";

import { aldoShareIdOf, aldoShareKind, type AldoShareView } from "./library.logic";
import type { AldoMadeItem, AldoMadeKind } from "./made.logic";

// ---------------------------------------------------------------------------
// The answer's Markdown

/** A link or image destination (`<a b.png>` or `a.png`, one level of parentheses), with an optional title. */
const DESTINATION = String.raw`\(\s*(<[^>\n]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)`;
const IMAGE = new RegExp(String.raw`!\[([^\]\n]*)\]${DESTINATION}`, "g");
const LINKED_IMAGE = new RegExp(
  String.raw`\[\s*!\[([^\]\n]*)\]${DESTINATION}\s*\]${DESTINATION}`,
  "g",
);
/** A line that's one link and nothing else, bold or italic too. */
const SOLE_LINK = new RegExp(String.raw`^(\*\*|__|\*|_)?\[[^\]\n]*\]${DESTINATION}\1$`);
const LIST_MARKER = /^(?:[-*+]|\d+[.)])\s+/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

interface Block {
  /** Its first line, and the line after its last. */
  readonly start: number;
  readonly end: number;
  readonly code: boolean;
}

/** The answer's paragraphs and code blocks, by line: blank lines end a paragraph. */
function blocksOf(lines: ReadonlyArray<string>): Block[] {
  const blocks: Block[] = [];
  let start = -1;
  let fence: string | null = null;
  lines.forEach((line, index) => {
    if (fence !== null) {
      const close = FENCE.exec(line);
      if (close && close[1]![0] === fence[0] && close[1]!.length >= fence.length) {
        blocks.push({ start, end: index + 1, code: true });
        fence = null;
        start = -1;
      }
      return;
    }
    const open = FENCE.exec(line);
    if (open) {
      if (start >= 0) blocks.push({ start, end: index, code: false });
      fence = open[1]!;
      start = index;
      return;
    }
    if (line.trim() === "") {
      if (start >= 0) blocks.push({ start, end: index, code: false });
      start = -1;
      return;
    }
    if (start < 0) start = index;
  });
  if (start >= 0) blocks.push({ start, end: lines.length, code: fence !== null });
  return blocks;
}

const unwrap = (destination: string) =>
  destination.startsWith("<") && destination.endsWith(">") ? destination.slice(1, -1) : destination;

/** The same thing however it's addressed: a share by its id, a file by its absolute path. */
function mediaKey(destination: string, workspaceRoot: string | undefined): string | null {
  const source = classifyMarkdownImageSource(unwrap(destination), workspaceRoot);
  if (source._tag === "Blocked") return null;
  if (source._tag === "WorkspaceFile") return `file:${source.path}`;
  const id = /^https?:/i.test(source.uri) ? aldoShareIdOf(source.uri) : null;
  return id ? `share:${id}` : `url:${source.uri}`;
}

/** What a made thing is known by: its file (in the folder, or where it was shared from) and its link. */
function itemKeys(item: AldoMadeItem, workspaceRoot: string | undefined): string[] {
  const keys: string[] = [];
  const absolute = aldoItemPath(item, workspaceRoot);
  if (absolute) keys.push(`file:${absolute}`);
  if (item.url) {
    const id = aldoShareIdOf(item.url);
    keys.push(id ? `share:${id}` : `url:${item.url}`);
  }
  return keys;
}

/** What the answer shows in place, keyed as `itemKeys` keys made things. */
export interface AldoAnswerMedia {
  readonly keys: ReadonlySet<string>;
  /** It plays a video: that's the main thing, so the results block doesn't show another large. */
  readonly plays: boolean;
}

/**
 * The images and videos the answer shows in place: every image, and a video
 * linked on a line of its own (it plays there).
 */
export function aldoAnswerMedia(text: string, workspaceRoot: string | undefined): AldoAnswerMedia {
  const shown = new Set<string>();
  let plays = false;
  const lines = text.split("\n");
  for (const block of blocksOf(lines)) {
    if (block.code) continue;
    const body = lines.slice(block.start, block.end).join("\n");
    for (const match of body.matchAll(IMAGE)) {
      const key = mediaKey(match[2]!, workspaceRoot);
      if (key) shown.add(key);
    }
    const sole = block.end - block.start === 1 ? SOLE_LINK.exec(body.trim()) : null;
    if (sole && mediaKindFromPath(unwrap(sole[2]!)) === "video") {
      const key = mediaKey(sole[2]!, workspaceRoot);
      if (key) shown.add(key);
      plays ||= key !== null;
    }
  }
  return { keys: shown, plays };
}

/** A screenshot the answer links to a live page: `[![Gig 1](shots/gig-1.png)](https://…)`. */
export interface AldoLiveShot {
  readonly title: string | null;
  /** The screenshot, as the answer addresses it. */
  readonly image: string;
  readonly url: string;
}

/**
 * Takes the answer's live pages out of its text: a paragraph (or list) that's
 * only screenshots, each linked to a web page (not to an image or a video),
 * becomes cards in the results block. Everything else stays where it is.
 */
export function aldoLiveShots(text: string): {
  readonly text: string;
  readonly shots: ReadonlyArray<AldoLiveShot>;
} {
  if (!text.includes("](")) return { text, shots: [] };
  const lines = text.split("\n");
  const shots: AldoLiveShot[] = [];
  const lifted = new Set<number>();
  for (const block of blocksOf(lines)) {
    if (block.code) continue;
    const found: AldoLiveShot[] = [];
    let rest = "";
    for (const line of lines.slice(block.start, block.end)) {
      const bare = line.trim().replace(LIST_MARKER, "");
      rest += bare.replace(LINKED_IMAGE, (_whole, alt: string, image: string, url: string) => {
        found.push({ title: alt.trim() || null, image: unwrap(image), url: unwrap(url) });
        return "";
      });
    }
    const pages = found.every(
      (shot) => /^https?:\/\//i.test(shot.url) && !mediaKindFromPath(shot.url),
    );
    if (found.length === 0 || !pages || rest.replace(/<br\s*\/?>|\\/gi, "").trim() !== "") continue;
    shots.push(...found);
    for (let index = block.start; index < block.end; index += 1) lifted.add(index);
  }
  if (shots.length === 0) return { text, shots };
  const kept = lines.filter((_line, index) => !lifted.has(index)).join("\n");
  return { text: kept.replace(/\n{3,}/g, "\n\n").trim(), shots };
}

// ---------------------------------------------------------------------------
// Who can open it

/** Anyone with the link, only the user (signed in, or in the thread), or nobody now: its link was stopped. */
export type AldoAudience = "public" | "private" | "stopped";

/**
 * A share as Aldo's list has it: the share, "gone" once Aldo has looked again
 * and it isn't listed (its sharing was stopped), or null while that's unknown.
 */
export type AldoListedShare = (id: string) => AldoShareView | "gone" | null;

/** Where a made thing is on the thread's computer, when that's known. */
export function aldoItemPath(item: AldoMadeItem, workspaceRoot: string | undefined): string | null {
  if (item.path && workspaceRoot) return `${workspaceRoot.replace(/\/+$/, "")}/${item.path}`;
  return item.sourcePath?.startsWith("/") ? item.sourcePath : null;
}

// ---------------------------------------------------------------------------
// The block

export interface AldoResultItem {
  readonly key: string;
  /** What it's called: its share's title, or its file name. */
  readonly name: string;
  readonly fileName: string;
  readonly kind: AldoMadeKind;
  /** Relative to the thread's folder, when it's there: it opens beside the thread. */
  readonly path: string | null;
  /** Where the thread's machine serves it from, when it can. */
  readonly absolutePath: string | null;
  /** Its share's link, while that works. */
  readonly url: string | null;
  /** Its share's id, kept after its sharing stopped: a screenshot linked to it is still its. */
  readonly shareId: string | null;
  /** Who can open it; null where nothing says. */
  readonly audience: AldoAudience | null;
  /** Its share as Aldo lists it, when it does. */
  readonly share?: AldoShareView;
}

/** A live page: a page the turn made or shared, or one the answer linked a screenshot to. */
export interface AldoResultLink {
  readonly key: string;
  readonly title: string;
  readonly url: string | null;
  /** "fiverr.com/logansack/logo-reveal", or the file's name. */
  readonly address: string;
  /** A screenshot of it, as the answer addresses it. */
  readonly image: string | null;
  /** The page the turn made or shared, when it's one. */
  readonly item: AldoResultItem | null;
}

export interface AldoResults {
  /** Shown large: a video, or a page with a preview. */
  readonly main: AldoResultItem | null;
  /** Its screenshot, when the main item is a page the answer linked one to. */
  readonly mainImage: string | null;
  /** Images and clips. */
  readonly gallery: ReadonlyArray<AldoResultItem>;
  readonly links: ReadonlyArray<AldoResultLink>;
  /** Documents, sheets, decks, PDFs, audio and zips. */
  readonly documents: ReadonlyArray<AldoResultItem>;
}

/** "https://www.fiverr.com/logansack/logo-reveal?ref=1" → "fiverr.com/logansack/logo-reveal". */
export function aldoAddress(url: string): string {
  try {
    const parsed = new URL(url);
    const path = decodeURIComponent(parsed.pathname).replace(/\/+$/, "");
    return `${parsed.hostname.replace(/^www\./, "")}${path}`;
  } catch {
    return url;
  }
}

function resultItem(
  item: AldoMadeItem,
  workspaceRoot: string | undefined,
  listed: AldoListedShare,
): AldoResultItem {
  const id = item.url ? aldoShareIdOf(item.url) : null;
  const share = id ? listed(id) : null;
  const gone = share === "gone";
  const known = share && share !== "gone" ? share : null;
  const shared = item.sharedAs !== undefined || item.url !== undefined;
  // Aldo's list of shares decides, then what the agent's step said (a link is for anyone
  // unless it said only the user); a file in the folder no link was made for is the user's alone.
  const audience: AldoAudience | null = known
    ? known.public
      ? "public"
      : "private"
    : gone
      ? item.path !== null
        ? "private"
        : "stopped"
      : shared
        ? item.public === false
          ? "private"
          : "public"
        : item.path !== null
          ? "private"
          : null;
  return {
    key: itemKeys(item, workspaceRoot)[0] ?? `name:${item.name}`,
    name: (gone && item.path !== null ? null : item.sharedAs) ?? item.name,
    fileName: item.name,
    // A share's type says what it is better than a title does.
    kind: (known ? aldoShareKind(known.contentType) : null) ?? item.kind,
    path: item.path,
    absolutePath: aldoItemPath(item, workspaceRoot),
    url: gone ? null : (item.url ?? null),
    shareId: id,
    audience,
    ...(known ? { share: known } : {}),
  };
}

const DOCUMENT_ORDER: Record<AldoMadeKind, number> = {
  document: 0,
  sheet: 1,
  deck: 2,
  pdf: 3,
  audio: 4,
  archive: 5,
  page: 6,
  image: 7,
  video: 8,
};

/**
 * Lays out a turn's made things. The main item is the first video, or else the
 * first page that can be previewed (from its file, or a screenshot the answer
 * linked to it), unless the answer plays a video itself; what the answer
 * already shows in place is left out.
 */
export function aldoResults(input: {
  readonly items: ReadonlyArray<AldoMadeItem>;
  readonly workspaceRoot: string | undefined;
  /** `aldoAnswerMedia` of the answer. */
  readonly shown: AldoAnswerMedia;
  readonly shots: ReadonlyArray<AldoLiveShot>;
  readonly listed: AldoListedShare;
}): AldoResults {
  const items = input.items
    .filter((item) => !itemKeys(item, input.workspaceRoot).some((key) => input.shown.keys.has(key)))
    .map((item) => resultItem(item, input.workspaceRoot, input.listed));
  // A screenshot linked to a page the turn shared is that page's picture.
  const shotOf = new Map<string, AldoLiveShot>();
  const looseShots: AldoLiveShot[] = [];
  for (const shot of input.shots) {
    const id = aldoShareIdOf(shot.url);
    const page = id ? items.find((item) => item.shareId === id) : undefined;
    if (page && !shotOf.has(page.key)) shotOf.set(page.key, shot);
    // A link whose sharing was stopped isn't offered.
    else if (!id || input.listed(id) !== "gone") looseShots.push(shot);
  }
  // The answer's own video, playing in it, is the main thing when there's one.
  const main = input.shown.plays
    ? null
    : (items.find((item) => item.kind === "video" && (item.absolutePath || item.url)) ??
      items.find((item) => item.kind === "page" && (item.absolutePath || shotOf.has(item.key))) ??
      null);
  const gallery = items.filter(
    (item) => item !== main && (item.kind === "image" || item.kind === "video"),
  );
  const links: AldoResultLink[] = [];
  for (const item of items) {
    if (item === main || item.kind !== "page") continue;
    links.push({
      key: item.key,
      title: item.name,
      url: item.url,
      address: item.url ? aldoAddress(item.url) : (item.path ?? item.fileName),
      image: shotOf.get(item.key)?.image ?? null,
      item,
    });
  }
  const seen = new Set<string>();
  for (const shot of looseShots) {
    if (seen.has(shot.url)) continue;
    seen.add(shot.url);
    const address = aldoAddress(shot.url);
    links.push({
      key: `url:${shot.url}`,
      title: shot.title ?? address,
      url: shot.url,
      address,
      image: shot.image,
      item: null,
    });
  }
  const documents = items
    .filter((item) => item !== main && !["image", "video", "page"].includes(item.kind))
    .toSorted((a, b) => DOCUMENT_ORDER[a.kind] - DOCUMENT_ORDER[b.kind]);
  return {
    main,
    mainImage: main ? (shotOf.get(main.key)?.image ?? null) : null,
    gallery,
    links,
    documents,
  };
}

// ---------------------------------------------------------------------------
// A document, in sections

export interface AldoDocumentSection {
  /** Its heading's words; null for what comes before the first heading. */
  readonly heading: string | null;
  /** 1 to 6, as the heading's #s; 0 before the first heading. */
  readonly depth: number;
  /** The Markdown under the heading, up to the next one; empty for a heading that only groups those below it. */
  readonly body: string;
}

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;

/**
 * A Markdown or text document split at its headings, so each part (a listing's
 * title, its tags, its description) can be copied on its own. A lone top
 * heading at the start is the document's title.
 */
export function aldoDocumentSections(text: string): {
  readonly title: string | null;
  readonly sections: ReadonlyArray<AldoDocumentSection>;
} {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const sections: Array<{ heading: string | null; depth: number; lines: string[] }> = [
    { heading: null, depth: 0, lines: [] },
  ];
  let fence: string | null = null;
  for (const line of lines) {
    const open = FENCE.exec(line);
    if (fence !== null) {
      if (open && open[1]![0] === fence[0] && open[1]!.length >= fence.length) fence = null;
      sections.at(-1)!.lines.push(line);
      continue;
    }
    if (open) fence = open[1]!;
    const heading = open ? null : HEADING.exec(line);
    if (heading) {
      sections.push({ heading: heading[2]!.trim(), depth: heading[1]!.length, lines: [] });
    } else {
      sections.at(-1)!.lines.push(line);
    }
  }
  const parts = sections
    .map((section) => ({
      heading: section.heading,
      depth: section.depth,
      body: section.lines.join("\n").trim(),
    }))
    .filter((section) => section.heading !== null || section.body !== "");
  const first = parts[0];
  const top = first && first.heading !== null && first.depth === 1;
  const onlyTop = top && parts.filter((part) => part.depth === 1).length === 1;
  if (!onlyTop) return { title: null, sections: parts };
  // The title's own words, before the first part, read as an introduction.
  const rest = parts.slice(1);
  return {
    title: first.heading,
    sections: first.body ? [{ heading: null, depth: 0, body: first.body }, ...rest] : rest,
  };
}

/** Whether a document opens in the reader: Markdown or plain text in the thread's folder. */
export function aldoReadable(item: Pick<AldoResultItem, "kind" | "path" | "fileName">): boolean {
  return (
    item.kind === "document" && item.path !== null && /\.(md|markdown|txt)$/i.test(item.fileName)
  );
}
