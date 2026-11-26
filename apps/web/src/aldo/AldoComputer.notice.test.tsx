// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { ThreadId } from "@t3tools/contracts";
import type { AldoComputer } from "./computer.logic";

const directory = vi.hoisted(() => ({
  environments: [] as { environmentId: string; computers: AldoComputer[] }[],
}));
vi.mock("./directory", () => ({
  getAldoEnvironments: () => directory.environments,
  subscribeAldoEnvironments: () => () => {},
  requestAldoDirectoryRefresh: () => {},
}));
vi.mock("@tanstack/react-router", () => ({
  useParams: ({ select }: { select: (params: Record<string, string>) => unknown }) =>
    select({ environmentId: "aldo-notice", threadId: "notice" }),
}));
vi.mock("./workspaceApi", () => ({
  answerAldoComputer: vi.fn(),
  stopAldoComputer: vi.fn(),
}));

import { ToastProvider } from "../components/ui/toast";
import { answerAldoComputer, stopAldoComputer } from "./workspaceApi";
import { useAldoComputerAsk } from "./AldoComputer";

let root: Root;
let host: HTMLDivElement;
function Notice() {
  useAldoComputerAsk("aldo-notice", ThreadId.make("notice"));
  return null;
}
async function poll(computer: AldoComputer | AldoComputer[] | null) {
  directory.environments = [
    {
      environmentId: "aldo-notice",
      computers: Array.isArray(computer) ? computer : computer ? [computer] : [],
    },
  ];
  await act(() =>
    root.render(
      <ToastProvider>
        <Notice />
      </ToastProvider>,
    ),
  );
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(() => root.render(<ToastProvider />));
});
afterEach(async () => {
  await poll(null);
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

it.each([true, false])(
  "answers the updated computer toast with its displayed decision (%s)",
  async (approve) => {
    const computer: AldoComputer = {
      kind: "gpu",
      status: "asked",
      why: "Render the draft",
      error: null,
      creditsPerHour: 90,
      decisionKey: "original",
    };
    await poll(computer);
    await poll({ ...computer, why: "Render the revised scene", decisionKey: "revised" });
    expect(document.body.textContent).toContain("Render the revised scene");
    const button = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === (approve ? "Start it" : "Not now"),
    );
    expect(button).toBeDefined();
    await act(async () => button!.click());
    expect(answerAldoComputer).toHaveBeenLastCalledWith(
      "aldo-notice",
      approve,
      "gpu",
      undefined,
      "revised",
    );
  },
);

it.each(["windows", "gpu"])("shows %s ready after a queued poll skips starting", async (kind) => {
  const computer: AldoComputer = {
    kind,
    status: "queued",
    position: 2,
    why: null,
    error: null,
    creditsPerHour: 90,
  };
  await poll(computer);
  expect(document.body.textContent).toContain(
    kind === "windows" ? "Waiting for Windows" : "Waiting for GPU",
  );
  await poll({ ...computer, status: "running" });
  expect(document.body.textContent).toContain(
    `Your ${kind === "windows" ? "Windows" : "GPU"} computer is running`,
  );
  expect(document.body.textContent).toContain(
    kind === "windows"
      ? "See it in the Desktop view: choose Windows."
      : "Your agent uses it from its own computer.",
  );
  expect(document.body.textContent).not.toContain("Waiting for");
});

it.each(["windows", "gpu"])("shows %s failure after a queued poll skips starting", async (kind) => {
  const computer: AldoComputer = {
    kind,
    status: "queued",
    position: 1,
    why: null,
    error: null,
    creditsPerHour: 90,
  };
  await poll(computer);
  await poll({ ...computer, status: "failed", error: "Provider capacity is unavailable." });
  expect(document.body.textContent).toContain(
    `Your ${kind === "windows" ? "Windows" : "GPU"} computer didn't start`,
  );
  expect(document.body.textContent).toContain("Provider capacity is unavailable.");
  expect(document.body.textContent).not.toContain("Waiting for");
  expect(document.body.textContent).not.toContain("Cancel request");
});

it("cancels only the selected conversation when a workspace has two Windows requests", async () => {
  const base: AldoComputer = {
    kind: "windows",
    disposable: true,
    status: "queued",
    why: null,
    error: null,
    creditsPerHour: 38.4,
    concurrentLimit: 5,
  };
  await poll([
    { ...base, id: "other", t3ThreadId: "other", position: 1 },
    { ...base, id: "own", t3ThreadId: "notice", position: 2 },
  ]);
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === "Cancel request",
  );
  expect(button).toBeDefined();
  await act(async () => {
    button!.click();
  });
  expect(stopAldoComputer).toHaveBeenCalledWith("aldo-notice", "windows", "notice");
});
