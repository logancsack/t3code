// "What it made": the files a finished turn left (its checkpoint's changed
// files) that are things people use, a sheet, a document, a deck, a PDF, an
// image, a page, and what it shared by link during the turn. Scripts and
// other working files stay behind "All changes" (AldoMadeCards).

export type AldoMadeKind =
  | "sheet"
  | "document"
  | "deck"
  | "pdf"
  | "image"
  | "page"
  | "video"
  | "audio"
  | "archive";

export interface AldoMadeItem {
  /** Relative to the thread's folder, when it's in it. */
  readonly path: string | null;
  readonly name: string;
  readonly kind: AldoMadeKind;
  /** Its share's title, when it was shared during the turn. */
  readonly sharedAs?: string;
  /** Its share's link, where the agent's record of sharing it says. */
  readonly url?: string;
  /** False when only the user can open its link; anyone with it can otherwise. */
  readonly public?: false;
  /** The path it was shared from, when that's outside the thread's folder. */
  readonly sourcePath?: string;
}

export interface AldoShare {
  readonly path: string | null;
  readonly title: string | null;
  readonly url: string | null;
  /** False when only the user can open its link (share_file's `public: false`); anyone with it can otherwise. */
  readonly public?: false;
}

const KIND_BY_EXTENSION: Record<string, AldoMadeKind> = {
  xlsx: "sheet",
  xls: "sheet",
  xlsm: "sheet",
  ods: "sheet",
  csv: "sheet",
  numbers: "sheet",
  docx: "document",
  doc: "document",
  odt: "document",
  rtf: "document",
  md: "document",
  txt: "document",
  pages: "document",
  pptx: "deck",
  ppt: "deck",
  odp: "deck",
  key: "deck",
  pdf: "pdf",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  avif: "image",
  html: "page",
  htm: "page",
  mp4: "video",
  mov: "video",
  webm: "video",
  mp3: "audio",
  wav: "audio",
  m4a: "audio",
  ogg: "audio",
  zip: "archive",
};

export const ALDO_MADE_KIND_LABEL: Record<AldoMadeKind, string> = {
  sheet: "Sheet",
  document: "Document",
  deck: "Deck",
  pdf: "PDF",
  image: "Image",
  page: "Page",
  video: "Video",
  audio: "Audio",
  archive: "Zip",
};

/** Notes every folder has, not things a turn made for the user. */
const WORKING_NAMES = new Set([
  "readme.md",
  "agents.md",
  "claude.md",
  "notes.md",
  "license.txt",
  "requirements.txt",
]);

function baseName(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .at(-1) ?? path
  );
}

export function aldoMadeKind(path: string): AldoMadeKind | null {
  const name = baseName(path).toLowerCase();
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return KIND_BY_EXTENSION[name.slice(dot + 1)] ?? null;
}

/** Hidden folders, dependencies and build output: the machinery, not the work. */
function isWorkingPath(path: string): boolean {
  const parts = path.split(/[\\/]/);
  return (
    parts.some(
      (part, index) =>
        (part.startsWith(".") && part !== "." && part !== "..") ||
        part === "node_modules" ||
        part === "__pycache__" ||
        (index < parts.length - 1 && (part === "dist" || part === "build" || part === "venv")),
    ) || WORKING_NAMES.has(baseName(path).toLowerCase())
  );
}

/** `path` from share_file, relative to the thread's folder when it's inside it. */
function relativeTo(path: string, root: string | undefined): string | null {
  if (!path.startsWith("/")) return path.replace(/^\.\//, "");
  if (!root) return null;
  const base = root.replace(/\/+$/, "");
  return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : null;
}

/**
 * The turn's made things: shares first (they're what the user was handed),
 * then its other changed files of a kind people use. `others` counts the
 * changed files left out.
 */
export function aldoTurnMade(input: {
  readonly files: ReadonlyArray<{
    readonly path: string;
    readonly additions: number;
    readonly deletions: number;
  }>;
  readonly shares: ReadonlyArray<AldoShare>;
  readonly workspaceRoot: string | undefined;
}): { readonly items: ReadonlyArray<AldoMadeItem>; readonly others: number } {
  const items: AldoMadeItem[] = [];
  const seen = new Set<string>();
  for (const share of input.shares) {
    const path = share.path ? relativeTo(share.path, input.workspaceRoot) : null;
    const name = share.path ? baseName(share.path) : (share.title ?? "Shared file");
    const key = path ?? share.path ?? share.url ?? name;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      path,
      name,
      // A provider that records only the reply leaves its title to go by.
      kind: aldoMadeKind(share.path ?? share.title ?? "") ?? "page",
      ...(share.title ? { sharedAs: share.title } : {}),
      ...(share.url ? { url: share.url } : {}),
      ...(share.public === false ? { public: false as const } : {}),
      ...(share.path && path === null ? { sourcePath: share.path } : {}),
    });
  }
  let others = 0;
  for (const file of input.files) {
    if (seen.has(file.path)) continue;
    const kind = aldoMadeKind(file.path);
    // A text file that only lost lines was emptied or deleted, not made.
    const removed = file.additions === 0 && file.deletions > 0;
    if (!kind || removed || isWorkingPath(file.path)) {
      others += 1;
      continue;
    }
    seen.add(file.path);
    items.push({ path: file.path, name: baseName(file.path), kind });
  }
  return { items, others };
}
