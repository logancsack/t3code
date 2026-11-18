// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

// Which views take frames (AldoLiveView.tsx): only on screen, with the page
// showing, and at most two small ones at once, the most recently shown; and a
// view shows only its own surface's frames.

const watching = new Set<string>();
/** Each watch's way to send a frame, by thread and surface. */
const send = new Map<string, (frame: { url: string; at: number }) => void>();
vi.mock("./liveFrames", () => ({
  GPU_EVERY_MS: 5_000,
  aldoLiveFrames: (surface: string, target: { threadId: string }) => ({
    watch: (_options: unknown, onFrame: (frame: { url: string; at: number }) => void) => {
      watching.add(target.threadId);
      send.set(`${target.threadId} ${surface}`, onFrame);
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

function views(
  threads: readonly string[],
  open?: string,
  surface: "browser" | "windows" = "browser",
): void {
  act(() =>
    root.render(
      <>
        {threads.map((threadId) => (
          <div key={threadId} data-thread={threadId}>
            <AldoLiveView
              target={{ environmentId: "env", threadId }}
              surface={surface}
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
  send.clear();
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

it("shows a surface's own frames: none of the browser's once its work moves to the Windows computer", () => {
  views(["a"]);
  scroll("a", true);
  act(() => send.get("a browser")!({ url: "https://m/browser.jpg", at: Date.now() }));
  expect(host.querySelector("img")?.getAttribute("src")).toBe("https://m/browser.jpg");
  views(["a"], undefined, "windows");
  expect(host.querySelector("img")).toBeNull();
  // A still the browser's watch was taking as it stopped stays the browser's.
  act(() => send.get("a browser")!({ url: "https://m/late.jpg", at: Date.now() }));
  expect(host.querySelector("img")).toBeNull();
  act(() => send.get("a windows")!({ url: "https://m/windows.jpg", at: Date.now() }));
  expect(host.querySelector("img")?.getAttribute("src")).toBe("https://m/windows.jpg");
});
