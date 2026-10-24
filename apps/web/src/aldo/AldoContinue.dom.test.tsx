// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import type { AldoHomeConversation } from "./homeApi";

const backend = vi.hoisted(() => ({
  continue: vi.fn(),
  held: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("./homeApi", () => ({ continueAldoThread: backend.continue }));
vi.mock("./homeFeed", () => ({
  sendAldoAnswer: (c: AldoHomeConversation, send: () => Promise<unknown>) => {
    backend.held(c.ref);
    return send();
  },
}));

let ContinueButton: typeof import("./AldoContinue").ContinueButton;
let root: Root;
let container: HTMLDivElement;
const conversation = {
  ref: "t",
  thread: { environmentId: "aldo-t", threadId: "c" },
  title: "Inline artifacts",
} as AldoHomeConversation;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  ({ ContinueButton } = await import("./AldoContinue"));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  backend.continue.mockReset();
  backend.held.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it("answers the tap at once, holds the conversation as carrying on, and says it asked", async () => {
  let finish!: (status: string) => void;
  backend.continue.mockReturnValue(new Promise<string>((resolve) => (finish = resolve)));
  await act(async () => root.render(<ContinueButton conversation={conversation} />));
  const button = container.querySelector("button")!;
  expect(button.textContent).toBe("Continue");
  await act(async () => button.click());
  expect(button.textContent).toBe("Continuing…");
  expect(button.disabled).toBe(true);
  expect(backend.held).toHaveBeenCalledWith("t");
  expect(backend.continue).toHaveBeenCalledWith(conversation.thread);
  await act(async () => finish("asked it to carry on"));
  expect(button.textContent).toBe("Asked it to carry on");
  expect(button.disabled).toBe(true);
});

it("gives the button back with the reason when it couldn't carry on", async () => {
  backend.continue.mockRejectedValue(new Error("That thread isn't paused."));
  await act(async () => root.render(<ContinueButton conversation={conversation} />));
  await act(async () => container.querySelector("button")!.click());
  expect(container.querySelector("[role=alert]")?.textContent).toBe("That thread isn't paused.");
  expect(container.querySelector("button")!.disabled).toBe(false);
  expect(container.querySelector("button")!.textContent).toBe("Continue");
});

it("sends a plan that can't run agents to its fix, not Continue", async () => {
  await act(async () =>
    root.render(
      <ContinueButton
        conversation={conversation}
        blocked={{ text: "Credits used up.", label: "Raise the limit", href: "/settings/account" }}
      />,
    ),
  );
  expect(container.querySelector("button")).toBeNull();
  const link = container.querySelector("a")!;
  expect(link.textContent).toBe("Raise the limit");
  expect(link.getAttribute("href")).toBe("/settings/account");
});
