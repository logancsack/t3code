import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { useAfterPaint } from "./useAfterPaint";

type Target = { readonly id: string };
const sameId = (a: Target, b: Target) => a.id === b.id;

let renderer: ReactTestRenderer | null = null;
let shown: Target | null = null;
let visibility: DocumentVisibilityState = "visible";

function Probe({ value }: { value: Target }) {
  const current = useAfterPaint(value, null, sameId);
  useLayoutEffect(() => {
    shown = current;
  });
  return null;
}

function render(value: Target) {
  act(() => {
    if (renderer) renderer.update(<Probe value={value} />);
    else renderer = create(<Probe value={value} />);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  visibility = "visible";
  vi.stubGlobal("document", {
    get visibilityState() {
      return visibility;
    },
  });
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => setTimeout(run, 16));
  vi.stubGlobal("cancelAnimationFrame", (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
  shown = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("shows a value once the frame after it has painted, and the one before until then", () => {
  const first = { id: "a" };
  render(first);
  expect(shown).toBeNull();
  act(() => vi.advanceTimersByTime(16));
  expect(shown).toBeNull();
  act(() => vi.advanceTimersByTime(1));
  expect(shown).toBe(first);

  render({ id: "b" });
  expect(shown).toBe(first);
  act(() => vi.advanceTimersByTime(17));
  expect(shown).toEqual({ id: "b" });
});

it("keeps the value shown for an equal one, and skips one replaced before its frame", () => {
  const first = { id: "a" };
  render(first);
  act(() => vi.advanceTimersByTime(17));
  render({ id: "a" });
  expect(shown).toBe(first);
  act(() => vi.advanceTimersByTime(17));
  expect(shown).toBe(first);

  render({ id: "b" });
  act(() => vi.advanceTimersByTime(8));
  render({ id: "c" });
  act(() => vi.advanceTimersByTime(17));
  expect(shown).toEqual({ id: "c" });
});

it("shows a value at once while the page is hidden, since no frame paints", () => {
  visibility = "hidden";
  render({ id: "a" });
  expect(shown).toEqual({ id: "a" });
});
