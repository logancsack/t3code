import { expect, it } from "vite-plus/test";

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

it("puts a scale on round ticks, from zero for bars and near the values for a line well above it", () => {
  expect(niceScale([3, 7.2], true)).toEqual({ bottom: 0, top: 8, ticks: [0, 2, 4, 6, 8] });
  expect(niceScale([-12, 30], true)).toEqual({ bottom: -20, top: 40, ticks: [-20, 0, 20, 40] });
  expect(niceScale([181, 199], false)).toEqual({
    bottom: 180,
    top: 200,
    ticks: [180, 185, 190, 195, 200],
  });
  expect(niceScale([0.1, 0.3], true).ticks).toEqual([0, 0.1, 0.2, 0.3]);
  // Nothing to tell apart: still a scale.
  expect(niceScale([0, 0], true)).toMatchObject({ bottom: 0, top: 1 });
  expect(niceScale([50], false).ticks.length).toBeGreaterThan(1);
  expect(lineFromZero([181, 199])).toBe(false);
  expect(lineFromZero([20, 199])).toBe(true);
  expect(lineFromZero([-5, 10])).toBe(true);
});

it("stacks positive values up from zero and negative ones down from it", () => {
  const series = [
    [10, -5],
    [20, 3],
    [-4, -6],
  ];
  expect(stack(series)).toEqual([
    [
      [0, 10],
      [0, -5],
    ],
    [
      [10, 30],
      [0, 3],
    ],
    [
      [0, -4],
      [-5, -11],
    ],
  ]);
  expect(stackEnd(series, 1, 0)).toBe(true);
  expect(stackEnd(series, 0, 0)).toBe(false);
  expect(stackEnd(series, 0, 1)).toBe(false);
  expect(stackEnd(series, 2, 1)).toBe(true);
});

it("slices a pie in the order given, folding the smallest past its colors into Other", () => {
  const few = pieSlices(["A", "B"], [1, 3], 6);
  expect(few.map((s) => [s.label, s.share, s.color, s.from, s.to])).toEqual([
    ["A", 0.25, 0, 0, 0.25],
    ["B", 0.75, 1, 0.25, 1],
  ]);
  const labels = ["a", "b", "c", "d", "e"];
  const many = pieSlices(labels, [5, 1, 4, 2, 3], 3);
  expect(many.map((s) => [s.label, s.value, s.color, s.index])).toEqual([
    ["a", 5, 0, 0],
    ["c", 4, 1, 2],
    ["e", 3, 2, 4],
    ["Other", 3, null, -1],
  ]);
  // One more than its colors needs no Other: it has a color of its own.
  expect(pieSlices(labels.slice(0, 4), [1, 1, 1, 1], 3).map((s) => s.label)).toEqual([
    "a",
    "b",
    "c",
    "d",
  ]);
  expect(pieSlices(["a"], [0], 3)).toEqual([]);
});

it("draws a slice, a ring's slice and a whole circle", () => {
  expect(arcPath(0, 0.25)).toBe("M 0 -1 A 1 1 0 0 1 1 0 L 0 0 Z");
  expect(arcPath(0, 0.75, 0.5)).toBe("M 0 -1 A 1 1 0 1 1 -1 0 L -0.5 0 A 0.5 0.5 0 1 0 0 -0.5 Z");
  expect(arcPath(0, 1)).toBe("M 0 -1 A 1 1 0 1 1 0 1 A 1 1 0 1 1 0 -1 Z");
});

it("rounds a bar's end and keeps its base square", () => {
  // A column 10 wide rising from 100 to 60.
  expect(barPath(true, 0, 10, 100, 60, 4)).toBe(
    "M 0 100 L 0 64 A 4 4 0 0 1 4 60 L 6 60 A 4 4 0 0 1 10 64 L 10 100 Z",
  );
  // Too short to round all the way: only as much as it's long.
  expect(barPath(false, 0, 10, 0, 2, 4)).toBe(
    "M 0 0 L 0 0 A 2 2 0 0 1 2 2 L 2 8 A 2 2 0 0 1 0 10 L 0 10 Z",
  );
  expect(barPath(true, 0, 10, 50, 50, 4)).toBe("M 0 50 L 0 50 L 10 50 L 10 50 Z");
});

it("writes as many labels as fit, cut to their room", () => {
  expect(labelEvery(5, 400)).toBe(1);
  expect(labelEvery(12, 280)).toBe(3);
  expect(clipText("Berkshire Hathaway", 9)).toBe("Berkshir…");
  expect(clipText("Q1", 9)).toBe("Q1");
});
