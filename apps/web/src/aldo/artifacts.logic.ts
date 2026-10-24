// What a message of Aldo's shows besides its words (Aldo's
// src/lib/assistant/show.ts): a file played or shown in place, and a chart or
// a table drawn here from its data. Read defensively, so an Aldo from before
// or after this page loses nothing: what isn't one of these is left out, and
// an Aldo without them sends none.

/** One of the user's shares (`/s/<id>`), or a thread's recording or screenshot in Aldo's Blob store. */
export interface AldoFileArtifact {
  readonly kind: "file";
  readonly url: string;
  readonly title: string;
  readonly contentType: string;
  readonly bytes?: number;
}

export interface AldoChartArtifact {
  readonly kind: "chart";
  readonly title: string;
  readonly type: "bar" | "line";
  readonly labels: ReadonlyArray<string>;
  readonly series: ReadonlyArray<{ readonly name: string; readonly values: ReadonlyArray<number> }>;
  readonly unit?: string;
}

export interface AldoTableArtifact {
  readonly kind: "table";
  readonly title?: string;
  readonly columns: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
}

export type AldoArtifact = AldoFileArtifact | AldoChartArtifact | AldoTableArtifact;

const SHARE_PATH = /^\/s\/([A-Za-z0-9_-]{16,32})$/;
const DEMO_URL =
  /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/artifacts\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/;
const MAX = 6;

const isText = (value: unknown): value is string => typeof value === "string";
const texts = (value: unknown, max: number): string[] | null =>
  Array.isArray(value) && value.every(isText) ? value.slice(0, max) : null;

function artifactOf(value: unknown): AldoArtifact | null {
  if (!value || typeof value !== "object") return null;
  const a = value as Record<string, unknown>;
  if (a.kind === "file") {
    if (!isText(a.url) || !(SHARE_PATH.test(a.url) || DEMO_URL.test(a.url))) return null;
    if (!isText(a.title) || !isText(a.contentType)) return null;
    const bytes = typeof a.bytes === "number" && a.bytes > 0 ? { bytes: a.bytes } : {};
    return { kind: "file", url: a.url, title: a.title, contentType: a.contentType, ...bytes };
  }
  if (a.kind === "chart") {
    const labels = texts(a.labels, 40);
    const series = Array.isArray(a.series)
      ? a.series.slice(0, 3).flatMap((s: unknown) => {
          const { name, values } = (s ?? {}) as Record<string, unknown>;
          return isText(name) &&
            Array.isArray(values) &&
            values.length >= (labels?.length ?? 0) &&
            values.every((v) => typeof v === "number" && Number.isFinite(v))
            ? [{ name, values: (values as number[]).slice(0, labels?.length ?? 0) }]
            : [];
        })
      : [];
    if ((a.type !== "bar" && a.type !== "line") || !labels?.length || series.length === 0)
      return null;
    return {
      kind: "chart",
      title: isText(a.title) ? a.title : "",
      type: a.type,
      labels,
      series,
      ...(isText(a.unit) && a.unit ? { unit: a.unit } : {}),
    };
  }
  if (a.kind === "table") {
    const columns = texts(a.columns, 8);
    if (!columns?.length || !Array.isArray(a.rows)) return null;
    const rows = a.rows.flatMap((row: unknown) => {
      const cells = texts(row, 8);
      return cells ? [columns.map((_, i) => cells[i] ?? "")] : [];
    });
    if (rows.length === 0) return null;
    return {
      kind: "table",
      ...(isText(a.title) && a.title ? { title: a.title } : {}),
      columns,
      rows: rows.slice(0, 40),
    };
  }
  return null;
}

/** A message's artifacts as Aldo sent them, those this page can show; none for anything else. */
export function artifactsOf(value: unknown): ReadonlyArray<AldoArtifact> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => artifactOf(v) ?? []).slice(0, MAX);
}

/** `{ artifacts }` for a message when it has some, to spread into it. */
export function artifactsField(value: unknown): {
  readonly artifacts?: ReadonlyArray<AldoArtifact>;
} {
  const artifacts = artifactsOf(value);
  return artifacts.length > 0 ? { artifacts } : {};
}

/** A share's id, from its path. */
const shareIdOf = (url: string) => SHARE_PATH.exec(url)?.[1] ?? null;

/**
 * Where a file loads from in the conversation: a share from the page's own
 * origin, so a private one has the user's sign-in, marked as shown in the
 * chat (it isn't counted as an opening); a demo file from its own address.
 */
export function inlineSrc(file: AldoFileArtifact): string {
  return shareIdOf(file.url) ? `${file.url}?in=chat` : file.url;
}

/**
 * Where saving a file downloads from: the page's own origin's address
 * (`download` names it; Markdown as the file, not the page /s/ makes of it),
 * or a Blob file's as an attachment (a browser ignores `download` for another
 * origin).
 */
export function downloadHref(url: string, origin: string, contentType = ""): string {
  try {
    const at = new URL(url, origin);
    if (at.origin === origin) {
      if (!contentType.startsWith("text/markdown")) return url;
      at.searchParams.set("raw", "1");
      return `${at.pathname}${at.search}`;
    }
    if (at.hostname.endsWith(".blob.vercel-storage.com")) {
      at.searchParams.set("download", "1");
      return at.toString();
    }
  } catch {
    // Not an address: as it is.
  }
  return url;
}

/** How a file shows in place. */
export type AldoFileShape = "image" | "video" | "audio" | "page" | "tile";

export function fileShape(contentType: string): AldoFileShape {
  const type = contentType.split(";")[0]!.trim().toLowerCase();
  // An SVG shows as a picture: in an <img>, its scripts never run.
  if (/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(type)) return "image";
  if (type === "video/mp4") return "video";
  if (type.startsWith("audio/")) return "audio";
  // What /s/ serves as a page to read or run, sandboxed on an origin of its own.
  if (type === "text/html" || type === "text/markdown") return "page";
  return "tile";
}

/** Whether a link in a reply goes to what one of its artifacts shows. */
function shows(href: string, artifacts: ReadonlyArray<AldoArtifact>): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  const share = /^\/s\/([A-Za-z0-9_-]{16,32})\/?$/.exec(url.pathname)?.[1];
  return artifacts.some(
    (a) =>
      a.kind === "file" &&
      (share ? shareIdOf(a.url) === share : a.url === `${url.origin}${url.pathname}`),
  );
}

/**
 * A reply's words without the lines that only link to what it shows in
 * place (`Shared link: https://…/s/<id>`, as a thread's result lists what it
 * made). The words Aldo keeps are unchanged: a text, or a page without
 * artifacts, still has them.
 */
export function withoutShownLinks(text: string, artifacts: ReadonlyArray<AldoArtifact>): string {
  if (!artifacts.some((a) => a.kind === "file")) return text;
  return text
    .split("\n")
    .filter((line) => {
      const link = /^[^:\n]{1,60}: (https:\/\/\S+)$/.exec(line.trim());
      return !(link && shows(link[1]!, artifacts));
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

/** A figure as the page shows it: "$12", "40%", "3.5 h". */
export function formatValue(value: number, unit?: string): string {
  const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
  if (!unit) return number;
  if (/^[$€£¥]$/.test(unit)) return value < 0 ? `-${unit}${number.slice(1)}` : `${unit}${number}`;
  if (unit === "%") return `${number}%`;
  return `${number} ${unit}`;
}

/** The top of a chart's scale: a round number at or above its largest value (1, 2, 2.5 or 5 times a power of ten). */
export function niceMax(values: ReadonlyArray<number>): number {
  const max = Math.max(0, ...values);
  if (max === 0) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  return [1, 2, 2.5, 5, 10].map((step) => step * power).find((top) => top >= max)!;
}

/** A chart's scale: round numbers at or past its values, from zero or below it to zero or above it. */
export function chartScale(values: ReadonlyArray<number>): { top: number; bottom: number } {
  const below = Math.min(0, ...values) < 0;
  return {
    top: below && Math.max(0, ...values) === 0 ? 0 : niceMax(values),
    bottom: below ? -niceMax(values.map((v) => -v)) : 0,
  };
}

/**
 * A chart's data as a table: its labels, then a column for each series. As
 * the page writes the figures, or `raw`, for a spreadsheet: each as Aldo sent
 * it, its unit in the column's name.
 */
export function chartTable(chart: AldoChartArtifact, raw = false): Omit<AldoTableArtifact, "kind"> {
  const unit = raw && chart.unit ? ` (${chart.unit})` : "";
  return {
    title: chart.title,
    columns: ["", ...chart.series.map((s) => `${s.name || "Value"}${unit}`)],
    rows: chart.labels.map((label, i) => [
      label,
      ...chart.series.map((s) =>
        raw ? String(s.values[i]) : formatValue(s.values[i]!, chart.unit),
      ),
    ]),
  };
}

/**
 * A table as CSV, for a spreadsheet: each cell quoted when it needs it, and
 * one that would start a formula (=, +, -, @) kept as text.
 */
export function csvOf(
  columns: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
): string {
  const cell = (value: string) => {
    const safe =
      /^[=+\-@\t\r]/.test(value) && !/^-?\d[\d,.]*(e[+-]?\d+)?$/.test(value) ? `'${value}` : value;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [columns, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** A file name for something titled so: its words, without what a file name can't hold. */
export function fileNameOf(title: string, ext: string): string {
  const name = title
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${name || "aldo"}.${ext}`;
}
