// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { AldoHomeConversation } from "./homeApi";
const host = vi.hoisted(() => ({
  close: vi.fn(),
  navigate: vi.fn(),
  feed: { home: { conversations: [] as AldoHomeConversation[] }, error: null, supported: true },
}));
vi.mock("./layers", () => ({ aldoLayersActive: () => true, closeAldoThread: host.close }));
vi.mock("./homeFeed", () => ({ useAldoHomeRead: () => host.feed, refreshAldoHome: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => host.navigate,
  Link: ({
    children,
    params,
    onClick,
    ...props
  }: {
    children: ReactNode;
    params: { environmentId: string; threadId: string };
    onClick: () => void;
  }) => (
    <a
      {...props}
      href={`/${params.environmentId}/${params.threadId}`}
      onClick={(event) => {
        event.preventDefault();
        onClick();
      }}
    >
      {children}
    </a>
  ),
}));
let root: Root, container: HTMLDivElement;
let Breadcrumb: typeof import("./AldoThreadBreadcrumb").AldoThreadBreadcrumb;
const title =
  "Widen the Home column while preserving Android keyboard behavior and attachment previews";
const place = {
  name: "aldo + t3code",
  repos: ["logan/aldo", "logan/t3code"],
  project: null,
  detail: "Repositories",
  activeAt: null,
};
const thread = (id: string, threadId: string, name: string, repos = place.repos) =>
  ({
    ref: id + threadId,
    thread: { environmentId: id, threadId },
    title: name,
    repos,
    branch: "main",
    state: "done",
    machine: "asleep",
    at: "2026-10-29T00:00:00.000Z",
  }) satisfies AldoHomeConversation;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host.close.mockClear();
  host.feed.home.conversations = [
    thread("aldo-a", "one", title),
    thread("aldo-a", "two", "Another thread"),
    thread("aldo-b", "three", "Other project", ["logan/t3code"]),
  ];
  ({ AldoThreadBreadcrumb: Breadcrumb } = await import("./AldoThreadBreadcrumb"));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(withProject = true) {
  await act(async () =>
    root.render(
      <Breadcrumb
        title={title}
        place={withProject ? place : null}
        environmentId="aldo-a"
        threadId="one"
      />,
    ),
  );
}
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label,
  )!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
it("Home uses Back's close handler and projectless threads have no project crumb", async () => {
  await render(false);
  await click("Home");
  expect(host.close).toHaveBeenCalledOnce();
  expect(document.querySelector('[aria-label$="show project threads"]')).toBeNull();
});
it("tapping the icon reveals the clean name and matching threads, with only the exact thread current", async () => {
  await render();
  await click("Aldo: show project threads");
  await vi.waitFor(() =>
    expect(document.querySelector('[data-slot="popover-popup"]')).not.toBeNull(),
  );
  const popup = document.querySelector('[data-slot="popover-popup"]')!;
  expect(popup.textContent).toContain("Aldo");
  expect(popup.textContent).toContain("Another thread");
  expect(popup.textContent).not.toContain("Other project");
  expect(popup.querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
  expect(popup.querySelector('a[aria-current="page"]')?.getAttribute("href")).toBe("/aldo-a/one");
});
it("tapping a long title reveals every word", async () => {
  await render();
  await click(`Read full thread title: ${title}`);
  await vi.waitFor(() =>
    expect(document.querySelector('[data-slot="popover-popup"]')?.textContent).toBe(title),
  );
});
