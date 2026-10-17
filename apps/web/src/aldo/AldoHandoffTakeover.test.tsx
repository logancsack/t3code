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

vi.mock("./homeFeed", () => ({
  useAldoHomeRead: () => ({
    home: {
      handoffs: [
        {
          id: "h_test",
          threadTitle: "Needs you",
          kind: "sign_in",
          how: "Sign in to continue.",
          thread: { environmentId: "aldo-machine", threadId: "thread" },
        },
      ],
    },
    supported: true,
  }),
}));
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
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

it("reopens the same notification after closing its takeover, preserving other URL state", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
