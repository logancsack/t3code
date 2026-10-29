// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { AldoHomeConversation } from "./homeApi";
const host = vi.hoisted(() => ({
  phone: true,
  close: vi.fn(),
  toggle: vi.fn(),
  actions: vi.fn(),
  feed: {
    home: { conversations: [] as AldoHomeConversation[], handoffs: [] },
    error: null,
    supported: true,
  },
}));
vi.mock("../hooks/useMediaQuery", () => ({ useIsMobile: () => host.phone }));
vi.mock("./developerTools", () => ({ useAldoDeveloperTools: () => true }));
vi.mock("./layers", () => ({ aldoLayersActive: () => true, closeAldoThread: host.close }));
vi.mock("./homeFeed", () => ({ useAldoHomeRead: () => host.feed, refreshAldoHome: vi.fn() }));
vi.mock("../rightPanelStore", () => ({
  useRightPanelStore: { getState: () => ({ open: vi.fn(), toggleVisibility: host.toggle }) },
}));
vi.mock("./workspaceApi", () => ({
  fetchAldoPreviews: async () => ({ running: false, ports: [], services: [] }),
  fetchAldoPullRequests: async () => [],
  fetchAldoCost: async () => null,
  aldoPreviewUrl: vi.fn(),
  mergeAldoPullRequest: vi.fn(),
  stopAldoFollowThrough: vi.fn(),
}));
vi.mock("./AldoComputer", () => ({
  AldoGpuComputerControl: () => null,
  useAldoComputerAsk: () => {},
}));
vi.mock("./AldoMachine", () => ({
  AldoMachineMenuSection: () => null,
  useAldoMachineOffer: () => {},
}));
vi.mock("./AldoHandoffCard", () => ({ openAldoHandoffTakeover: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
    <a href="#" onClick={onClick}>
      {children}
    </a>
  ),
}));
import { AldoThreadHeader } from "./AldoThreadHeader";

let root: Root, container: HTMLDivElement;
const title = "Widen the Home column while keeping Android keyboard behavior";
const place = {
  name: "aldo + t3code",
  repos: ["logan/aldo", "logan/t3code"],
  project: null,
  detail: "Repositories",
  activeAt: null,
};
const thread = (threadId: string, name: string) =>
  ({
    ref: threadId,
    thread: { environmentId: "aldo-a", threadId },
    title: name,
    repos: place.repos,
    branch: "main",
    state: "done",
    machine: "asleep",
    at: "2026-10-29T00:00:00.000Z",
  }) satisfies AldoHomeConversation;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host.phone = true;
  host.close.mockClear();
  host.toggle.mockClear();
  host.actions.mockClear();
  host.feed.home.conversations = [thread("one", title), thread("two", "Another thread")];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () =>
    root.render(
      <AldoThreadHeader
        environmentId={"aldo-a" as EnvironmentId}
        threadId={"one" as ThreadId}
        title={title}
        place={place}
        working
        titleEditor={null}
        onActions={host.actions}
        isServerThread
        actionsRef={null}
        actionsClassName=""
      />,
    ),
  );
}
async function click(label: string) {
  const el = [...document.querySelectorAll<HTMLElement>('button,[role="menuitem"]')].find(
    (e) => e.getAttribute("aria-label") === label || e.textContent?.trim() === label,
  );
  expect(el, label).toBeTruthy();
  await act(async () => el!.click());
}

it("a phone's app bar goes back Home, and its title opens the thread's actions and project", async () => {
  await render();
  expect(container.querySelector("h2")?.textContent).toBe(title);
  expect(container.textContent).toContain("Aldo · Working");
  await click("Home");
  expect(host.close).toHaveBeenCalledOnce();

  await click(`About this thread: ${title}`);
  await vi.waitFor(() =>
    expect(document.querySelector('[data-slot="popover-popup"]')?.textContent).toContain(
      "Threads in Aldo",
    ),
  );
  expect(document.querySelector('[data-slot="popover-popup"]')?.textContent).toContain(
    "Another thread",
  );
  await click(`Thread actions for ${title}`);
  expect(host.actions).toHaveBeenCalledOnce();
});

it("a phone opens files, terminal and changes from the menu; a desktop keeps the breadcrumbs and its panel toggle", async () => {
  await render();
  await click("Thread tools");
  await click("Files, terminal and changes");
  expect(host.toggle).toHaveBeenCalledOnce();

  await act(async () => root.unmount());
  document.body.innerHTML = "";
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  host.phone = false;
  await render();
  expect(container.querySelector('[aria-label="Thread breadcrumb"]')).not.toBeNull();
  await click("Thread tools");
  await vi.waitFor(() => expect(document.body.textContent).toContain("Open agent browser"));
  expect(document.body.textContent).not.toContain("Files, terminal and changes");
});
