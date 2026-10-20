// "Download everything" under a conversation's results (AldoDownloadEverything):
// one zip of the files a turn made, made on its computer when the user asks
// (zipAldoFiles, Aldo's POST /api/environments/<id>/download), which says what
// didn't go in and why.

import type { AldoMadeItem } from "./made.logic";
import { aldoItemPath } from "./results.logic";

/** A file for the zip: its full path on the thread's computer, and the name the results show. */
export interface AldoZipFile {
  readonly path: string;
  readonly name: string;
}

/** One that didn't go in, and why, in Aldo's words ("it’s no longer on its computer"). */
export interface AldoZipLeft {
  readonly name: string;
  readonly why: string;
}

/** What a zip holds (or, checked, would), and once it's made, where to fetch it until when. */
export interface AldoZip {
  readonly bytes: number;
  readonly files: number;
  readonly left: ReadonlyArray<AldoZipLeft>;
  readonly url: string | null;
  readonly name: string | null;
  readonly expiresAt: string | null;
}

/**
 * The turn's made things its computer can zip, each once, by full path, under
 * the name the results show (its share's title, or its file name); `links`
 * names the ones that are only a link, with no file there to zip.
 */
export function aldoZipFiles(
  items: ReadonlyArray<AldoMadeItem>,
  workspaceRoot: string | undefined,
): { readonly files: ReadonlyArray<AldoZipFile>; readonly links: ReadonlyArray<string> } {
  const files: AldoZipFile[] = [];
  const links: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const path = aldoItemPath(item, workspaceRoot);
    if (!path) {
      if (item.url) links.push(item.sharedAs ?? item.name);
      continue;
    }
    if (seen.has(path)) continue;
    seen.add(path);
    files.push({ path, name: item.sharedAs ?? item.name });
  }
  return { files, links };
}

/** "Download everything" is for more than one file. */
export function aldoOffersZip(files: ReadonlyArray<AldoZipFile>): boolean {
  return files.length > 1;
}

/** The same files in any order are the same zip, for the size its computer said. */
export function aldoZipKey(environmentId: string, files: ReadonlyArray<AldoZipFile>): string {
  return `${environmentId}\n${files
    .map((file) => file.path)
    .toSorted()
    .join("\n")}`;
}

const KB = 1024;
const MB = 1024 * KB;

/** "820 KB", "4.2 MB", "57 MB", "1.1 GB". */
export function formatAldoZipSize(bytes: number): string {
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / KB))} KB`;
  if (bytes < 10 * MB) return `${(Math.round((bytes / MB) * 10) / 10).toString()} MB`;
  if (bytes < 1024 * MB) return `${Math.round(bytes / MB)} MB`;
  return `${(Math.round((bytes / (1024 * MB)) * 10) / 10).toString()} GB`;
}

/** "Download everything (zip, 57 MB)", or without the size while it isn't known. */
export function aldoZipLabel(bytes: number | null): string {
  return bytes === null || bytes <= 0
    ? "Download everything (zip)"
    : `Download everything (zip, ${formatAldoZipSize(bytes)})`;
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/** "one file", "three files", "12 files". */
export function aldoFileCount(count: number): string {
  const number = count < WORDS.length ? WORDS[count] : String(count);
  return `${number} ${count === 1 ? "file" : "files"}`;
}

/** "Downloading Quarterly report.zip: three files, 57 MB." */
export function aldoZipMadeText(zip: AldoZip): string {
  return `Downloading ${zip.name ?? "the zip"}: ${aldoFileCount(zip.files)}, ${formatAldoZipSize(zip.bytes)}.`;
}

/** What didn't go in, a sentence each: "deck.pptx isn’t in it: it’s no longer on its computer." */
export function aldoZipLeftLines(
  left: ReadonlyArray<AldoZipLeft>,
  links: ReadonlyArray<string>,
): ReadonlyArray<string> {
  return [
    ...left.map((entry) => `${entry.name} isn’t in it: ${entry.why.replace(/\.$/, "")}.`),
    ...links.map((name) => `${name} isn’t in it: it’s a link, with no file on its computer.`),
  ];
}

/** Aldo's answer, checked; null when it isn't one. */
export function aldoZipOf(body: unknown): AldoZip | null {
  if (typeof body !== "object" || body === null) return null;
  const value = body as Record<string, unknown>;
  if (typeof value.bytes !== "number" || typeof value.files !== "number") return null;
  const left = Array.isArray(value.left)
    ? value.left.flatMap((entry: unknown) => {
        const { name, why } = (entry ?? {}) as { name?: unknown; why?: unknown };
        return typeof name === "string" && typeof why === "string" ? [{ name, why }] : [];
      })
    : [];
  const text = (key: string) => (typeof value[key] === "string" ? (value[key] as string) : null);
  const url = text("url");
  return {
    bytes: value.bytes,
    files: value.files,
    left,
    // Only an HTTPS link is followed.
    url: url?.startsWith("https://") ? url : null,
    name: text("name"),
    expiresAt: text("expiresAt"),
  };
}
