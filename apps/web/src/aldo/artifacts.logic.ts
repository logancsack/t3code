// What a message of Aldo's shows besides its words (Aldo's
// src/lib/assistant/show.ts): a file played or shown in place, and a chart or
// a table drawn here from its data. Read defensively, so an Aldo from before
// or after this page loses nothing: what isn't one of these is left out, and
// an Aldo without them sends none.

/** One of the user's shares (`/s/<id>`), or a thread's recording or screenshot (`/demo/<id>/file`; an Aldo from before kept it in a public Blob store). */
export interface AldoFileArtifact {
  readonly kind: "file";
  readonly url: string;
  readonly title: string;
  readonly contentType: string;
  readonly bytes?: number;
}

/** What a chart is: bars across (names, many items), columns, lines and areas over time, parts of a whole, two measures per item, or columns and lines together. */
export type AldoChartType =
  | "bar"
  | "column"
  | "line"
  | "area"
  | "pie"
  | "donut"
  | "scatter"
  | "combo";

export const CHART_TYPES: ReadonlyArray<AldoChartType> = [
  "bar",
  "column",
  "line",
  "area",
  "pie",
  "donut",
  "scatter",
  "combo",
];

/** A scatter chart's point: its two measures, and what it is. */
export interface AldoChartPoint {
  readonly x: number;
  readonly y: number;
  readonly label?: string;
  readonly color?: string;
}

export interface AldoChartSeries {
  readonly name: string;
  /** A value for each label; none in a scatter chart. */
  readonly values: ReadonlyArray<number>;
  /** A scatter chart's points. */
  readonly points?: ReadonlyArray<AldoChartPoint>;
  /** In a combo chart, how this series is drawn. */
  readonly mark?: "column" | "line";
  /** Its color, as hex; else the chart's defaults. */
  readonly color?: string;
  /** A pie's slices' colors, as hex, for each label ("" for the default). */
  readonly colors?: ReadonlyArray<string>;
}

export interface AldoChartArtifact {
  readonly kind: "chart";
  readonly title: string;
  readonly type: AldoChartType;
  /** What each value is of; none in a scatter chart. */
  readonly labels: ReadonlyArray<string>;
  readonly series: ReadonlyArray<AldoChartSeries>;
  readonly unit?: string;
  /** Bars, columns or areas stacked into totals. */
  readonly stacked?: boolean;
  /** A scatter chart's axes: what each measures, and the horizontal one's unit. */
  readonly xAxis?: string;
  readonly yAxis?: string;
  readonly xUnit?: string;
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
  /^(?:\/demo\/a_[0-9a-z]{12}\/file|https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/artifacts\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+)$/;
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
  if (a.kind === "chart") return chartOf(a);
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

const MAX_SERIES = 6;
const MAX_LABELS = 40;
const MAX_POINTS = 200;
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const optionalText = (key: string, value: unknown) =>
  isText(value) && value ? { [key]: value } : {};

/** A color as hex, or nothing: what a style may be given without a page's say. */
const hex = (value: unknown): string | undefined =>
  isText(value) && /^#(?:[0-9a-f]{3}){1,2}$/i.test(value.trim())
    ? value.trim().toLowerCase()
    : undefined;
const optionalHex = (value: unknown) => {
  const color = hex(value);
  return color ? { color } : {};
};

function pointsOf(value: unknown): AldoChartPoint[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_POINTS).flatMap((p: unknown) => {
    const { x, y, label, color } = (p ?? {}) as Record<string, unknown>;
    return isNumber(x) && isNumber(y)
      ? [{ x, y, ...optionalText("label", label), ...optionalHex(color) }]
      : [];
  });
}

/** A chart as this page draws it: a type it knows, and a value for each label (a point, in a scatter chart). */
function chartOf(a: Record<string, unknown>): AldoChartArtifact | null {
  const type = CHART_TYPES.find((t) => t === a.type);
  if (!type || !Array.isArray(a.series)) return null;
  const labels = type === "scatter" ? [] : texts(a.labels, MAX_LABELS);
  if (!labels || (type !== "scatter" && labels.length === 0)) return null;
  const series = a.series.slice(0, MAX_SERIES).flatMap((s: unknown): AldoChartSeries[] => {
    const { name, values, points, mark, color, colors } = (s ?? {}) as Record<string, unknown>;
    if (!isText(name)) return [];
    const own = optionalHex(color);
    if (type === "scatter") {
      const kept = pointsOf(points);
      return kept.length ? [{ name, values: [], points: kept, ...own }] : [];
    }
    if (!Array.isArray(values) || values.length < labels.length || !values.every(isNumber))
      return [];
    const kept = (values as number[]).slice(0, labels.length);
    // A part of a whole is never less than nothing, and the whole is something.
    if (
      (type === "pie" || type === "donut") &&
      (kept.some((v) => v < 0) || !kept.some((v) => v > 0))
    )
      return [];
    const slices =
      (type === "pie" || type === "donut") && Array.isArray(colors)
        ? colors.slice(0, labels.length).map((c) => hex(c) ?? "")
        : [];
    return [
      {
        name,
        values: kept,
        ...(type === "combo" && mark === "line" ? { mark } : {}),
        ...own,
        ...(slices.some(Boolean) ? { colors: slices } : {}),
      },
    ];
  });
  // A pie is one series.
  const drawn = type === "pie" || type === "donut" ? series.slice(0, 1) : series;
  if (drawn.length === 0) return null;
  const stacks = type === "bar" || type === "column" || type === "area";
  return {
    kind: "chart",
    title: isText(a.title) ? a.title : "",
    type,
    labels,
    series: drawn,
    ...optionalText("unit", a.unit),
    ...(stacks && a.stacked === true && drawn.length > 1 ? { stacked: true } : {}),
    ...(type === "scatter"
      ? {
          ...optionalText("xAxis", a.xAxis),
          ...optionalText("yAxis", a.yAxis),
          ...optionalText("xUnit", a.xUnit),
        }
      : {}),
  };
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

/** How a file shows in place; any other only in a list (`row`), a tap from Aldo's viewer. */
export type AldoFileShape = "image" | "video" | "audio" | "page" | "row";

export function fileShape(contentType: string): AldoFileShape {
  const type = contentType.split(";")[0]!.trim().toLowerCase();
  // An SVG shows as a picture: in an <img>, its scripts never run.
  if (/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(type)) return "image";
  if (type === "video/mp4") return "video";
  if (type.startsWith("audio/")) return "audio";
  // What /s/ serves as a page to read or run, sandboxed on an origin of its own.
  if (type === "text/html" || type === "text/markdown") return "page";
  return "row";
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

/** A line that's only a link and what it is (`Pull request: https://…`), as a thread's result lists what it made. */
const LINK_LINE = /^(.{1,64}?): (https:\/\/\S+)$/;

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
      const link = LINK_LINE.exec(line.trim());
      return !(link && shows(link[2]!, artifacts));
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

/** A link a thread's result lists, as a row under it: what it is, and in a word what kind. */
export interface AldoLinkRow {
  readonly url: string;
  readonly title: string;
  readonly type: string;
}

function linkRow(label: string, url: URL): AldoLinkRow {
  const host = url.host.replace(/^www\./, "");
  const pull =
    url.host === "github.com" ? /^\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url.pathname) : null;
  if (pull) {
    // Unlabelled, Aldo calls it "Pull request": its repository and number say more.
    const title = label === "Pull request" ? `${pull[1]}/${pull[2]} #${pull[3]}` : label;
    return { url: url.href, title, type: "Pull request" };
  }
  return { url: url.href, title: label, type: label === host ? "Link" : host };
}

/**
 * A thread's result's words (closingThread's, so never a reply of Aldo's
 * own) without the lines at their end that only link to what it made, and
 * those links, to list as rows under it. A link in a sentence stays put.
 */
export function linkRows(text: string): {
  readonly text: string;
  readonly links: ReadonlyArray<AldoLinkRow>;
} {
  const lines = text.split("\n");
  const links: AldoLinkRow[] = [];
  for (let link; (link = LINK_LINE.exec(lines.at(-1)?.trim() ?? "")) && URL.canParse(link[2]!);) {
    links.unshift(linkRow(link[1]!, new URL(link[2]!)));
    lines.pop();
  }
  return { text: lines.join("\n").trimEnd(), links };
}

const shapeOf = (a: AldoArtifact) => (a.kind === "file" ? fileShape(a.contentType) : a.kind);

/**
 * What a reply shows first, and the rest, listed under it. First what Aldo
 * draws (every chart), a recording, a table, the pictures, a page, a sound;
 * an agent's picture of a chart may not read on a phone, so a table comes
 * first. A file sent twice (its link twice, or a copy of the same title,
 * type and size) is listed once.
 */
export function arrange(artifacts: ReadonlyArray<AldoArtifact>): {
  readonly lead: ReadonlyArray<AldoArtifact>;
  readonly rest: ReadonlyArray<AldoArtifact>;
} {
  const seen = new Set<string>();
  const once = artifacts.filter((a) => {
    if (a.kind !== "file") return true;
    const keys = [a.url, ...(a.bytes ? [`${a.contentType} ${a.bytes} ${a.title}`] : [])];
    if (keys.some((key) => seen.has(key))) return false;
    for (const key of keys) seen.add(key);
    return true;
  });
  const all = (shape: string) => once.filter((a) => shapeOf(a) === shape);
  const lead =
    [
      all("chart"),
      all("video").slice(0, 1),
      all("table").slice(0, 1),
      all("image"),
      all("page").slice(0, 1),
      all("audio").slice(0, 1),
    ].find((group) => group.length > 0) ?? [];
  return { lead, rest: once.filter((a) => !lead.includes(a)) };
}

/** A figure as the page shows it: "$12", "40%", "3.5 h"; `compact` for a scale's ticks ("$1.2K"). */
export function formatValue(value: number, unit?: string, compact = false): string {
  const number = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: compact ? 1 : 2,
    ...(compact ? { notation: "compact" as const } : {}),
  }).format(value);
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
 * A chart's data as a table: its labels, then a column for each series (a
 * pie's share of the whole after its values), or a scatter chart's points. As
 * the page writes the figures, or `raw`, for a spreadsheet: each as Aldo sent
 * it, its unit in the column's name.
 */
export function chartTable(chart: AldoChartArtifact, raw = false): Omit<AldoTableArtifact, "kind"> {
  const named = (name: string, unit?: string) => (raw && unit ? `${name} (${unit})` : name);
  const figure = (value: number, unit?: string) => (raw ? String(value) : formatValue(value, unit));
  if (chart.type === "scatter") {
    const several = chart.series.length > 1;
    const labelled = chart.series.some((s) => s.points?.some((p) => p.label));
    return {
      title: chart.title,
      columns: [
        ...(several ? ["Series"] : []),
        ...(labelled ? [""] : []),
        named(chart.xAxis || "x", chart.xUnit),
        named(chart.yAxis || "y", chart.unit),
      ],
      rows: chart.series.flatMap((s) =>
        (s.points ?? []).map((p) => [
          ...(several ? [s.name] : []),
          ...(labelled ? [p.label ?? ""] : []),
          figure(p.x, chart.xUnit),
          figure(p.y, chart.unit),
        ]),
      ),
    };
  }
  const pie = chart.type === "pie" || chart.type === "donut";
  const total = pie ? chart.series[0]!.values.reduce((sum, v) => sum + v, 0) : 0;
  const share = (value: number) => {
    const percent = total ? (value / total) * 100 : 0;
    return raw ? String(Math.round(percent * 100) / 100) : `${formatValue(percent)}%`;
  };
  return {
    title: chart.title,
    columns: [
      "",
      ...chart.series.map((s) => named(s.name || "Value", chart.unit)),
      ...(pie ? [named("Share", "%")] : []),
    ],
    rows: chart.labels.map((label, i) => [
      label,
      ...chart.series.map((s) => figure(s.values[i]!, chart.unit)),
      ...(pie ? [share(chart.series[0]!.values[i]!)] : []),
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
