import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { aldoPageInUseNow, noteAldoPageUse } from "./pageUse";

let focused = true;
const doc = { visibilityState: "visible", hasFocus: () => focused };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  noteAldoPageUse();
  focused = true;
  doc.visibilityState = "visible";
  vi.stubGlobal("document", doc);
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
