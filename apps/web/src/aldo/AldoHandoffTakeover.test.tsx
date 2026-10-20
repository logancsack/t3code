// @vitest-environment jsdom

import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";

const read = vi.hoisted(() => ({
  handoff: {} as Record<string, unknown>,
  /** Aldo hasn't answered the read yet (a phone signed out gets sign-in instead). */
  pending: false,
  listeners: new Set<() => void>(),
}));
const signIn = {
  id: "h_test",
  threadTitle: "Needs you",
  kind: "sign_in",
  reason: "GitHub wants you to sign in",
  how: "Sign in to continue.",
  thread: { environmentId: "aldo-machine", threadId: "thread" },
};
vi.mock("./homeFeed", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => {
    read.listeners.add(listener);
    return () => read.listeners.delete(listener);
  };
  return {
    useAldoHomeRead: () =>
      useSyncExternalStore(subscribe, () => read.pending)
        ? { home: null, supported: undefined }
        : { home: { handoffs: [read.handoff] }, supported: true },
  };
});
vi.mock("./morph", () => ({
  aldoMorph: (update: () => void) => update(),
  aldoMorphSource: () => null,
}));
vi.mock("./AldoBrowserPanel", () => ({ AldoBrowserPanel: () => <div>Agent browser</div> }));

import { AldoHandoffTakeoverHost } from "./AldoHandoffTakeover";
import { closeAldoHandoffTakeover } from "./AldoHandoffCard";

let root: Root | undefined;
afterEach(async () => {
  await act(() => {
    closeAldoHandoffTakeover();
    root?.unmount();
  });
  root = undefined;
  read.pending = false;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

/** A screen that is (or isn't) a phone: narrow and touch. */
const screen = (phone: boolean) =>
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: phone,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));

it("reopens the same notification after closing its takeover, preserving other URL state", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  screen(false);
  read.handoff = signIn;
  const router = createRouter({
    routeTree: createRootRoute({ component: AldoHandoffTakeoverHost }),
    history: createMemoryHistory({ initialEntries: ["/?keep=yes#thread"] }),
    defaultPendingMinMs: 0,
  });
  await router.load();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root!.render(<RouterProvider router={router} />));

  const tap = () => act(() => router.navigate({ href: "/?keep=yes&handoff=h_test#thread" }));
  await tap();
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  expect(router.state.location.searchStr).toBe("?keep=yes");
  expect(router.state.location.hash).toBe("thread");

  await act(() =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Close, without handing it back"]')!
      .click(),
  );
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  await tap();
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  expect(router.state.location.searchStr).toBe("?keep=yes");
});

it("keeps the link's handoff in the address until Aldo answers, so signing in first comes back to it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  screen(true);
  read.handoff = signIn;
  read.pending = true;
  const router = createRouter({
    routeTree: createRootRoute({ component: AldoHandoffTakeoverHost }),
    history: createMemoryHistory({ initialEntries: ["/aldo-machine/thread?handoff=h_test"] }),
    defaultPendingMinMs: 0,
  });
  await router.load();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root!.render(<RouterProvider router={router} />));
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  expect(router.state.location.searchStr).toBe("?handoff=h_test");

  // Aldo answered: the address is the conversation's own again.
  await act(() => {
    read.pending = false;
    for (const listener of read.listeners) listener();
  });
  expect(router.state.location.searchStr).toBe("");
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
});

async function openAt(href: string) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const router = createRouter({
    routeTree: createRootRoute({ component: AldoHandoffTakeoverHost }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
    defaultPendingMinMs: 0,
  });
  await router.load();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root!.render(<RouterProvider router={router} />));
  await act(() => router.navigate({ href }));
  return container;
}

it("opened on a phone from the card's link, says what it is and leads a camera step with the site's own page", async () => {
  screen(true);
  const link = "https://verify.fiverr.com/continue?session=7f3a";
  read.handoff = {
    ...signIn,
    kind: "identity",
    site: "fiverr.com",
    reason: "Fiverr needs an ID check",
    how: null,
    phoneUrl: link,
  };
  const container = await openAt("/aldo-machine/thread?handoff=h_test");
  const dialog = container.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Fiverr needs an ID check");
  expect(dialog.textContent).toContain("Confirm who you are on fiverr.com");
  const site = dialog.querySelector("a")!;
  expect(site.getAttribute("href")).toBe(link);
  expect(site.textContent).toContain("Open on Fiverr");
  expect(
    [...dialog.querySelectorAll("button")].some((b) => b.textContent?.includes("I'm done")),
  ).toBe(true);
});

it("on a computer, the takeover is the agent's browser alone, without the site's phone link", async () => {
  screen(false);
  read.handoff = {
    ...signIn,
    kind: "identity",
    site: "fiverr.com",
    phoneUrl: "https://verify.fiverr.com/c",
  };
  const container = await openAt("/?handoff=h_test");
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  expect(container.querySelector('[role="dialog"] a')).toBeNull();
});
