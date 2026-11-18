// The geometry of the charts Aldo's messages draw (AldoChart.tsx): scales
// that end on round numbers, stacks, a pie's slices and the paths of each
// mark. Plain numbers in, plain numbers out, so it's all tested here.

/** A round step at or above `raw`: 1, 2, 2.5 or 5 times a power of ten. */
function niceStep(raw: number): number {
  const power = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((step) => step * power).find((step) => step >= raw * 0.999)!;
}

/**
 * A scale over `values`: round ticks, about `count` steps apart, from the
 * first at or below the smallest to the first at or above the largest, with
 * zero in it when `zero` (bars and areas grow from it).
 */
export function niceScale(
  values: ReadonlyArray<number>,
  zero: boolean,
  count = 4,
): { bottom: number; top: number; ticks: number[] } {
  let low = Math.min(...values, ...(zero ? [0] : []));
  let high = Math.max(...values, ...(zero ? [0] : []));
  if (!Number.isFinite(low) || !Number.isFinite(high)) [low, high] = [0, 1];
  if (low === high) {
    const pad = Math.abs(low) * 0.1 || 1;
    [low, high] = zero && low === 0 ? [0, 1] : [low - pad, high + pad];
    if (zero) [low, high] = [Math.min(0, low), Math.max(0, high)];
  }
  const step = niceStep((high - low) / count);
  const bottom = Math.floor(low / step + 1e-9) * step;
  const top = Math.ceil(high / step - 1e-9) * step;
  const ticks = Array.from({ length: Math.round((top - bottom) / step) + 1 }, (_, i) =>
    Number((bottom + i * step).toPrecision(12)),
  );
  return { bottom: ticks[0]!, top: ticks.at(-1)!, ticks };
}

/** Whether a line chart's scale starts at zero: unless its values sit well above it (a price, a weight), where zero would flatten them. */
export function lineFromZero(values: ReadonlyArray<number>): boolean {
  const low = Math.min(...values);
  return low <= 0 || low < Math.max(...values) / 2;
}

/**
 * Series stacked: each value's segment `[from, to]`, positive values up from
 * zero and negative ones down from it, in the series' order.
 */
export function stack(series: ReadonlyArray<ReadonlyArray<number>>): [number, number][][] {
  const up: number[] = [];
  const down: number[] = [];
  return series.map((values) =>
    values.map((value, i) => {
      const sums = value < 0 ? down : up;
      const from = sums[i] ?? 0;
      sums[i] = from + value;
      return [from, from + value];
    }),
  );
}

/** Whether a stacked segment is the end of its bar: no later series goes further the same way. */
export function stackEnd(
  series: ReadonlyArray<ReadonlyArray<number>>,
  index: number,
  i: number,
): boolean {
  const value = series[index]![i]!;
  return series.slice(index + 1).every((s) => Math.sign(s[i] ?? 0) !== Math.sign(value));
}

export interface PieSlice {
  readonly label: string;
  readonly value: number;
  /** Of the whole, 0 to 1. */
  readonly share: number;
  /** Its place among the labels, and its default color's in the series' order; null for Other. */
  readonly index: number;
  readonly color: number | null;
  /** Where it starts and ends, in turns clockwise from twelve o'clock. */
  readonly from: number;
  readonly to: number;
}

/**
 * A pie's slices, in the order given, as many as have colors: past that, the
 * largest keep theirs and the rest fold into Other, last.
 */
export function pieSlices(
  labels: ReadonlyArray<string>,
  values: ReadonlyArray<number>,
  colors: number,
): PieSlice[] {
  const total = values.reduce((sum, v) => sum + v, 0);
  if (total <= 0) return [];
  const kept =
    labels.length <= colors + 1
      ? labels.map((_, i) => i)
      : labels
          .map((_, i) => i)
          .toSorted((a, b) => values[b]! - values[a]!)
          .slice(0, colors)
          .toSorted((a, b) => a - b);
  const rest = values.reduce((sum, v, i) => (kept.includes(i) ? sum : sum + v), 0);
  const parts = [
    ...kept.map((i, n) => ({
      label: labels[i]!,
      value: values[i]!,
      index: i,
      color: n as number | null,
    })),
    ...(kept.length < labels.length
      ? [{ label: "Other", value: rest, index: -1, color: null }]
      : []),
  ];
  let at = 0;
  return parts.map((part) => {
    const share = part.value / total;
    const slice = { ...part, share, from: at, to: at + share };
    at += share;
    return slice;
  });
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * A slice's path on a circle of radius 1 at the origin, from `from` to `to`
 * turns; a ring's when `inner` is more than zero.
 */
export function arcPath(from: number, to: number, inner = 0): string {
  const point = (turns: number, r: number) => {
    const angle = turns * 2 * Math.PI - Math.PI / 2;
    return `${round(Math.cos(angle) * r)} ${round(Math.sin(angle) * r)}`;
  };
  // A whole circle as two halves: an arc can't start and end at one point.
  if (to - from >= 0.9999) {
    const ring = (r: number) =>
      r > 0
        ? `M ${point(0, r)} A ${r} ${r} 0 1 1 ${point(0.5, r)} A ${r} ${r} 0 1 1 ${point(0, r)} Z`
        : "";
    return `${ring(1)} ${ring(inner)}`.trim();
  }
  const large = to - from > 0.5 ? 1 : 0;
  const outer = `M ${point(from, 1)} A 1 1 0 ${large} 1 ${point(to, 1)}`;
  return inner > 0
    ? `${outer} L ${point(to, inner)} A ${inner} ${inner} 0 ${large} 0 ${point(from, inner)} Z`
    : `${outer} L 0 0 Z`;
}

/**
 * A bar's path from `base` to `end` (pixels, either way along its axis),
 * `width` across starting at `at`, its end rounded (`radius`) and its base
 * square; `vertical` for a column.
 */
export function barPath(
  vertical: boolean,
  at: number,
  width: number,
  base: number,
  end: number,
  radius: number,
): string {
  const length = Math.abs(end - base);
  const r = Math.max(0, Math.min(radius, width / 2, length));
  const dir = end >= base ? 1 : -1;
  // Along the bar (a), then across it (b); a column swaps them into x and y.
  const xy = (a: number, b: number) =>
    vertical ? `${round(b)} ${round(a)}` : `${round(a)} ${round(b)}`;
  const sweep = (vertical ? dir < 0 : dir > 0) ? 1 : 0;
  const tip = end - dir * r;
  return [
    `M ${xy(base, at)}`,
    `L ${xy(tip, at)}`,
    r ? `A ${r} ${r} 0 0 ${sweep} ${xy(end, at + r)}` : "",
    `L ${xy(end, at + width - r)}`,
    r ? `A ${r} ${r} 0 0 ${sweep} ${xy(tip, at + width)}` : "",
    `L ${xy(base, at + width)} Z`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Every how many labels one is written, so those written don't run into each other in `room` pixels. */
export function labelEvery(count: number, room: number, widest = 64): number {
  return Math.max(1, Math.ceil(count / Math.max(1, Math.floor(room / widest))));
}

/** Words cut to `chars` characters, an ellipsis showing where. */
export function clipText(text: string, chars: number): string {
  return text.length <= chars ? text : `${text.slice(0, Math.max(1, chars - 1)).trimEnd()}…`;
}
