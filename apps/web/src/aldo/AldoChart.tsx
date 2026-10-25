// A chart under a message of Aldo's, drawn here from its data
// (chart.logic.ts): bars across, columns, lines and areas (stacked or not),
// columns with lines, a pie or a donut, and points on two measures. Thin
// marks on one scale, the words in the page's own type, the width of the
// conversation at most. What isn't written beside a mark is a hover away (a
// tap or a drag, full screen), and every figure is in the table under it there.

import { Fragment, useEffect, useRef, useState, type PointerEvent } from "react";

import { cn } from "../lib/utils";
import { chartScale, formatValue, type AldoChartArtifact } from "./artifacts.logic";
import {
  arcPath,
  barPath,
  clipText,
  labelEvery,
  lineFromZero,
  niceScale,
  pieSlices,
  stack,
  stackEnd,
} from "./chart.logic";

/**
 * A chart's default colors, in order: Aldo Blue first, then hues spaced round
 * the wheel and told apart with any color vision, at middling lightness so
 * they hold on the card in light and dark. A chart without colors of its own
 * (a series' `color`, a pie's `colors`) takes these, so no series or slice
 * shares one (a chart has 6 series at most; a pie folds past these).
 */
export const SERIES = [
  "var(--primary)",
  "#e8743b",
  "#20a39e",
  "#d6336c",
  "#e0a100",
  "#7b5cd6",
  "#3f9f4a",
  "#da291c",
  "#3aa0e0",
  "#946c4a",
  "#94b520",
];
/** A series' color: the one it was given, else its place in the defaults. */
const seriesColor = (chart: AldoChartArtifact, j: number) =>
  chart.series[j]?.color ?? SERIES[j % SERIES.length]!;
/** What a pie folds past its colors into. */
const OTHER = "var(--muted-foreground)";
/** The bars a chart shows in place before its sheet: the rest is a tap away. */
export const PREVIEW_BARS = 8;
/** About how wide a character of a chart's 12px words is, to fit them. */
const CHAR = 6.6;

/** An element's width in pixels, kept current: a phone's until it's measured. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, Math.max(200, width)] as const;
}

function Swatch(props: { readonly color: string }) {
  return (
    <span
      aria-hidden
      className="h-2 w-3 shrink-0 rounded-full"
      style={{ background: props.color }}
    />
  );
}

export function ChartBody(props: {
  readonly chart: AldoChartArtifact;
  readonly all?: boolean | undefined;
}) {
  const { chart } = props;
  if (chart.type === "pie" || chart.type === "donut") return <Pie chart={chart} all={props.all} />;
  if (chart.type === "scatter") return <Scatter chart={chart} all={props.all} />;
  if (chart.type === "bar") return <Bars chart={chart} all={props.all} />;
  return <Plot chart={chart} all={props.all} />;
}

/** A chart's legend, when there's more than one series: color is never all that tells them apart. */
function Legend(props: { readonly chart: AldoChartArtifact }) {
  if (props.chart.series.length < 2) return null;
  return (
    <ul className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
      {props.chart.series.map((s, i) => (
        // oxlint-disable-next-line react/no-array-index-key -- Series are fixed once said, and may share a name.
        <li key={i} className="flex min-w-0 items-center gap-1.5">
          <Swatch color={seriesColor(props.chart, i)} />
          <span className="truncate">{s.name}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A bar chart as rows: a label, then a bar and its value for each series (or
 * one bar of them stacked, and its total). It runs down, never across, so
 * long labels and many bars fit any phone, and every value is written beside
 * its bar.
 */
function Bars(props: { readonly chart: AldoChartArtifact; readonly all?: boolean | undefined }) {
  const { chart } = props;
  const values = chart.series.map((s) => s.values);
  const segments = chart.stacked ? stack(values) : null;
  const { top, bottom } = chartScale(segments ? segments.flat(2) : values.flat());
  const at = (value: number) => ((value - bottom) / (top - bottom)) * 100;
  const labels = props.all ? chart.labels : chart.labels.slice(0, PREVIEW_BARS);
  // Every row's bar starts and ends at the same place, so bars compare: the labels' column fits
  // the longest (up to 40%), and the values' the widest.
  const shown = labels.map((_, i) =>
    segments
      ? [
          formatValue(
            values.reduce((sum, s) => sum + (s[i] ?? 0), 0),
            chart.unit,
          ),
        ]
      : chart.series.map((s) => formatValue(s.values[i] ?? 0, chart.unit)),
  );
  const widest = Math.max(...shown.flat().map((text) => text.length));
  const figure = (text: string) => (
    <span
      className="max-w-[45%] shrink-0 truncate text-right text-foreground tabular-nums"
      style={{ width: `${widest + 0.5}ch` }}
    >
      {text}
    </span>
  );
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Legend chart={chart} />
      <div
        role="img"
        aria-label={chart.title}
        className="grid min-w-0 grid-cols-[fit-content(40%)_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 text-[13px]"
      >
        {labels.map((label, i) => (
          // oxlint-disable-next-line react/no-array-index-key -- Labels are fixed once said, and may repeat.
          <Fragment key={i}>
            <span className="truncate text-muted-foreground">{label}</span>
            {segments ? (
              <span className="flex min-w-0 items-center gap-2">
                <span className="relative h-2.5 min-w-0 flex-1">
                  {segments.map((series, j) => {
                    const [from, to] = series[i]!;
                    if (from === to) return null;
                    const end = stackEnd(values, j, i);
                    return (
                      <span
                        // oxlint-disable-next-line react/no-array-index-key -- As above.
                        key={j}
                        className={cn(
                          "absolute inset-y-0",
                          end && (to > from ? "rounded-e-full" : "rounded-s-full"),
                        )}
                        style={{
                          left: `${Math.min(at(from), at(to))}%`,
                          // Apart from the next by a gap of the card's own color.
                          width: `calc(${Math.abs(at(to) - at(from))}% - ${end ? 0 : 2}px)`,
                          ...(to < from && !end ? { marginLeft: 2 } : {}),
                          background: seriesColor(chart, j),
                        }}
                      />
                    );
                  })}
                </span>
                {figure(shown[i]![0]!)}
              </span>
            ) : (
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
                            background: seriesColor(chart, j),
                          }}
                        />
                      </span>
                      {figure(shown[i]![j]!)}
                    </span>
                  );
                })}
              </span>
            )}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/** A scale's ticks as lines across the plot, each written at its left; zero a little stronger when the scale goes below it. */
function Grid(props: {
  readonly ticks: ReadonlyArray<number>;
  readonly y: (value: number) => number;
  readonly left: number;
  readonly right: number;
  readonly unit?: string | undefined;
}) {
  return props.ticks.map((tick) => (
    <g key={tick}>
      <line
        x1={props.left}
        x2={props.right}
        y1={props.y(tick)}
        y2={props.y(tick)}
        stroke="currentColor"
        strokeOpacity={tick === 0 && props.ticks[0]! < 0 ? 0.35 : 0.12}
      />
      <text x={props.left - 6} y={props.y(tick) + 4} textAnchor="end" fill="currentColor">
        {formatValue(tick, props.unit, true)}
      </text>
    </g>
  ));
}

/** The room a scale's written ticks need at the plot's left. */
const gutter = (ticks: ReadonlyArray<number>, width: number, unit?: string) =>
  Math.min(
    width * 0.3,
    Math.max(...ticks.map((t) => formatValue(t, unit, true).length)) * CHAR + 10,
  );

/**
 * Columns, lines and areas over a chart's labels, on one scale from zero (a
 * line's from near its values when they sit well above it). What's written
 * over it is the latest label's figures, or those under the pointer.
 */
function Plot(props: { readonly chart: AldoChartArtifact; readonly all?: boolean | undefined }) {
  const { chart } = props;
  const [ref, width] = useWidth();
  const [focus, setFocus] = useState<number | null>(null);
  const height = props.all ? 260 : 176;
  const n = chart.labels.length;
  const values = chart.series.map((s) => s.values);
  const marks = chart.series.map((s) =>
    chart.type === "combo" ? (s.mark ?? "column") : chart.type === "line" ? "line" : chart.type,
  );
  const segments = chart.stacked ? stack(values) : null;
  const all = segments ? segments.flat(2) : values.flat();
  const scale = niceScale(all, chart.type !== "line" || lineFromZero(all));
  const left = gutter(scale.ticks, width, chart.unit);
  const [top, bottom, right] = [8, 22, width - 10];
  const plot = right - left;
  const banded = marks.includes("column");
  const band = plot / n;
  const x = (i: number) =>
    banded ? left + (i + 0.5) * band : left + (n === 1 ? plot / 2 : (i / (n - 1)) * plot);
  const y = (v: number) =>
    top + ((scale.top - v) / (scale.top - scale.bottom)) * (height - top - bottom);
  const base = y(Math.max(scale.bottom, Math.min(0, scale.top)));
  const span = (j: number, i: number): [number, number] =>
    segments ? segments[j]![i]! : [0, values[j]![i]!];
  const columns = chart.series.flatMap((_, j) => (marks[j] === "column" ? [j] : []));
  const k = segments ? 1 : columns.length;
  const group = Math.min(band * 0.72, k * 24 + (k - 1) * 2);
  const thick = (group - (k - 1) * 2) / Math.max(1, k);
  // The latest label is always written, and as many before it as fit.
  const every = labelEvery(
    n,
    plot,
    Math.min(72, Math.max(...chart.labels.map((l) => l.length)) * CHAR + 14),
  );
  const chars = Math.max(3, Math.floor((every * plot) / n / CHAR) - 1);
  const shown = focus ?? n - 1;
  const point = (event: PointerEvent<SVGSVGElement>) => {
    const at = event.clientX - event.currentTarget.getBoundingClientRect().left - left;
    const i = banded ? Math.floor(at / band) : Math.round((at / plot) * (n - 1));
    setFocus(Math.max(0, Math.min(n - 1, i)));
  };
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="flex min-h-5 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
        <span className="max-w-full truncate">{chart.labels[shown]}</span>
        {chart.series.map((s, j) => (
          // oxlint-disable-next-line react/no-array-index-key -- Series are fixed once said, and may share a name.
          <span key={j} className="flex min-w-0 items-center gap-1.5">
            <Swatch color={seriesColor(chart, j)} />
            {chart.series.length > 1 ? <span className="truncate">{s.name}</span> : null}
            <span className="shrink-0 text-foreground tabular-nums">
              {formatValue(s.values[shown] ?? 0, chart.unit)}
            </span>
          </span>
        ))}
      </p>
      <div ref={ref} className="min-w-0">
        <svg
          role="img"
          aria-label={chart.title}
          width={width}
          height={height}
          className="block touch-pan-y select-none overflow-visible text-[12px] text-muted-foreground tabular-nums"
          onPointerMove={point}
          onPointerDown={point}
          onPointerLeave={() => setFocus(null)}
        >
          <Grid ticks={scale.ticks} y={y} left={left} right={right} unit={chart.unit} />
          {chart.labels.map((label, i) =>
            (n - 1 - i) % every === 0 ? (
              <text
                // oxlint-disable-next-line react/no-array-index-key -- Labels are fixed once said, and may repeat.
                key={i}
                x={x(i)}
                y={height - 6}
                fill="currentColor"
                // A line's first and last labels sit inside its ends.
                textAnchor={
                  banded || n === 1 ? "middle" : i === 0 ? "start" : i === n - 1 ? "end" : "middle"
                }
              >
                {clipText(label, chars)}
              </text>
            ) : null,
          )}
          {focus !== null ? (
            <line
              x1={x(focus)}
              x2={x(focus)}
              y1={top}
              y2={height - bottom}
              stroke="currentColor"
              strokeOpacity={0.3}
            />
          ) : null}
          {columns.map((j, p) =>
            chart.labels.map((_, i) => {
              const [from, to] = span(j, i);
              if (from === to) return null;
              let [start, end] = [y(from), y(to)];
              const way = Math.sign(end - start);
              const tip = !segments || stackEnd(values, j, i);
              // Stacked, a segment is apart from the next by a gap of the card's own color.
              if (segments && Math.abs(end - start) > 2) {
                if (from !== 0) start += way;
                if (!tip) end -= way;
              }
              const at = x(i) - group / 2 + (segments ? 0 : p * (thick + 2));
              return (
                <path
                  // oxlint-disable-next-line react/no-array-index-key -- Fixed once said.
                  key={`${j}-${i}`}
                  d={barPath(true, at, thick, start, end, tip ? 4 : 0)}
                  fill={seriesColor(chart, j)}
                />
              );
            }),
          )}
          {chart.series.map((_, j) => {
            if (marks[j] === "column") return null;
            const tops = chart.labels.map((__, i) => `${x(i)},${y(span(j, i)[1])}`);
            const floor = chart.labels
              .map((__, i) => `${x(i)},${segments ? y(span(j, i)[0]) : base}`)
              .toReversed();
            return (
              // oxlint-disable-next-line react/no-array-index-key -- Fixed once said.
              <g key={j}>
                {marks[j] === "area" ? (
                  <polygon
                    points={[...tops, ...floor].join(" ")}
                    fill={seriesColor(chart, j)}
                    fillOpacity={segments ? 0.28 : 0.12}
                  />
                ) : null}
                <polyline
                  points={tops.join(" ")}
                  fill="none"
                  stroke={seriesColor(chart, j)}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                <circle
                  cx={x(shown)}
                  cy={y(span(j, shown)[1])}
                  r={4}
                  fill={seriesColor(chart, j)}
                  strokeWidth={2}
                  className="stroke-card"
                />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/**
 * Points on two measures, each on a scale of its own round numbers, named
 * over it (the vertical) and at its end (the horizontal). A few points with names have them written beside them; what a
 * point is and its figures are a hover away.
 */
function Scatter(props: { readonly chart: AldoChartArtifact; readonly all?: boolean | undefined }) {
  const { chart } = props;
  const [ref, width] = useWidth();
  const [focus, setFocus] = useState<number | null>(null);
  const height = props.all ? 300 : 208;
  const points = chart.series.flatMap((s, j) => (s.points ?? []).map((p) => ({ ...p, j })));
  const xs = niceScale(
    points.map((p) => p.x),
    false,
  );
  const ys = niceScale(
    points.map((p) => p.y),
    false,
  );
  const left = gutter(ys.ticks, width, chart.unit);
  const [top, bottom, right] = [8, chart.xAxis ? 40 : 22, width - 12];
  const x = (v: number) => left + ((v - xs.bottom) / (xs.top - xs.bottom)) * (right - left);
  const y = (v: number) => top + ((ys.top - v) / (ys.top - ys.bottom)) * (height - top - bottom);
  const named = points.length <= 12 && points.some((p) => p.label);
  const every = labelEvery(xs.ticks.length, right - left, 48);
  const near = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const [px, py] = [event.clientX - box.left, event.clientY - box.top];
    const distance = (p: (typeof points)[number]) => Math.hypot(x(p.x) - px, y(p.y) - py);
    const nearest = points.reduce(
      (best, p, i) => (distance(p) < distance(points[best]!) ? i : best),
      0,
    );
    setFocus(distance(points[nearest]!) <= 32 ? nearest : null);
  };
  const focused = focus === null ? null : points[focus];
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Legend chart={chart} />
      <p className="min-h-5 min-w-0 truncate text-[13px] text-muted-foreground">
        {focused ? (
          <>
            {focused.label ?? chart.series[focused.j]!.name}
            {" · "}
            <span className="text-foreground tabular-nums">
              {formatValue(focused.x, chart.xUnit)}, {formatValue(focused.y, chart.unit)}
            </span>
          </>
        ) : (
          chart.yAxis
        )}
      </p>
      <div ref={ref} className="min-w-0">
        <svg
          role="img"
          aria-label={chart.title}
          width={width}
          height={height}
          className="block touch-pan-y select-none overflow-visible text-[12px] text-muted-foreground tabular-nums"
          onPointerMove={near}
          onPointerDown={near}
          onPointerLeave={() => setFocus(null)}
        >
          <Grid ticks={ys.ticks} y={y} left={left} right={right} unit={chart.unit} />
          {xs.ticks.map((tick, i) =>
            i % every === 0 ? (
              <text
                key={tick}
                x={x(tick)}
                y={height - bottom + 16}
                textAnchor="middle"
                fill="currentColor"
              >
                {formatValue(tick, chart.xUnit, true)}
              </text>
            ) : null,
          )}
          {chart.xAxis ? (
            <text x={right} y={height - 4} textAnchor="end" fill="currentColor">
              {clipText(chart.xAxis, Math.floor((right - left) / CHAR))}
            </text>
          ) : null}
          {points.map((p, i) => (
            // oxlint-disable-next-line react/no-array-index-key -- Fixed once said.
            <g key={i}>
              <circle
                cx={x(p.x)}
                cy={y(p.y)}
                r={focus === i ? 6 : 4.5}
                fill={p.color ?? seriesColor(chart, p.j)}
                strokeWidth={2}
                className="stroke-card"
              />
              {named && p.label ? (
                <text
                  x={x(p.x) + (x(p.x) > right - 80 ? -8 : 8)}
                  y={y(p.y) + 4}
                  textAnchor={x(p.x) > right - 80 ? "end" : "start"}
                  fill="currentColor"
                >
                  {clipText(p.label, 14)}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

/**
 * A pie or a donut (its total in the middle): its slices in the order given,
 * the largest past its colors folded into Other, and beside it each one's
 * share, written, so no color has to be matched by eye.
 */
function Pie(props: { readonly chart: AldoChartArtifact; readonly all?: boolean | undefined }) {
  const { chart } = props;
  const values = chart.series[0]!.values;
  const slices = pieSlices(chart.labels, values, SERIES.length);
  const own = chart.series[0]!.colors;
  const total = values.reduce((sum, v) => sum + v, 0);
  const donut = chart.type === "donut";
  const colorOf = (slice: (typeof slices)[number]) =>
    slice.color === null ? OTHER : own?.[slice.index] || SERIES[slice.color]!;
  return (
    <div role="img" aria-label={chart.title} className="flex min-w-0 items-center gap-4">
      <div className={cn("relative shrink-0", props.all ? "size-44" : "size-32 sm:size-36")}>
        <svg viewBox="-1.02 -1.02 2.04 2.04" aria-hidden className="size-full">
          {slices.map((slice, i) => (
            <path
              // oxlint-disable-next-line react/no-array-index-key -- Fixed once said.
              key={i}
              d={arcPath(slice.from, slice.to, donut ? 0.62 : 0)}
              fill={colorOf(slice)}
              fillRule="evenodd"
              // Apart from the next by a gap of the card's own color.
              strokeWidth={slices.length > 1 ? 2 : 0}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              className="stroke-card"
            />
          ))}
        </svg>
        {donut ? (
          <span className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-medium text-[15px] text-foreground">
              {formatValue(total, chart.unit, true)}
            </span>
            <span className="text-[11px] text-muted-foreground">Total</span>
          </span>
        ) : null}
      </div>
      <ul className="flex min-w-0 flex-1 flex-col gap-1.5 text-[13px]">
        {slices.map((slice, i) => (
          // oxlint-disable-next-line react/no-array-index-key -- Fixed once said, and may repeat.
          <li key={i} className="flex min-w-0 items-center gap-2">
            <Swatch color={colorOf(slice)} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{slice.label}</span>
            {props.all ? (
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {formatValue(slice.value, chart.unit)}
              </span>
            ) : null}
            <span className="w-[5ch] shrink-0 text-right text-foreground tabular-nums">
              {formatValue(Math.round(slice.share * 1000) / 10)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
