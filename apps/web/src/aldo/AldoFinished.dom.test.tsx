// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import type { AldoHome, AldoHomeConversation, AldoHomePullRequest } from "./homeApi";

const backend = vi.hoisted(() => ({
  hold: vi.fn(),
  merge: vi.fn(),
  confirm: vi.fn(),
  ask: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
  close: vi.fn(),
}));
vi.mock("../components/ui/toast", () => ({
  toastManager: { add: backend.toast, close: backend.close },
}));
vi.mock("./workspaceApi", () => ({ holdAldoMerge: backend.hold }));
vi.mock("./homeFeed", () => ({ refreshAldoHome: backend.refresh }));
vi.mock("./decide", () => ({ decideAldoOutcome: backend.merge }));
vi.mock("./AldoBrief", () => ({ confirmQuickChoice: backend.confirm }));
vi.mock("./presenceReactions", () => ({ completeAldo: () => {} }));
vi.mock("./AldoLiveCard", async () => {
  const { createContext } = await import("react");
  return { AldoOpenContext: createContext(null) };
});
vi.mock("./AldoHomeInbox", () => ({
  askAldoAbout: backend.ask,
  ThreadLink: (props: { children?: ReactNode; className?: string; label?: string }) => (
    <a href="#thread" className={props.className} aria-label={props.label}>
      {props.children}
    </a>
  ),
}));

let AldoFinished: typeof import("./AldoFinished").AldoFinished;
let root: Root;
let container: HTMLDivElement;

const NOW = Date.parse("2026-11-18T15:00:00Z");
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();
const target = (id: string) => ({ environmentId: `aldo-${id}`, threadId: id });
const conversation = (id: string, title: string): AldoHomeConversation => ({
  ref: `m:${id}`,
  thread: target(id),
  title,
  repos: ["acme/web"],
  branch: "feature",
  state: "done",
  machine: "asleep",
  at: at(120),
  stateAt: at(120),
  summary: "Export button streams a CSV of the filtered rows.",
});
const pullRequest = (
  id: string,
  number: number,
  overrides: Partial<AldoHomePullRequest>,
): AldoHomePullRequest => ({
  environmentId: `aldo-${id}`,
  thread: target(id),
  threadTitle: id,
  repo: "acme/web",
  number,
  url: `https://github.com/acme/web/pull/${number}`,
  title: `PR ${number}`,
  status: "watching",
  stage: "checks-running",
  checks: { passed: 9, failed: 0, running: 3 },
  deploy: null,
  followups: 0,
  reviewsExhausted: false,
  greenSince: null,
  mergesAt: null,
  mergedAt: null,
  updatedAt: at(5),
  ...overrides,
});
const homeOf = (pullRequests: ReadonlyArray<AldoHomePullRequest>) =>
  ({
    conversations: [
      conversation("csv", "Add CSV export"),
      conversation("429", "Handle 429s"),
      conversation("e2e", "Fix flaky e2e"),
    ],
    pullRequests,
    actions: [],
    approvals: [],
  }) as unknown as AldoHome;
const busyDay = (held?: boolean) =>
  homeOf([
    pullRequest("csv", 1839, {
      stage: "green",
      checks: { passed: 14, failed: 0, running: 0 },
      mergesAt: at(-9),
      followups: 2,
      ...(held === undefined ? {} : { held }),
    }),
    pullRequest("429", 611, {
      stage: "checks-failing",
      checks: { passed: 11, failed: 2, running: 0 },
    }),
    pullRequest("e2e", 1842, {}),
  ]);

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  ({ AldoFinished } = await import("./AldoFinished"));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  for (const fn of Object.values(backend)) fn.mockReset();
  backend.toast.mockReturnValue("toast-1");
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const rowTexts = () =>
  [...container.querySelectorAll("[data-aldo-finished-result]")].map((r) => r.textContent?.trim());
const button = (name: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);

it("lists what finished with where it honestly stands, what failed first, checks still running as a line", async () => {
  await act(async () => root.render(<AldoFinished home={busyDay(false)} now={NOW} />));
  expect(container.querySelector("h3")?.textContent).toBe("Finished · 3");
  expect(rowTexts()).toEqual([
    "Handle 429s2 checks failing",
    "Add CSV exportMerges in 9 min",
    "Waiting on checks: Fix flaky e2eChecks 9 of 12",
  ]);
  // Only what shipped gets a green check: nothing here is.
  expect(container.querySelector(".text-success-foreground")).toBeNull();
  // What failed is amber, its glyph and its words.
  expect(
    [...container.querySelectorAll(".text-warning-foreground")].map((e) => e.tagName.toLowerCase()),
  ).toEqual(["svg", "span"]);
  expect(container.querySelector("span.text-warning-foreground")?.textContent).toBe(
    "2 checks failing",
  );
});

it("opens a result into its receipt, and Hold stops Aldo's merge, with Undo", async () => {
  backend.hold.mockResolvedValue(true);
  await act(async () => root.render(<AldoFinished home={busyDay(false)} now={NOW} />));
  await act(async () =>
    container.querySelectorAll<HTMLButtonElement>("[data-aldo-finished-result] button")[1]!.click(),
  );
  const card = container.querySelector("article[aria-label='Add CSV export']")!;
  expect(card.textContent).toContain("Export button streams a CSV of the filtered rows.");
  expect(card.textContent).toContain("14 checks passed");
  expect(card.textContent).toContain("Aldo sent it back to the agent 2 times");
  expect(card.textContent).toContain("Aldo merges it in 9 min, unless you hold it.");
  // Its changes are one button, not a link besides.
  expect(card.querySelectorAll("a[href$='/pull/1839/files']").length).toBe(1);

  await act(async () => button("Hold")!.click());
  expect(backend.hold).toHaveBeenCalledWith(
    "aldo-csv",
    expect.objectContaining({ repo: "acme/web", number: 1839 }),
    true,
  );
  expect(backend.refresh).toHaveBeenCalled();
  const told = backend.toast.mock.calls.at(-1)![0];
  expect(told).toMatchObject({ type: "success", title: "Held #1839" });
  await act(async () => told.actionProps.onClick());
  expect(backend.hold).toHaveBeenLastCalledWith(
    "aldo-csv",
    expect.objectContaining({ number: 1839 }),
    false,
  );
});

it("offers no Hold where Aldo can't hold a merge, and Merge now asks before it merges", async () => {
  backend.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  backend.merge.mockResolvedValue({ outcome: "done", said: null });
  await act(async () => root.render(<AldoFinished home={busyDay()} now={NOW} />));
  await act(async () =>
    container.querySelectorAll<HTMLButtonElement>("[data-aldo-finished-result] button")[1]!.click(),
  );
  expect(button("Hold")).toBeUndefined();
  expect(container.textContent).toContain("Aldo merges it in 9 min.");
  await act(async () => button("Merge now")!.click());
  expect(backend.confirm).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "merge", key: "merge:acme/web#1839" }),
    { kind: "merge" },
  );
  expect(backend.merge).not.toHaveBeenCalled();
  await act(async () => button("Merge now")!.click());
  expect(backend.merge).toHaveBeenCalledWith(expect.objectContaining({ kind: "merge" }), {
    kind: "merge",
  });
});

it("sends what failed to Aldo's composer, and shows nothing when nothing finished is on its way", async () => {
  await act(async () => root.render(<AldoFinished home={busyDay(false)} now={NOW} />));
  await act(async () =>
    container.querySelectorAll<HTMLButtonElement>("[data-aldo-finished-result] button")[0]!.click(),
  );
  expect(container.textContent).toContain("2 of 13 checks fail.");
  expect(container.querySelector("a[href$='/pull/611/checks']")).not.toBeNull();
  await act(async () => button("Ask Aldo about it")!.click());
  expect(backend.ask).toHaveBeenCalledWith("Handle 429s");

  await act(async () => root.render(<AldoFinished home={homeOf([])} now={NOW} />));
  expect(container.innerHTML).toBe("");
});
