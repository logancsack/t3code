// @vitest-environment jsdom
vi.mock("./AldoWorkstream", () => ({
  threadLink: (target: { threadId: string }, children: ReactNode, className?: string) => (
    <a href={`/thread/${target.threadId}`} className={className}>
      {children}
    </a>
  ),
}));

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { AldoCallCard } from "./AldoCallCard";
import type { AldoCall } from "./assistant.logic";

const backend = vi.hoisted(() => ({ transcript: vi.fn() }));
vi.mock("./assistantApi", () => ({ aldoAssistant: { callTranscript: backend.transcript } }));

const call = (over: Partial<AldoCall> = {}): AldoCall => ({
  id: "as_1",
  at: "2026-10-23T14:14:00.000Z",
  state: "done",
  seconds: 380,
  summary:
    "You asked Aldo to move the dentist to Thursday.\nAldo found 3 pm and queued the change.",
  links: [
    { kind: "thread", title: "Move dentist", environmentId: "aldo-m", threadId: "t1" },
    { kind: "page", title: "Confirmation", url: "/s/abcdefghijklmnop1234" },
  ],
  ...over,
});

let container: HTMLDivElement;
let root: Root;
const render = (c: AldoCall) => act(async () => root.render(<AldoCallCard call={c} />));
const button = (name: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith(name))!;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  backend.transcript.mockReset().mockResolvedValue([
    { role: "assistant", text: "Hey, what's up?", at: "2026-10-23T14:14:01.000Z" },
    { role: "user", text: "Move my dentist appointment.", at: "2026-10-23T14:14:05.000Z" },
  ]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("says it was a call, how long, what was decided, and links to what it made", async () => {
  await render(call());
  const text = container.textContent ?? "";
  expect(text).toContain("Call");
  expect(text).toContain("6 min");
  expect(text).toContain("You asked Aldo to move the dentist to Thursday.");
  expect(container.querySelector("p")!.textContent).toContain("\n");
  const links = [...container.querySelectorAll("a")];
  expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
    ["Move dentist", "/thread/t1"],
    ["Confirmation", "/s/abcdefghijklmnop1234"],
  ]);
  expect(links[1]!.getAttribute("target")).toBe("_blank");
});

it("says it's being summarized until it is, never showing the turns", async () => {
  await render(call({ state: "summarizing", summary: null, links: [] }));
  expect(container.textContent).toContain("Summarizing…");
  expect(container.textContent).not.toContain("Hey, what's up?");
  expect(backend.transcript).not.toHaveBeenCalled();
});

it("is on while the call is, with no transcript to open yet", async () => {
  await render(call({ state: "live", summary: null, links: [], seconds: 0 }));
  expect(container.textContent).toContain("On a call now.");
  expect(container.textContent).toContain("on now");
  expect(container.querySelector("button")).toBeNull();
});

it("keeps the transcript closed until it's asked for, then reads it once", async () => {
  await render(call());
  const toggle = button("Transcript");
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(container.textContent).not.toContain("Move my dentist appointment.");
  expect(backend.transcript).not.toHaveBeenCalled();
  await act(async () => toggle.click());
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(backend.transcript).toHaveBeenCalledWith("as_1");
  expect(container.textContent).toContain("Move my dentist appointment.");
  expect(container.textContent).toContain("You");
  await act(async () => toggle.click());
  expect(container.textContent).not.toContain("Move my dentist appointment.");
  await act(async () => toggle.click());
  expect(backend.transcript).toHaveBeenCalledTimes(1);
});

it("says plainly when the transcript can't be read, and tries again", async () => {
  backend.transcript.mockRejectedValueOnce(new Error("offline"));
  await render(call());
  await act(async () => button("Transcript").click());
  expect(container.textContent).toContain("Couldn’t load the transcript.");
  await act(async () => button("Try again").click());
  expect(container.textContent).toContain("Move my dentist appointment.");
});

it("says plainly when a finished call has no summary, not that it's summarizing", async () => {
  await render(call({ summary: null, links: [] }));
  expect(container.textContent).toContain("No summary for this call.");
  expect(container.textContent).not.toContain("Summarizing…");
});

it("reads a transcript opened before the call was done again once it is", async () => {
  await render(call({ state: "summarizing", summary: null, links: [] }));
  await act(async () => button("Transcript").click());
  expect(backend.transcript).toHaveBeenCalledTimes(1);
  await render(call());
  expect(backend.transcript).toHaveBeenCalledTimes(2);
  await render(call());
  expect(backend.transcript).toHaveBeenCalledTimes(2);
});
