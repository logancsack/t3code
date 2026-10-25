import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { aldoPageInUseNow, aldoPageUsedAt, noteAldoPageUse, onAldoPageUse } from "./pageUse";

let focused = true;
const doc = {
  visibilityState: "visible",
  hasFocus: () => focused,
  addEventListener: vi.fn(),
};
/** The page's own events, as pageUse.ts listens for them. */
const page = new EventTarget();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  noteAldoPageUse();
  focused = true;
  doc.visibilityState = "visible";
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", page);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("is in use while visible, focused and used in the last five minutes, which Home's read says", () => {
  expect(aldoPageInUseNow()).toBe(true);
  focused = false;
  expect(aldoPageInUseNow()).toBe(false);
  focused = true;
  doc.visibilityState = "hidden";
  expect(aldoPageInUseNow()).toBe(false);
  doc.visibilityState = "visible";
  vi.advanceTimersByTime(5 * 60_000);
  expect(aldoPageInUseNow()).toBe(false);
  noteAldoPageUse();
  expect(aldoPageInUseNow()).toBe(true);
});

it("hears the page used wherever it opened, without a thread on screen, and says when it was used before", () => {
  const heard: number[] = [];
  onAldoPageUse((before) => heard.push(before));
  vi.advanceTimersByTime(60_000);
  page.dispatchEvent(new Event("keydown"));
  expect(aldoPageUsedAt()).toBe(1_060_000);
  expect(heard).toEqual([1_000_000]);
  vi.advanceTimersByTime(6 * 60_000);
  page.dispatchEvent(new Event("pointerdown"));
  expect(aldoPageInUseNow()).toBe(true);
  expect(heard).toEqual([1_000_000, 1_060_000]);
});
