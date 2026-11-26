// @vitest-environment jsdom
// The status line at the top and the pill above the composer, rendered together from one home: the same number.

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { type AldoHome } from "./homeApi";
import { needsYouNow } from "./needsYou.logic";

const NOW = Date.parse("2026-10-26T12:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const underTheHood = vi.hoisted(() => vi.fn());
const dismiss = vi.hoisted(() => vi.fn(async () => undefined));
const restore = vi.hoisted(() => vi.fn(async () => undefined));
const remove = vi.hoisted(() => vi.fn(async (_ids: ReadonlyArray<string>) => undefined));

vi.mock("./assistantSession", () => ({
  useAldoAssistant: (select: (s: { phase: string; replying: boolean }) => unknown) =>
    select({ phase: "idle", replying: false }),
}));
vi.mock("./receipts", () => ({
  useAldoReceipts: (select: (s: { receipts: never[] }) => unknown) => select({ receipts: [] }),
}));
vi.mock("./simpleMode", () => ({ setAldoUnderTheHood: underTheHood }));
vi.mock("./AldoFrame", () => ({ AldoFrame: () => null }));
vi.mock("./AldoHomeInbox", () => ({
  ThreadLink: ({ children }: { children: ReactNode }) => <a href="#thread">{children}</a>,
}));
vi.mock("./homeApi", async (original) => ({
  ...(await original<typeof import("./homeApi")>()),
  removeAldoDecisions: remove,
}));
vi.mock("./homeFeed", async (original) => ({
  ...(await original<typeof import("./homeFeed")>()),
  refreshAldoHome: async () => undefined,
}));
vi.mock("./clearNeedsYou", () => ({ dismissNeedsYou: dismiss, restoreNeedsYou: restore }));
// No machine is connected here: no live step (and none of T3's thread state to load).
vi.mock("./liveWork", () => ({ useAldoLiveWork: () => null, useAldoLiveNow: () => NOW }));
vi.mock("./DismissChatDecision", () => ({
  AldoHiddenFromChat: () => null,
  DismissChatDecision: () => <button type="button">Show again</button>,
}));

let AldoPresence: typeof import("./AldoPresence").AldoPresence;
let NeedsYouPill: typeof import("./NeedsYouPill").NeedsYouPill;
let useAldoHomeReadAt: typeof import("./homeFeed").useAldoHomeReadAt;
let root: Root;
let host: HTMLElement;

const hidden = (id: string) => ({ id, dismissed: true, until: null });
const putOff = (id: string) => ({
  id,
  dismissed: true,
  until: new Date(NOW + 3_600_000).toISOString(),
});
const conversation = (ref: string, over: Record<string, unknown>) => ({
  ref,
  thread: { environmentId: `aldo-${ref}`, threadId: ref },
  title: `Thread ${ref}`,
  repos: [],
  branch: "",
  machine: "asleep",
  state: "waiting",
  at: ago(30),
  ...over,
});

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  ({ AldoPresence } = await import("./AldoPresence"));
  ({ NeedsYouPill } = await import("./NeedsYouPill"));
  ({ useAldoHomeReadAt } = await import("./homeFeed"));
  useAldoHomeReadAt.setState({ at: NOW - 10_000 });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

/** The status line at the top and the pill above the composer, on screen together, read from one home. */
function screen(home: AldoHome) {
  const scroller = { current: document.createElement("div") };
  act(() =>
    root.render(
      <>
        <AldoPresence home={home} now={NOW} />
        <NeedsYouPill scroller={scroller} items={needsYouNow(home, NOW, [])} />
      </>,
    ),
  );
  const text = document.body.textContent ?? "";
  const top = /(\d+) things? needs? you/.exec(text)?.[1] ?? null;
  const bottom = /Review (\d+) requests?/.exec(text)?.[1] ?? null;
  return {
    top: top === null ? null : Number(top),
    bottom: bottom === null ? null : Number(bottom),
    text,
  };
}

it("says the same number at the top and the bottom on a Logan-shaped home", () => {
  // Four threads waiting (one is a report, not a question), a tap approval, a plan,
  // and a pile he hid or put off, which counts nowhere.
  const home = {
    at: ago(0),
    conversations: [
      conversation("invoice", {
        pending: {
          kind: "question",
          requestId: "q",
          questions: [
            { id: "a", header: "H", question: "Which?", options: [], multiSelect: false },
          ],
        },
      }),
      conversation("report", { summary: "Merged and live." }),
      conversation("grok", {
        pending: { kind: "approval", requestId: "p", summary: "Pay?", options: [] },
      }),
      conversation("opencode", { plan: { id: "plan", text: "A plan" } }),
      conversation("secrets1", { state: "failed", chatDecision: hidden("s1") }),
      conversation("secrets2", { state: "failed", chatDecision: hidden("s2") }),
      conversation("clip", {
        pending: { kind: "question", requestId: "c", questions: [] },
        chatDecision: putOff("c"),
      }),
      conversation("later", { snoozedUntil: new Date(NOW + 3_600_000).toISOString() }),
    ],
    pullRequests: [],
    upcoming: [],
    approvals: [
      {
        id: "server",
        kind: "confirm",
        title: "Rent the Seattle server",
        status: "pending",
        createdAt: ago(5),
        thread: null,
      },
    ],
  } as unknown as AldoHome;
  const shown = screen(home);
  expect(shown.top).toBe(5);
  expect(shown.bottom).toBe(5);
});

it("says the same number when it is only the tap approval that is pending", () => {
  const home = {
    at: ago(0),
    conversations: [conversation("report", { summary: "Merged and live." })],
    pullRequests: [],
    upcoming: [],
    approvals: [
      {
        id: "server",
        kind: "confirm",
        title: "Rent the Seattle server",
        status: "pending",
        createdAt: ago(5),
        thread: null,
      },
    ],
  } as unknown as AldoHome;
  const shown = screen(home);
  expect(shown.top).toBe(2);
  expect(shown.bottom).toBe(2);
});
