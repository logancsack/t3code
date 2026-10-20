// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

const backend = vi.hoisted(() => ({ reads: 0, fail: true }));
vi.mock("./workspaceApi", () => ({
  fetchAldoShares: async () => {
    backend.reads += 1;
    if (backend.fail) throw new Error("Connection lost");
    return [{ id: "s1", title: "Page", url: "https://aldo.computer/s/s1", public: false }];
  },
}));

const { useAldoShareList } = await import("./shareList");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const seen = { value: undefined as unknown };
function Block() {
  const listed = useAldoShareList(["s1"]);
  useEffect(() => {
    seen.value = listed("s1");
  });
  return null;
}

it("reads the list again on its own after a read that failed", async () => {
  vi.useFakeTimers();
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Block />));
  expect(backend.reads).toBe(1);
  expect(seen.value).toBeNull();
  // Still failing: it waits longer each time.
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(backend.reads).toBe(2);
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(backend.reads).toBe(2);
  backend.fail = false;
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(backend.reads).toBe(3);
  expect(seen.value).toMatchObject({ id: "s1", public: false });
  // Read, it waits for focus or a new share again.
  await act(async () => vi.advanceTimersByTimeAsync(10 * 60_000));
  expect(backend.reads).toBe(3);
  act(() => root.unmount());
  vi.useRealTimers();
});
