// What a message of Aldo's shows under its words (artifacts.logic.ts): a
// picture, a recording that plays in place, a page, a file, a chart or a
// table, each the width of the conversation at most, so a phone never
// scrolls sideways. A tap opens it whole: a file in Aldo's viewer
// (AldoShareViewer.tsx), a chart or a table in a sheet with its data to save.
// A page runs only sandboxed, on an origin of its own: in place it's a
// picture of itself that takes no taps, and it runs for the user in the viewer.
// Loaded once a message has one (AldoAssistant.tsx), off the first screen.

import {
  DownloadIcon,
  FileArchiveIcon,
  FileIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileXIcon,
  GlobeIcon,
  Maximize2Icon,
  PresentationIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { MediaVideoPlayer } from "../components/media/MediaVideoPlayer";
import { Button } from "../components/ui/button";
import { Sheet, SheetPopup, SheetTitle } from "../components/ui/sheet";
import { cn } from "../lib/utils";
import {
  chartScale,
  chartTable,
  csvOf,
  downloadHref,
  fileNameOf,
  fileShape,
  formatValue,
  inlineSrc,
  type AldoArtifact,
  type AldoChartArtifact,
  type AldoFileArtifact,
  type AldoTableArtifact,
} from "./artifacts.logic";
import { chatVideoWidth, videoAspectRatio } from "./chatVideo.logic";
import { aldoShareKind, aldoShareViewable } from "./library.logic";
import { formatMailSize } from "./mail.logic";
import type { AldoMadeKind } from "./made.logic";
import { openAldoShare } from "./shareViewer";
import { FOCUS, ICON_BUTTON, SURFACE } from "./surface";
import { isNumberCell } from "./tableNumbers.logic";

/** A chart's series, in the brand's order (docs/brand.md): Aldo Blue, then red, then yellow, at full strength. */
const SERIES = ["var(--primary)", "#da291c", "#ffc72c"] as const;
/** What a chart or table shows in place before its sheet: the rest is a tap away. */
const PREVIEW = { bars: 8, rows: 6, columns: 4 } as const;
/** The tallest a picture shows in place, in rem. */
const TALLEST = 28;

const FILE_ICON: Partial<Record<AldoMadeKind, LucideIcon>> = {
  sheet: FileSpreadsheetIcon,
  document: FileTextIcon,
  pdf: FileTextIcon,
  deck: PresentationIcon,
  page: GlobeIcon,
  archive: FileArchiveIcon,
};

const TYPE_WORD: Partial<Record<AldoMadeKind, string>> = {
  sheet: "Spreadsheet",
  document: "Document",
  pdf: "PDF",
  deck: "Slides",
  page: "Page",
  archive: "Archive",
  audio: "Audio",
  image: "Picture",
  video: "Video",
};

const shareIdOf = (url: string) => /^\/s\/([A-Za-z0-9_-]+)$/.exec(url)?.[1] ?? null;
const origin = () => (typeof window === "undefined" ? "" : window.location.origin);

/** Opens a file in Aldo's viewer: the share's own link, so opening it there counts. */
function openFile(file: AldoFileArtifact): void {
  openAldoShare({
    id: shareIdOf(file.url),
    url: file.url,
    title: file.title,
    contentType: file.contentType,
    share: null,
  });
}

/** Saves words as a file, made here. */
function saveText(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function AldoArtifacts(props: { readonly artifacts: ReadonlyArray<AldoArtifact> }) {
  const pictures = props.artifacts.filter(
    (a): a is AldoFileArtifact => a.kind === "file" && fileShape(a.contentType) === "image",
  );
  const rest = props.artifacts.filter((a) => !pictures.includes(a as AldoFileArtifact));
  return (
    <div data-aldo-artifacts="" className="flex w-full min-w-0 max-w-full flex-col gap-2">
      {pictures.length === 1 ? <Picture file={pictures[0]!} /> : null}
      {pictures.length > 1 ? (
        <div className="grid w-full min-w-0 grid-cols-2 gap-1.5">
          {pictures.map((file) => (
            <Picture key={file.url} file={file} square />
          ))}
        </div>
      ) : null}
      {rest.map((artifact, index) =>
        artifact.kind === "chart" ? (
          // oxlint-disable-next-line react/no-array-index-key -- A message's artifacts never change once it's said.
          <Chart key={index} chart={artifact} />
        ) : artifact.kind === "table" ? (
          // oxlint-disable-next-line react/no-array-index-key -- As above.
          <Table key={index} table={artifact} />
        ) : (
          <File key={artifact.url} file={artifact} />
        ),
      )}
    </div>
  );
}

/**
 * What's said in place of a file that won't load: unshared, its thread
 * deleted, or Aldo out of reach for a moment. A file never waits on its
 * thread's machine, so it doesn't say that.
 */
function Unavailable(props: { readonly file: AldoFileArtifact; readonly onRetry: () => void }) {
  const kind = aldoShareKind(props.file.contentType);
  return (
    <div role="status" className={cn(SURFACE, "flex min-w-0 items-center gap-3 p-3")}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.05] text-muted-foreground dark:bg-white/[0.06]">
        <FileXIcon aria-hidden className="size-5" strokeWidth={1.75} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] text-foreground">{props.file.title}</span>
        <span className="truncate text-[13px] text-muted-foreground">
          {[kind ? TYPE_WORD[kind] : null, "Unavailable right now"].filter(Boolean).join(" · ")}
        </span>
      </span>
      <Button size="sm" variant="outline" onClick={props.onRetry}>
        Retry
      </Button>
    </div>
  );
}

/** A picture: a slot that waits at 4:3, then takes its own shape (not too tall); in a grid, a square. */
function Picture(props: { readonly file: AldoFileArtifact; readonly square?: boolean }) {
  const { file } = props;
  const [ratio, setRatio] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  if (failed) return <Unavailable file={file} onRetry={() => setFailed(false)} />;
  const shape = props.square ? 1 : Math.min(2.4, Math.max(0.5, ratio ?? 4 / 3));
  const size: CSSProperties = props.square
    ? { aspectRatio: "1" }
    : {
        aspectRatio: String(shape),
        width: `min(100%, ${Math.round(TALLEST * shape * 100) / 100}rem)`,
      };
  return (
    <button
      type="button"
      onClick={() => openFile(file)}
      aria-label={`Open ${file.title}`}
      className={cn(
        "relative block min-w-0 max-w-full overflow-hidden rounded-[16px] border border-foreground/[0.07] bg-muted dark:border-white/[0.08]",
        FOCUS,
      )}
      style={size}
    >
      <img
        src={inlineSrc(file)}
        alt={file.title}
        loading="lazy"
        decoding="async"
        draggable={false}
        className={cn("size-full", props.square ? "object-cover" : "object-contain")}
        onLoad={(event) => {
          const { naturalWidth, naturalHeight } = event.currentTarget;
          if (naturalWidth > 0 && naturalHeight > 0) setRatio(naturalWidth / naturalHeight);
        }}
        onError={() => setFailed(true)}
      />
    </button>
  );
}

/** A file's title, and saving it, under what shows it. */
function Caption(props: { readonly file: AldoFileArtifact; readonly children?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-1 ps-1 text-[13px] text-muted-foreground">
      <span className="min-w-0 flex-1 truncate">{props.file.title}</span>
      {props.children}
      <a
        href={downloadHref(props.file.url, origin(), props.file.contentType)}
        // Named as /s/ names it, with its type's extension.
        download=""
        aria-label={`Save ${props.file.title}`}
        className={ICON_BUTTON}
      >
        <DownloadIcon className="size-4" />
      </a>
    </div>
  );
}

function File(props: { readonly file: AldoFileArtifact }) {
  const { file } = props;
  const shape = fileShape(file.contentType);
  if (shape === "video") return <Video file={file} />;
  if (shape === "page") return <Page file={file} />;
  if (shape === "audio") return <Audio file={file} />;
  return <Tile file={file} />;
}

function Audio(props: { readonly file: AldoFileArtifact }) {
  const { file } = props;
  const [failed, setFailed] = useState(false);
  if (failed) return <Unavailable file={file} onRetry={() => setFailed(false)} />;
  return (
    <div className={cn(SURFACE, "flex min-w-0 flex-col gap-2 p-3")}>
      <Caption file={file} />
      <audio
        src={inlineSrc(file)}
        controls
        preload="metadata"
        className="w-full min-w-0"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

/** A recording, played in place at its own shape. */
function Video(props: { readonly file: AldoFileArtifact }) {
  const { file } = props;
  const [ratio, setRatio] = useState(16 / 9);
  const figure = useRef<HTMLElement>(null);
  // The player owns its <video>, and loadedmetadata doesn't bubble: catch it on the way down.
  useEffect(() => {
    const element = figure.current;
    if (!element) return;
    const measure = (event: Event) => {
      const found = event.target instanceof HTMLVideoElement && videoAspectRatio(event.target);
      if (found) setRatio(found);
    };
    element.addEventListener("loadedmetadata", measure, true);
    return () => element.removeEventListener("loadedmetadata", measure, true);
  }, []);
  const width = chatVideoWidth(ratio);
  return (
    <figure ref={figure} className="flex min-w-0 max-w-full flex-col gap-1">
      <MediaVideoPlayer
        src={inlineSrc(file)}
        label={file.title}
        style={{ width, "--aldo-video-aspect": String(ratio) } as CSSProperties}
        className="block max-w-full"
        videoClassName="block aspect-(--aldo-video-aspect) max-w-full rounded-[16px] border border-foreground/[0.07] bg-black dark:border-white/[0.08]"
        stateClassName="rounded-[16px]"
      />
      <figcaption className="min-w-0 max-w-full" style={{ width }}>
        <Caption file={file} />
      </figcaption>
    </figure>
  );
}

/**
 * A page, as a picture of itself: it loads lazily, sandboxed (an origin of
 * its own, scripts and nothing else: no forms, popups or the page's
 * navigation, no referrer), and takes no taps. A tap opens it for the user
 * in the viewer, sandboxed as its link serves it.
 */
function Page(props: { readonly file: AldoFileArtifact }) {
  const { file } = props;
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-1">
      <button
        type="button"
        onClick={() => openFile(file)}
        aria-label={`Open ${file.title}`}
        className={cn(
          "relative block aspect-[4/3] w-full min-w-0 overflow-hidden rounded-[16px] border border-foreground/[0.07] bg-white bg-clip-padding sm:aspect-[16/10] dark:border-white/[0.08]",
          FOCUS,
        )}
      >
        <iframe
          src={inlineSrc(file)}
          title={file.title}
          loading="lazy"
          tabIndex={-1}
          aria-hidden
          sandbox="allow-scripts"
          // It takes no taps, so it shows no scrollbar either.
          scrolling="no"
          referrerPolicy="no-referrer"
          className="pointer-events-none absolute inset-0 size-full border-0 bg-white"
        />
      </button>
      <Caption file={file}>
        <button
          type="button"
          onClick={() => openFile(file)}
          aria-label={`Open ${file.title}`}
          className={ICON_BUTTON}
        >
          <Maximize2Icon className="size-4" />
        </button>
      </Caption>
    </div>
  );
}

/** A file shown by what it is: a tap opens it in the viewer, or saves what a browser can't show. */
function Tile(props: { readonly file: AldoFileArtifact }) {
  const { file } = props;
  const kind = aldoShareKind(file.contentType);
  const { [kind ?? "image"]: Icon = FileIcon } = FILE_ICON;
  const meta = [kind ? TYPE_WORD[kind] : null, file.bytes ? formatMailSize(file.bytes) : null]
    .filter(Boolean)
    .join(" · ");
  const body = (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.05] text-muted-foreground dark:bg-white/[0.06]">
        <Icon aria-hidden className="size-5" strokeWidth={1.75} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] text-foreground">{file.title}</span>
        {meta ? <span className="truncate text-[13px] text-muted-foreground">{meta}</span> : null}
      </span>
    </>
  );
  const look = cn(SURFACE, FOCUS, "flex w-full min-w-0 items-center gap-3 p-3 text-left");
  return aldoShareViewable(file.contentType) ? (
    <button type="button" onClick={() => openFile(file)} className={look}>
      {body}
    </button>
  ) : (
    <a href={downloadHref(file.url, origin(), file.contentType)} download="" className={look}>
      {body}
      <DownloadIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </a>
  );
}

/** A chart or table's card: its title and a way to open it whole; a tap anywhere opens it too. */
function DataCard(props: {
  readonly title: string;
  readonly kind: "chart" | "table";
  readonly footer?: string | null;
  readonly sheet: ReactNode;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const expand = (
    <button
      type="button"
      aria-label={`Open ${props.title || `the ${props.kind}`} full screen`}
      className={cn(ICON_BUTTON, "-my-1.5 -me-1.5")}
      onClick={(event) => {
        event.stopPropagation();
        setOpen(true);
      }}
    >
      <Maximize2Icon className="size-4" />
    </button>
  );
  // The sheet is the card's sibling: a tap in it (its backdrop too) never reaches the card to open it again.
  return (
    <>
      <section
        className={cn(SURFACE, "flex w-full min-w-0 max-w-full cursor-pointer flex-col gap-3 p-4")}
        onClick={() => setOpen(true)}
      >
        {props.title ? (
          <header className="flex min-w-0 items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate font-medium text-[15px] text-foreground">
              {props.title}
            </h3>
            {expand}
          </header>
        ) : null}
        {props.children}
        {/* Untitled, its way to open it whole goes under it, by what's left out. */}
        {props.footer || !props.title ? (
          <footer className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
            <p className="min-w-0 flex-1 truncate">{props.footer}</p>
            {props.title ? null : expand}
          </footer>
        ) : null}
      </section>
      {open ? (
        <DataSheet
          title={props.title || (props.kind === "chart" ? "Chart" : "Table")}
          onClose={() => setOpen(false)}
        >
          {props.sheet}
        </DataSheet>
      ) : null}
    </>
  );
}

/** A chart's or table's whole data, full screen on a phone and beside the conversation on a wide screen. */
function DataSheet(props: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
    >
      <SheetPopup
        side="right"
        showCloseButton={false}
        className="w-full max-w-3xl pt-safe pb-safe max-sm:border-s-0"
      >
        {/* On a phone the sidebar's toggle floats over the sheet's corner: its title starts past it. */}
        <div className="flex items-center gap-2 border-border/60 border-b px-4 py-2 max-sm:ps-14">
          <SheetTitle className="min-w-0 flex-1 truncate font-semibold text-base">
            {props.title}
          </SheetTitle>
          <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={props.onClose}>
            <XIcon />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{props.children}</div>
      </SheetPopup>
    </Sheet>
  );
}

/** A whole table in the sheet: only it scrolls, its header and first column stay put, and it saves as CSV. */
function FullTable(
  props: Omit<AldoTableArtifact, "kind"> & { readonly chart?: AldoChartArtifact },
) {
  // A chart's saves its figures as they were sent, not as written here.
  const data = props.chart ? chartTable(props.chart, true) : props;
  return (
    <div className="flex flex-col gap-3 p-4">
      {props.chart ? <ChartBody chart={props.chart} all /> : null}
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            saveText(
              fileNameOf(props.title ?? "", "csv"),
              csvOf(data.columns, data.rows),
              "text/csv",
            )
          }
        >
          <DownloadIcon />
          Download CSV
        </Button>
      </div>
      <div className="max-h-[calc(100dvh-9rem)] overflow-auto rounded-xl border border-border/60">
        <table className="min-w-full border-separate border-spacing-0 text-[14px]">
          <thead>
            <tr>
              {props.columns.map((column, i) => (
                <th
                  // oxlint-disable-next-line react/no-array-index-key -- Columns are fixed once said, and may repeat.
                  key={i}
                  scope="col"
                  className={cn(
                    "sticky top-0 z-10 whitespace-nowrap border-border/60 border-b bg-muted px-3 py-2 text-left font-medium",
                    i === 0 && "left-0 z-20",
                  )}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row, r) => (
              // oxlint-disable-next-line react/no-array-index-key -- Rows are fixed once said, and may repeat.
              <tr key={r}>
                {row.map((cell, c) => (
                  <td
                    // oxlint-disable-next-line react/no-array-index-key -- As above.
                    key={c}
                    data-numeric={isNumberCell(cell) || undefined}
                    className={cn(
                      "max-w-80 border-border/40 border-b px-3 py-2 align-top tabular-nums",
                      c === 0 && "sticky left-0 bg-background font-medium",
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A table in place: the width of the conversation, its first few columns and rows, each cell cut to fit. */
function Table(props: { readonly table: AldoTableArtifact }) {
  const { table } = props;
  const columns = table.columns.slice(0, PREVIEW.columns);
  const rows = table.rows.slice(0, PREVIEW.rows);
  const more =
    table.columns.length > columns.length || table.rows.length > rows.length
      ? `All ${table.columns.length} columns · ${table.rows.length} ${table.rows.length === 1 ? "row" : "rows"}`
      : null;
  return (
    <DataCard title={table.title ?? ""} kind="table" footer={more} sheet={<FullTable {...table} />}>
      <table className="w-full min-w-0 table-fixed border-collapse text-[14px]">
        <thead>
          <tr>
            {columns.map((column, i) => (
              <th
                // oxlint-disable-next-line react/no-array-index-key -- Columns are fixed once said, and may repeat.
                key={i}
                scope="col"
                className={cn(
                  "truncate border-border/60 border-b pe-3 pb-1.5 text-left font-medium text-[13px] text-muted-foreground last:pe-0",
                  // What each row is about gets the room; the figures after it are short.
                  i === 0 && columns.length > 2 && "w-[38%]",
                )}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            // oxlint-disable-next-line react/no-array-index-key -- Rows are fixed once said, and may repeat.
            <tr key={r}>
              {row.slice(0, PREVIEW.columns).map((cell, c) => (
                <td
                  // oxlint-disable-next-line react/no-array-index-key -- As above.
                  key={c}
                  data-numeric={isNumberCell(cell) || undefined}
                  className="truncate border-border/40 border-b py-1.5 pe-3 tabular-nums last:pe-0"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </DataCard>
  );
}

function Chart(props: { readonly chart: AldoChartArtifact }) {
  const { chart } = props;
  const more =
    chart.type === "bar" && chart.labels.length > PREVIEW.bars
      ? `All ${chart.labels.length} in full screen`
      : null;
  return (
    <DataCard
      title={chart.title}
      kind="chart"
      footer={more}
      sheet={<FullTable {...chartTable(chart)} chart={chart} />}
    >
      <ChartBody chart={chart} />
    </DataCard>
  );
}

/** A chart's legend, when there's more than one series: color is never all that tells them apart. */
function Legend(props: { readonly chart: AldoChartArtifact }) {
  if (props.chart.series.length < 2) return null;
  return (
    <ul className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
      {props.chart.series.map((s, i) => (
        // oxlint-disable-next-line react/no-array-index-key -- Series are fixed once said, and may share a name.
        <li key={i} className="flex min-w-0 items-center gap-1.5">
          <span
            aria-hidden
            className="h-2 w-3 shrink-0 rounded-full"
            style={{ background: SERIES[i] }}
          />
          <span className="truncate">{s.name}</span>
        </li>
      ))}
    </ul>
  );
}

function ChartBody(props: {
  readonly chart: AldoChartArtifact;
  readonly all?: boolean | undefined;
}) {
  const { chart } = props;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Legend chart={chart} />
      {chart.type === "bar" ? <Bars chart={chart} all={props.all} /> : <Line chart={chart} />}
    </div>
  );
}

/**
 * A bar chart as rows: a label, then a bar and its value for each series. It
 * runs down, never across, so long labels and many bars fit any phone, and
 * every value is written beside its bar.
 */
function Bars(props: { readonly chart: AldoChartArtifact; readonly all?: boolean | undefined }) {
  const { chart } = props;
  const { top, bottom } = chartScale(chart.series.flatMap((s) => s.values));
  const at = (value: number) => ((value - bottom) / (top - bottom)) * 100;
  const labels = props.all ? chart.labels : chart.labels.slice(0, PREVIEW.bars);
  // Every row's bar starts and ends at the same place, so bars compare: the labels' column fits
  // the longest (up to 40%), and the values' the widest.
  const shown = labels.map((_, i) =>
    chart.series.map((s) => formatValue(s.values[i] ?? 0, chart.unit)),
  );
  const widest = Math.max(...shown.flat().map((text) => text.length));
  return (
    <div
      role="img"
      aria-label={chart.title}
      className="grid min-w-0 grid-cols-[fit-content(40%)_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 text-[13px]"
    >
      {labels.map((label, i) => (
        // oxlint-disable-next-line react/no-array-index-key -- Labels are fixed once said, and may repeat.
        <Fragment key={i}>
          <span className="truncate text-muted-foreground">{label}</span>
          <span className="flex min-w-0 flex-col gap-1">
            {chart.series.map((s, j) => {
              const value = s.values[i] ?? 0;
              return (
                // oxlint-disable-next-line react/no-array-index-key -- As above.
                <span key={j} className="flex min-w-0 items-center gap-2">
                  <span className="relative h-2.5 min-w-0 flex-1">
                    <span
                      className="absolute inset-y-0 rounded-full"
                      style={{
                        // From zero, rightward or (below it) leftward.
                        left: `${Math.min(at(0), at(value))}%`,
                        width: `${Math.abs(at(value) - at(0))}%`,
                        minWidth: value !== 0 ? 3 : 0,
                        background: SERIES[j],
                      }}
                    />
                  </span>
                  <span
                    className="max-w-[45%] shrink-0 truncate text-right text-foreground tabular-nums"
                    style={{ width: `${widest + 0.5}ch` }}
                  >
                    {shown[i]![j]}
                  </span>
                </span>
              );
            })}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

/**
 * A line chart: its lines stretch to the width while its words don't (they're
 * the page's own text, 12px on any screen), with the top of its scale, zero,
 * and its first, middle and last labels.
 */
function Line(props: { readonly chart: AldoChartArtifact }) {
  const { chart } = props;
  const values = chart.series.flatMap((s) => s.values);
  const { top, bottom } = chartScale(values);
  const n = chart.labels.length;
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => ((top - v) / (top - bottom)) * 100;
  const ticks = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
  return (
    <div
      role="img"
      aria-label={chart.title}
      className="flex min-w-0 flex-col gap-1.5 text-[12px] text-muted-foreground"
    >
      <div className="flex justify-between tabular-nums">
        <span>{formatValue(top, chart.unit)}</span>
      </div>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
        className="h-36 w-full overflow-visible sm:h-44"
      >
        {[0, 50, 100].map((at) => (
          <line
            key={at}
            x1="0"
            x2="100"
            y1={at}
            y2={at}
            stroke="currentColor"
            strokeOpacity={0.15}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {bottom < 0 ? (
          <line
            x1="0"
            x2="100"
            y1={y(0)}
            y2={y(0)}
            stroke="currentColor"
            strokeOpacity={0.35}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {chart.series.map((s, j) => (
          <polyline
            // oxlint-disable-next-line react/no-array-index-key -- Series are fixed once said.
            key={j}
            points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
            fill="none"
            stroke={SERIES[j]}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="flex justify-between tabular-nums">
        <span>{formatValue(bottom, chart.unit)}</span>
      </div>
      <div className="relative h-4 min-w-0">
        {ticks.map((i) => (
          <span
            key={i}
            className="absolute top-0 max-w-[33%] truncate"
            style={
              i === 0
                ? { left: 0 }
                : i === n - 1
                  ? { right: 0 }
                  : { left: `${x(i)}%`, transform: "translateX(-50%)" }
            }
          >
            {chart.labels[i]}
          </span>
        ))}
      </div>
    </div>
  );
}
