// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vite-plus/test";
import type { AldoActivity } from "./activity";
import { AldoApiError } from "./api";
const fetchActivity = vi.hoisted(() => vi.fn());
const saveVerification = vi.hoisted(() => vi.fn());
vi.mock("./activity", () => ({
  fetchAldoActivity: fetchActivity,
  saveAldoVerification: saveVerification,
}));
import { AldoActivityDialog } from "./AldoActivityDialog";
let root: Root;
const example = (): AldoActivity => ({
  version: 1,
  next: null,
  events: [],
  turns: [],
  effects: [],
  routing: [],
  home: [],
  stream: null,
  cost: {
    chargedCredits: { machineCredits: 30, modelCredits: 5 },
    modelApiCost: { providerUsd: null, pending: 1, unpriced: 0 },
    subscriptionReference: null,
    conversationReference: null,
    externalPurchases: { usd: 0, count: 0 },
    note: "Shared totals are counted once. Reference prices are not money billed.",
  },
});
async function render(environmentId = "aldo-one", open = true) {
  await act(() =>
    root.render(
      <AldoActivityDialog
        environmentId={environmentId}
        conversation="conversation"
        open={open}
        onOpenChange={() => {}}
      />,
    ),
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  fetchActivity.mockReset().mockResolvedValue(example());
  saveVerification.mockReset().mockResolvedValue({ saved: true });
});
afterEach(async () => {
  await act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
it("stays dormant until opened and shows unknown coverage and distinct shared cost", async () => {
  await render("aldo-one", false);
  expect(fetchActivity).not.toHaveBeenCalled();
  await render();
  expect(fetchActivity).toHaveBeenCalledWith("aldo-one", "conversation");
  expect(document.body.textContent).toContain("An empty history doesn’t mean no work happened");
  expect(document.body.textContent).toContain("Unknown");
  expect(document.body.textContent).toContain("Computer credits · shared");
  expect(document.body.textContent).toContain("Some model costs are pending or unpriced");
});
it("an older server stays usable and retry can load saved activity", async () => {
  fetchActivity.mockRejectedValueOnce(new AldoApiError(404, "Missing"));
  await render();
  expect(document.body.textContent).toContain("Your work can continue");
  const retry = [...document.querySelectorAll("button")].find((b) => b.textContent === "Retry")!;
  await act(() => retry.click());
  expect(document.body.textContent).toContain("No result or platform receipt");
});
it("a response from a departed thread never fills the next thread", async () => {
  let finish!: (data: AldoActivity) => void;
  fetchActivity.mockReturnValueOnce(
    new Promise<AldoActivity>((resolve) => {
      finish = resolve;
    }),
  );
  await render();
  await render("aldo-two");
  await act(() =>
    finish({
      ...example(),
      routing: [
        { id: "old", origin: "test", reason: "Old private result", at: new Date().toISOString() },
      ],
    }),
  );
  expect(document.body.textContent).not.toContain("Old private result");
});
it("reported criteria remain distinct from platform receipts and older observations append", async () => {
  const data = example();
  data.next = "cursor";
  data.turns = [
    {
      id: "turn",
      trigger: "start",
      provider: "example",
      model: "example",
      outcome: "replied",
      taskResult: {
        state: "unfinished",
        doneWhen: [{ criterion: "Publish report", met: false, evidence: "Draft only" }],
      },
    },
  ];
  data.effects = [
    {
      id: "effect",
      operation: "email.send",
      provider: "google",
      status: "uncertain",
      receipt: null,
      approvalId: "approval",
      at: new Date().toISOString(),
    },
  ];
  fetchActivity.mockResolvedValueOnce(data).mockResolvedValueOnce({
    ...example(),
    events: [
      {
        id: "older",
        name: "read",
        kind: "tool",
        status: "completed",
        turnId: "turn",
        at: new Date().toISOString(),
      },
    ],
  });
  await render();
  expect(document.body.textContent).toContain("Reported unfinished");
  expect(document.body.textContent).toContain("Unmet: Publish report");
  expect(document.body.textContent).toContain("No provider receipt recorded");
  const more = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === "Older activity",
  )!;
  await act(() => more.click());
  expect(document.body.textContent).toContain("read · completed");
});
