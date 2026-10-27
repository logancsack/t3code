// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

// Which views take frames (AldoLiveView.tsx): only on screen, with the page
// showing, and at most two small ones at once, the most recently shown.

const watching = new Set<string>();
vi.mock("./liveFrames", () => ({
  GPU_EVERY_MS: 5_000,
  aldoLiveFrames: (_surface: string, target: { threadId: string }) => ({
    watch: () => {
      watching.add(target.threadId);
      return () => watching.delete(target.threadId);
    },
  }),
}));

const { AldoLiveView } = await import("./AldoLiveView");

let root: Root;
let host: HTMLElement;
let observed: Array<{ element: Element; callback: IntersectionObserverCallback }> = [];

/** Shows the view `threadId` on screen or off it. */
function scroll(threadId: string, on: boolean): void {
  for (const { element, callback } of observed) {
    if (element.closest(`[data-thread="${threadId}"]`)) {
      act(() =>
        callback(
          [{ intersectionRatio: on ? 1 : 0 } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        ),
      );
    }
  }
}

function views(threads: readonly string[], open?: string): void {
  act(() =>
    root.render(
      <>
        {threads.map((threadId) => (
          <div key={threadId} data-thread={threadId}>
            <AldoLiveView
              target={{ environmentId: "env", threadId }}
              surface="browser"
              open={threadId === open}
              label="Its browser"
            />
          </div>
        ))}
      </>,
    ),
  );
}

beforeEach(() => {
  observed = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(readonly callback: IntersectionObserverCallback) {}
      observe(element: Element) {
        observed.push({ element, callback: this.callback });
      }
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  watching.clear();
});

it("takes frames for two small views at most, the last shown, and none off screen", () => {
  views(["a", "b", "c"]);
  expect([...watching]).toEqual([]);
  scroll("a", true);
  scroll("b", true);
  expect([...watching].sort()).toEqual(["a", "b"]);
  scroll("c", true);
  expect([...watching].sort()).toEqual(["b", "c"]);
  scroll("b", false);
  expect([...watching].sort()).toEqual(["c"]);
});

it("an opened view takes frames beside two small ones, and stops with the page hidden", () => {
  views(["a", "b", "c"], "c");
  for (const threadId of ["a", "b", "c"]) scroll(threadId, true);
  expect([...watching].sort()).toEqual(["a", "b", "c"]);
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect([...watching]).toEqual([]);
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect([...watching].sort()).toEqual(["a", "b", "c"]);
});
