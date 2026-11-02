// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { AldoComputer } from "./computer.logic";
import type { AldoHome, AldoHomeConversation } from "./homeApi";

const fixture = vi.hoisted(() => ({
  environments: [] as { environmentId: string; computers: AldoComputer[] }[],
  home: null as AldoHome | null,
  stop: vi.fn<(environmentId: string, kind: string) => Promise<string>>(),
}));
vi.mock("./directory", () => ({
  getAldoEnvironments: () => fixture.environments,
  subscribeAldoEnvironments: () => () => {},
  requestAldoDirectoryRefresh: () => {},
}));
vi.mock("./workspaceApi", () => ({
  stopAldoComputer: fixture.stop,
  answerAldoComputer: vi.fn(),
}));
vi.mock("../components/ui/toast", () => ({
  toastManager: { add: vi.fn() },
}));
vi.mock("./homeFeed", () => ({
  useAldoHomeFeed: (select: (s: { home: AldoHome | null }) => unknown) =>
    select({ home: fixture.home }),
  useAldoHomeReadAt: (select: (s: { at: number }) => unknown) => select({ at: Date.now() }),
  refreshAldoHome: vi.fn(),
}));
vi.mock("./liveWork", () => ({ useAldoLiveWork: () => null, useAldoLiveNow: () => Date.now() }));
vi.mock("./AldoContinue", () => ({ ContinueButton: () => null }));
vi.mock("./AldoHomeBoard", () => ({ mergeFollowedPullRequest: vi.fn(), TONE_VARIANT: {} }));
vi.mock("./AldoHomeInbox", () => ({
  ThreadLink: ({ children }: { children: ReactNode }) => <a href="#thread">{children}</a>,
}));
vi.mock("./AldoLiveView", () => ({ AldoLiveView: () => null }));

const { AldoGpuComputerControl } = await import("./AldoComputer");
const { AldoThreadCard } = await import("./AldoLiveCard");
let root: Root;
let host: HTMLDivElement;
const target = { environmentId: "aldo-queue", threadId: "queue" };
const gpu = (position: number): AldoComputer => ({
  kind: "gpu",
  status: "queued",
  position,
  why: null,
  error: null,
  creditsPerHour: 310,
});
const conversation = (position?: number): AldoHomeConversation => ({
  ref: "queue",
  thread: target,
  title: "Render the deck",
  repos: [],
  branch: "main",
  state: "done",
  machine: "asleep",
  at: new Date().toISOString(),
  computers:
    position === undefined
      ? []
      : [{ computer: "gpu", status: "queued", position, creditsPerHour: 310 }],
});
function home(position?: number) {
  fixture.home = {
    conversations: [conversation(position)],
    pullRequests: [],
    upcoming: [],
  } as unknown as AldoHome;
}
const showGpu = () =>
  act(() => root.render(<AldoGpuComputerControl environmentId={target.environmentId} />));
const showCard = () =>
  act(() => root.render(<AldoThreadCard target={target} label="Started" fallback="Loading" />));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.environments = [{ environmentId: target.environmentId, computers: [gpu(2)] }];
  fixture.stop.mockReset();
  home(2);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

it("keeps the GPU header quiet, updates its queue position, and cancels the request", async () => {
  await showGpu();
  expect(host.textContent).toContain("Waiting for GPU · position 2");
  expect(host.querySelector('[class*="animate-"]')).toBeNull();
  fixture.environments = [{ environmentId: target.environmentId, computers: [gpu(1)] }];
  await showGpu();
  const trigger = host.querySelector<HTMLButtonElement>(
    'button[aria-label="Waiting for GPU · position 1"]',
  )!;
  await act(() => trigger.click());
  expect(document.body.textContent).not.toContain("Your GPU computer is starting");
  const cancel = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) =>
    el.textContent?.includes("Cancel request"),
  )!;
  let finish!: (message: string) => void;
  fixture.stop.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(() => cancel.click());
  expect(fixture.stop).toHaveBeenCalledExactlyOnceWith(target.environmentId, "gpu");
  fixture.environments = [];
  await act(async () => {
    finish("Canceled the request for the GPU computer.");
  });
  await showGpu();
  expect(host.textContent).toBe("");
});

it("keeps a done conversation's queued card expandable until its request clears", async () => {
  await showCard();
  expect(host.textContent).toContain("Waiting for GPU · position 2");
  expect(host.textContent).not.toContain("Finished");
  await act(() => host.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click());
  expect(host.textContent).toContain("It carries on automatically when the computer is ready.");
  home(1);
  await showCard();
  expect(host.textContent).toContain("Waiting for GPU · position 1");
  home();
  await showCard();
  expect(host.textContent).toContain("Finished");
});
