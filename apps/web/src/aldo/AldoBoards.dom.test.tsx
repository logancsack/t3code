// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { BoardView } from "./boardsApi";
const mocks = vi.hoisted(() => ({ list: vi.fn(), action: vi.fn() }));
vi.mock("./boardsApi", () => ({ listBoards: mocks.list, boardAction: mocks.action }));
vi.mock("./AldoPlaces", () => ({
  AldoPlacePage: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
const { AldoBoardsPage } = await import("./AldoBoards");
const board: BoardView = {
  id: "b",
  title: "Launch",
  members: [],
  commands: [],
  posts: [],
  earlier: null,
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.list.mockReset().mockResolvedValue({ boards: [{ id: "b", title: "Launch" }], threads: [] });
  mocks.action
    .mockReset()
    .mockImplementation(async (input: { action: string }) =>
      input.action === "read" ? board : { id: "p" },
    );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("keeps a failed read distinct from an empty board, with retry", async () => {
  mocks.list.mockRejectedValue(new Error("Couldn't load boards. Your work is saved."));
  await act(async () => root.render(<AldoBoardsPage />));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Couldn't load boards");
  expect(container.textContent).not.toContain("No shared work yet");
  expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Retry")).toBe(
    true,
  );
});
it("keeps an unsent message and the same request key when retrying a failed send", async () => {
  await act(async () => root.render(<AldoBoardsPage />));
  const input = container.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      "Please review the plan.",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const requests: Array<Record<string, unknown>> = [];
  mocks.action.mockImplementation(async (request: Record<string, unknown>) => {
    if (request.action === "read") return board;
    requests.push(request);
    if (requests.length === 1) throw new Error("Connection lost. Try again.");
    return { id: "p" };
  });
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(input.value).toBe("Please review the plan.");
  expect(container.textContent).toContain("Connection lost");
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(requests).toHaveLength(2);
  expect(requests[0]?.key).toBe(requests[1]?.key);
  expect(input.value).toBe("");
});
