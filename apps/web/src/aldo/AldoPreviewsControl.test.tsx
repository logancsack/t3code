// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { ThreadId } from "@t3tools/contracts";
import type { AldoPreviews } from "./workspaceApi";

const mocks = vi.hoisted(() => ({
  previews: vi.fn(),
  browser: vi.fn(),
  takeover: vi.fn(),
  home: { conversations: [] as unknown[], handoffs: [] as unknown[] },
}));
vi.mock("./workspaceApi", () => ({
  fetchAldoPreviews: mocks.previews,
  fetchAldoPullRequests: async () => [],
  fetchAldoCost: async () => null,
  aldoPreviewUrl: (id: string, port: number) => `/p/${id}/${port}`,
  mergeAldoPullRequest: vi.fn(),
  stopAldoFollowThrough: vi.fn(),
}));
vi.mock("./AldoComputer", () => ({
  AldoGpuComputerControl: () => null,
  useAldoComputerAsk: () => {},
}));
vi.mock("./AldoMachine", () => ({
  AldoMachineMenuSection: () => <span>Computer tools</span>,
  useAldoMachineOffer: () => {},
}));
vi.mock("./homeFeed", () => ({ useAldoHomeRead: () => ({ home: mocks.home }) }));
vi.mock("./AldoHandoffCard", () => ({ openAldoHandoffTakeover: mocks.takeover }));
import { AldoPreviewsControl } from "./AldoPreviewsControl";
import { AldoBrowsingChip } from "./AldoBrowsingChip";
import { useAldoBrowserRequests } from "./browserStore";

let root: Root;
let container: HTMLDivElement;
const port = (n: number) => ({ port: n, command: "next dev", process: "node" });
const data = (ports: number[], running = true): AldoPreviews => ({
  running,
  ports: ports.map(port),
  services: [],
});
const preview = () => container.querySelector<HTMLButtonElement>('button[aria-label^="Preview"]');
async function render(id = "one") {
  await act(() =>
    root.render(
      <>
        <AldoBrowsingChip
          environmentId={id}
          threadId={"thread" as ThreadId}
          onOpenBrowser={mocks.browser}
        />
        <AldoPreviewsControl
          environmentId={id}
          threadId={"thread" as ThreadId}
          onOpenBrowser={mocks.browser}
        >
          {(controls) => (
            <>
              {controls.preview}
              {controls.tools}
            </>
          )}
        </AldoPreviewsControl>
      </>,
    ),
  );
}
async function click(label: string) {
  const el = [...document.querySelectorAll<HTMLElement>('button,[role="menuitem"]')].find(
    (e) => e.textContent?.trim() === label || e.getAttribute("aria-label") === label,
  );
  expect(el, label).toBeTruthy();
  await act(() => el!.click());
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  mocks.previews.mockReset().mockResolvedValue(data([]));
  mocks.browser.mockClear();
  mocks.takeover.mockClear();
  mocks.home = { conversations: [], handoffs: [] };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each([
  data([]),
  data([], false),
  {
    ...data([]),
    services: [{ name: "web", running: false, command: "next dev", cwd: "/", restarts: 1 }],
  },
])(
  "hides empty, asleep and starting/stopped servers while keeping browser/tools",
  async (answer) => {
    mocks.previews.mockResolvedValue(answer);
    await render();
    expect(preview()).toBeNull();
    await click("Thread tools");
    expect(document.body.textContent).toContain("Computer tools");
    await click("Open agent browser");
    expect(mocks.browser).toHaveBeenCalledOnce();
  },
);
it("shows a labeled single-port control without a count and opens either destination", async () => {
  mocks.previews.mockResolvedValue(data([3000]));
  await render();
  expect(preview()?.textContent).toBe("Preview");
  await act(() => preview()!.click());
  expect(document.body.textContent).toContain("localhost:3000");
  await click("Open in the Browser panel");
  expect(useAldoBrowserRequests.getState().request?.url).toBe("http://localhost:3000");
  expect(mocks.browser).toHaveBeenCalledOnce();
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  await act(() => preview()!.click());
  await click("Open in a new tab");
  expect(open).toHaveBeenCalledWith("/p/one/3000", "_blank", "noopener");
  open.mockRestore();
});
it("lists several ports under one label and keeps a ready port usable when another service stopped", async () => {
  mocks.previews.mockResolvedValue({
    ...data([3000, 5173]),
    services: [{ name: "docs", running: false, command: "vite", cwd: "/", restarts: 1 }],
  });
  await render();
  expect(preview()?.textContent).toBe("Preview");
  await act(() => preview()!.click());
  expect(document.body.textContent).toContain("localhost:5173");
  expect(document.body.textContent).toContain("Not running: docs");
  const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter((e) =>
    e.textContent?.includes("Open in the Browser panel"),
  );
  await act(() => items[1]!.click());
  expect(useAldoBrowserRequests.getState().request?.url).toBe("http://localhost:5173");
});
it("discovers new ports and hides stopped ones on visible polling", async () => {
  await render();
  expect(preview()).toBeNull();
  mocks.previews.mockResolvedValue(data([3000]));
  await act(() => vi.advanceTimersByTimeAsync(15_000));
  expect(preview()).not.toBeNull();
  mocks.previews.mockResolvedValue(data([]));
  await act(() => vi.advanceTimersByTimeAsync(15_000));
  expect(preview()).toBeNull();
});
it("does not poll hidden tabs or overlap an in-flight request", async () => {
  mocks.previews.mockReturnValue(new Promise(() => {}));
  await render();
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(mocks.previews).toHaveBeenCalledOnce();
  mocks.previews.mockResolvedValue(data([]));
  await render("two");
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  const calls = mocks.previews.mock.calls.length;
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(mocks.previews).toHaveBeenCalledTimes(calls);
});
it("discards replies after switching threads, including leaving and returning", async () => {
  let resolve!: (v: AldoPreviews) => void;
  mocks.previews.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  await render();
  await render("two");
  await render("one");
  await act(() => resolve(data([9999])));
  expect(preview()).toBeNull();
});
it("hides an initial error, and marks last-known previews uncertain after a later failure", async () => {
  mocks.previews.mockRejectedValue(new Error("offline"));
  await render();
  expect(preview()).toBeNull();
  mocks.previews.mockResolvedValue(data([3000]));
  await act(() => window.dispatchEvent(new Event("focus")));
  mocks.previews.mockRejectedValue(new Error("offline"));
  await act(() => vi.advanceTimersByTimeAsync(15_000));
  expect(preview()?.getAttribute("aria-label")).toBe("Preview · status unavailable");
  await act(() => preview()!.click());
  expect(document.body.textContent).toContain("last known ports");
  mocks.previews.mockResolvedValue(data([]));
  await click("Retry");
  expect(preview()).toBeNull();
});
it("moves ordinary local/external browsing to tools and preserves direct takeover without a preview", async () => {
  mocks.home.conversations = [
    { thread: { environmentId: "one", threadId: "thread" }, browsing: { site: "localhost" } },
  ];
  await render();
  expect(container.textContent).not.toContain("On localhost");
  await click("Thread tools");
  await click("Agent browser · localhost");
  expect(mocks.browser).toHaveBeenCalledOnce();
  mocks.home.conversations = [
    { thread: { environmentId: "one", threadId: "thread" }, browsing: { site: "github.com" } },
  ];
  mocks.home.handoffs = [
    { id: "handoff", site: "github.com", thread: { environmentId: "one", threadId: "thread" } },
  ];
  mocks.home = { ...mocks.home };
  await render();
  const handoff = container.querySelector<HTMLButtonElement>('button[aria-label*="take over"]');
  expect(handoff).not.toBeNull();
  await act(() => handoff!.click());
  expect(mocks.takeover).toHaveBeenCalledWith("handoff", handoff);
});
