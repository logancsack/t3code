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

it("records owner review independently, preserves a failed save and can clear a saved check", async () => {
  const data = example();
  data.turns = [
    {
      id: "turn",
      trigger: "user",
      provider: "codex",
      model: "model",
      outcome: "replied",
      taskResult: {
        state: "finished",
        doneWhen: [
          {
            criterion: "Deliver the artifact",
            met: true,
            evidence: "https://fixture.invalid/report",
          },
        ],
      },
    },
  ];
  fetchActivity.mockResolvedValue(data);
  saveVerification.mockRejectedValueOnce(new Error("offline"));
  await render();
  expect(document.querySelector('a[href="https://fixture.invalid/report"]')).not.toBeNull();
  const button = () =>
    [...document.querySelectorAll("button")].find((b) => b.textContent === "Verified this")!;
  await act(() => button().click());
  expect(document.body.textContent).toContain("Couldn’t confirm your check");
  expect(document.body.textContent).toContain("Deliver the artifact");
  expect(saveVerification).toHaveBeenLastCalledWith("aldo-one", "conversation", {
    action: "review",
    turnId: "turn",
    criterion: "Deliver the artifact",
    verdict: "passed",
  });
  data.turns[0]!.taskResult!.doneWhen[0]!.verification = {
    verdict: "passed",
    verifier: "owner_review_v1",
    checkedAt: "2026-11-18T12:00:00Z",
  };
  await act(() => button().click());
  const clear = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === "Clear my check",
  )!;
  saveVerification.mockImplementationOnce(async () => {
    data.turns[0]!.taskResult!.doneWhen[0]!.verification!.verdict = "unverified";
    return { saved: true };
  });
  await act(() => clear.click());
  expect(saveVerification).toHaveBeenLastCalledWith(
    "aldo-one",
    "conversation",
    expect.objectContaining({ verdict: "unverified" }),
  );
  const problem = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === "Found a problem",
  )!;
  expect(problem).toBeDefined();
  await act(() => problem.click());
  expect(saveVerification).toHaveBeenLastCalledWith(
    "aldo-one",
    "conversation",
    expect.objectContaining({ verdict: "failed" }),
  );
});
it("keeps optional estimates unknown and preserves them after a failed save", async () => {
  const data = example();
  data.workflow = {
    pack: "records",
    version: 1,
    humanMinutes: 45,
    reviewMinutes: null,
    hiringMinutesPerMonth: null,
    role: null,
  };
  fetchActivity.mockResolvedValue(data);
  saveVerification.mockRejectedValueOnce(new Error("offline"));
  await render();
  const form = [...document.querySelectorAll("form")].find((f) =>
    f.textContent?.includes("Save estimates"),
  )!;
  await act(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(saveVerification).toHaveBeenLastCalledWith("aldo-one", "conversation", {
    action: "baseline",
    humanMinutes: 45,
    reviewMinutes: null,
    hiringMinutesPerMonth: null,
    role: null,
  });
  expect(document.body.textContent).toContain("Your entered values are still here");
  expect((form.querySelector('input[type="number"]') as HTMLInputElement).value).toBe("45");
});
it("never reconciles an uncertain action until the owner records an account check; failures keep it held", async () => {
  const data = example();
  data.effects = [
    {
      id: "effect",
      operation: "email.send",
      provider: "google",
      status: "uncertain",
      approvalId: "approval",
      receipt: null,
      at: "2026-11-18T12:00:00Z",
    },
  ];
  fetchActivity.mockResolvedValue(data);
  saveVerification.mockRejectedValueOnce(new Error("offline"));
  await render();
  const happened = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === "Confirmed it happened",
  )!;
  expect(happened.disabled).toBe(true);
  expect(saveVerification).not.toHaveBeenCalled();
  await act(() => (document.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
  expect(happened.disabled).toBe(false);
  await act(() => happened.click());
  expect(saveVerification).toHaveBeenLastCalledWith("aldo-one", "conversation", {
    action: "receipt",
    id: "effect",
    outcome: "happened",
    checkedAccount: true,
  });
  expect(document.body.textContent).toContain("Couldn’t confirm your account check");
  expect(document.body.textContent).toContain("uncertain");
});
it("removes only the selected task email scope without sending a message", async () => {
  const data = example();
  data.mailGrants = [
    {
      id: "grant-one",
      recipients: ["person@example.invalid"],
      messageLimit: 2,
      expiresAt: "2026-11-25T12:00:00Z",
    },
  ];
  fetchActivity.mockResolvedValue(data);
  await render();
  expect(saveVerification).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("person@example.invalid");
  const remove = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Remove access",
  )!;
  await act(() => remove.click());
  expect(saveVerification).toHaveBeenLastCalledWith("aldo-one", "conversation", {
    action: "mail_revoke",
    id: "grant-one",
  });
  expect(document.body.textContent).toContain("Task email access");
});

it("validates recipients and requires refreshed access after a lost save response", async () => {
  const data = example();
  data.mailGrants = [];
  fetchActivity.mockResolvedValue(data);
  saveVerification.mockRejectedValueOnce(new Error("response lost"));
  await render();
  const form = [...document.querySelectorAll("form")].find((f) =>
    f.textContent?.includes("Allow task email"),
  )!;
  const submit = () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await act(() => {
    submit();
  });
  expect(document.body.textContent).toContain("valid email addresses");
  expect(saveVerification).not.toHaveBeenCalled();
  const input = form.querySelector("input")!;
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "person@example.invalid",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => {
    submit();
  });
  expect(saveVerification).toHaveBeenCalledWith("aldo-one", "conversation", {
    action: "mail_grant",
    recipients: ["person@example.invalid"],
    messages: 1,
  });
  expect(document.body.textContent).toContain("Couldn’t confirm email access");
  expect(input.disabled).toBe(true);
  fetchActivity.mockResolvedValue({ ...data, mailGrants: [] });
  const refresh = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === "Refresh recorded access",
  )!;
  await act(() => refresh.click());
  expect(input.disabled).toBe(false);
  expect(input.value).toBe("person@example.invalid");
});
