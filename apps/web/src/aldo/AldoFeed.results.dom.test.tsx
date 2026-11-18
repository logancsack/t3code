// @vitest-environment jsdom
import { act, createContext } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import type { AldoHomeConversation } from "./homeApi";

vi.mock("./AldoLiveCard", () => ({
  AldoOpenContext: createContext(null),
  AldoThreadCard: () => null,
}));
vi.mock("./AldoPaymentCard", () => ({ AldoPaymentLine: () => null }));
vi.mock("./AldoPlanCard", () => ({ AldoPlanCard: () => null }));
vi.mock("./AldoFrame", () => ({ AldoFrame: () => null }));
vi.mock("./homeFeed", () => ({
  useAldoHomeFeed: () => [],
  useAldoHomeReadAt: () => Date.now(),
}));
vi.mock("../components/ChatMarkdown", () => ({
  default: ({ text }: { text: string }) => <p>{text}</p>,
}));

const { AldoFeedRun } = await import("./AldoFeed");

it("keeps completion proof visible when a task settles into the finished feed", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const conversation: AldoHomeConversation = {
    ref: "report",
    thread: { environmentId: "aldo-report", threadId: "report" },
    title: "Publish the page",
    repos: [],
    branch: "",
    state: "done",
    machine: "asleep",
    at: new Date().toISOString(),
    result: {
      state: "finished",
      doneWhen: [{ criterion: "Phone preview works", met: true, evidence: "Opened at 390px." }],
      checked: ["Keyboard navigation passed."],
      notChecked: ["Production sign-in was not checked."],
      decided: [],
    },
  };
  try {
    await act(async () =>
      root.render(
        <AldoFeedRun
          events={[{ kind: "finished", key: "result", at: conversation.at, conversation }]}
        />,
      ),
    );
    await vi.waitFor(() =>
      expect(host.querySelector('[aria-label="Task result"]')?.textContent).toContain(
        "Phone preview works",
      ),
    );
    expect(host.textContent).toContain("Opened at 390px.");
    expect(host.textContent).toContain("Keyboard navigation passed.");
    expect(host.textContent).toContain("Production sign-in was not checked.");
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
