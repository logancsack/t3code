// @vitest-environment jsdom
import { act, createContext, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { BLOCKED_NOTE, homeActionsFixture } from "./homeActions.test-fixtures";
import { aldoDecisions } from "./decisions.logic";
import { DecisionCard } from "./AldoUpNext";
import { useAldoReceipts } from "./receipts";
const backend = vi.hoisted(() => ({ fetch: vi.fn(), toast: vi.fn() }));
vi.mock("../components/ui/toast", () => ({ toastManager: { add: backend.toast } }));
vi.mock("./AldoBrief", () => ({ DecisionIcon: () => null, confirmQuickChoice: async () => true }));
vi.mock("./AldoLiveCard", () => ({ AldoOpenContext: createContext(null) }));
vi.mock("./AldoHomeInbox", async (original) => ({
  ...(await original<typeof import("./AldoHomeInbox")>()),
  ThreadLink: ({ children }: { children: ReactNode }) => <a href="#thread">{children}</a>,
  askAldoAbout: vi.fn(),
}));
vi.mock("./AldoFrame", () => ({ AldoFrame: () => null }));
vi.mock("./presenceReactions", () => ({ completeAldo: vi.fn() }));
vi.mock("./AldoQuoted", () => ({
  AgentMarkdown: ({ text }: { text: string }) => <p>{text}</p>,
  Quoted: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("./homeFeed", () => ({
  refreshAldoHome: async () => {},
  sendAldoAnswer: (_c: unknown, send: () => Promise<unknown>) => send(),
  sendAldoApproval: async (a: { id: string }, decision: "approve" | "discard" | "always") => {
    const { decideAldoApproval } = await import("./homeApi");
    return decideAldoApproval(a.id, decision);
  },
  useAldoHomeFeed: (select: (s: { home: null }) => unknown) => select({ home: null }),
}));
let root: Root;
let el: HTMLDivElement;
const home = homeActionsFixture();
const decisions = aldoDecisions(home, Date.now());
const button = (name: string) =>
  Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.trim() === name)!;
const mount = async (kind: string, approvalKind?: string, ref?: string) => {
  const d = decisions.find(
    (d) =>
      d.kind === kind &&
      (!approvalKind || (d.kind === "aldo-approval" && d.approval.kind === approvalKind)) &&
      (!ref || ("conversation" in d && d.conversation.ref === ref)),
  )!;
  await act(async () =>
    root.render(
      <DecisionCard key={d.key} decision={d} now={Date.now()} pick={null} open onOpen={() => {}} />,
    ),
  );
  return d;
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", backend.fetch);
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  backend.fetch.mockReset();
  backend.toast.mockReset();
  useAldoReceipts.setState({ receipts: [] });
  backend.fetch.mockImplementation(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    return Response.json({
      status: "answered",
      approval: {
        ...home.approvals![0],
        status: body.decision === "discard" ? "discarded" : "approved",
      },
      message: "Decision received",
    });
  });
});
afterEach(() => {
  act(() => root.unmount());
  el.remove();
  vi.unstubAllGlobals();
});
it("keeps the question visible while sending, prevents repeat taps and records success only after acceptance", async () => {
  let finish!: (r: Response) => void;
  backend.fetch.mockReturnValue(
    new Promise<Response>((r) => {
      finish = r;
    }),
  );
  await mount("question", undefined, "question");
  expect(el.textContent).toContain("Recommended");
  const choose = button("Only my accountRecommended");
  // The visible recommendation is separate from the submitted option label.
  const choice =
    choose ??
    Array.from(el.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Only my account"),
    )!;
  await act(async () => {
    choice.click();
    choice.click();
  });
  expect(backend.fetch).toHaveBeenCalledTimes(1);
  expect(el.querySelector('[role="status"]')?.textContent).toBe("Sending…");
  expect(useAldoReceipts.getState().receipts).toHaveLength(0);
  expect(JSON.parse(backend.fetch.mock.calls[0]![1].body)).toEqual({
    action: "answer",
    t3ThreadId: "c-question",
    requestId: "rollout",
    answers: { scope: "Only my account (Recommended)" },
  });
  await act(async () => finish(Response.json({ status: "answered" })));
  expect(useAldoReceipts.getState().receipts[0]?.text).toContain("Answered");
});
it.each([
  ["plan", "Approve the plan", "approve_plan"],
  ["approval", "Allow", "answer"],
  ["failed", "Retry", "continue"],
] as const)("%s uses the thread action route", async (kind, label, action) => {
  await mount(kind);
  await act(async () => button(label).click());
  const [url, init] = backend.fetch.mock.calls[0]!;
  expect(url).toBe(`/api/environments/${kind}/actions`);
  expect(JSON.parse(init.body).action).toBe(action);
  expect(useAldoReceipts.getState().receipts).toHaveLength(1);
});
it("requests plan changes without approving it", async () => {
  await mount("plan");
  await act(async () => button("Request changes").click());
  const input = el.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Check my account first",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    el
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(JSON.parse(backend.fetch.mock.calls[0]![1].body)).toMatchObject({
    action: "approve_plan",
    planId: "launch-plan",
    changes: "Check my account first",
  });
});
const type = async (text: string) => {
  const input = el.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    el
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  return input;
};
const sent = () => JSON.parse(backend.fetch.mock.calls[0]![1].body);
const JARGON = /holdout|provenance|unadmitted|coverage|dedicated account/i;

it("a thread that only waits asks in plain words with choices to tap, never its notes or a bare text box", async () => {
  const d = await mount("waiting");
  expect(d.kind === "waiting" && d.conversation.summary).toBe(BLOCKED_NOTE);
  expect(el.querySelector("h4")?.textContent).toBe(
    "It needs a decision from you before it can finish.",
  );
  expect(el.textContent).not.toMatch(JARGON);
  // Choices first, the recommended one marked; typing only once asked for.
  expect(el.querySelector("input")).toBeNull();
  expect(button("Let it decide and carry onRecommended")).toBeDefined();
  expect(button("Something else…")).toBeDefined();
  expect(el.textContent).toContain("View result");
  expect(el.textContent).toContain("Ask Aldo about it");
  await act(async () => button("Stop here").click());
  expect(backend.fetch.mock.calls[0]![0]).toBe("/api/environments/waiting/messages");
  expect(sent()).toEqual({
    t3ThreadId: "c-waiting",
    text: "Stop here, and don't carry on with this task.",
  });
  expect(useAldoReceipts.getState().receipts).toHaveLength(1);
});

it("a waiting card's own words reply to the thread, kept on failure without claiming success", async () => {
  backend.fetch.mockResolvedValue(
    Response.json({ error: "Couldn't keep the reply. Try again." }, { status: 503 }),
  );
  await mount("waiting");
  await act(async () => button("Something else…").click());
  const input = await type("Use my test account");
  expect(backend.fetch.mock.calls[0]![0]).toBe("/api/environments/waiting/messages");
  expect(sent().text).toBe("Use my test account");
  expect(el.querySelector('[role="alert"]')?.textContent).toContain("Couldn't keep the reply");
  expect(input.value).toBe("Use my test account");
  expect(useAldoReceipts.getState().receipts).toHaveLength(0);
});

it("a turn's own ask is its question, answered with a tap, its notes behind View result", async () => {
  await mount("question", undefined, "turn-ask");
  expect(el.querySelector("h4")?.textContent).toBe(
    "Which account should the live model comparisons use?",
  );
  expect(el.textContent).not.toMatch(JARGON);
  expect(el.querySelector("input")).toBeNull();
  expect(el.textContent).toContain("View result");
  await act(async () => button("Aldo's included model usageRecommended").click());
  expect(sent()).toEqual({
    action: "answer",
    t3ThreadId: "c-turn-ask",
    requestId: "ask:turn-9",
    answers: { ask: "Aldo's included model usage (Recommended)" },
  });
  expect(useAldoReceipts.getState().receipts[0]?.text).toBe(
    "Answered “Aldo's included model usage” for Advisory comparisons",
  );
});

it("the board's form for a thread that only waits answers with a tap, as a reply", async () => {
  const { PendingForm } = await import("./AldoHomeInbox");
  const d = decisions.find((d) => d.kind === "waiting" && d.conversation.ref === "waiting")!;
  if (d.kind !== "waiting") throw new Error("Waiting fixture missing");
  await act(async () =>
    root.render(<PendingForm conversation={d.conversation} onActed={() => {}} />),
  );
  expect(el.textContent).toContain("It needs a decision from you before it can finish.");
  expect(el.textContent).not.toMatch(JARGON);
  await act(async () => button("Skip that part").click());
  expect(backend.fetch.mock.calls[0]![0]).toBe("/api/environments/waiting/messages");
  expect(sent().text).toBe("Skip the part you needed me for and finish the rest.");
});

it("no thread waiting on Home is left with only a text box", async () => {
  // A computer to start has its own card (AldoComputerRequest), as Up next leaves it out.
  const waits = decisions.filter(
    (d) =>
      (d.kind === "waiting" && !d.conversation.computers?.some((c) => c.status === "asked")) ||
      d.kind === "question",
  );
  expect(waits.map((d) => d.key.split(":")[1]).toSorted()).toEqual([
    "question",
    "turn-ask",
    "waiting",
  ]);
  for (const d of waits) {
    // A key of its own: no words kept from another test's card.
    const fresh = { ...d, key: `${d.key}:fresh` };
    await act(async () =>
      root.render(
        <DecisionCard
          key={fresh.key}
          decision={fresh}
          now={Date.now()}
          pick={null}
          open
          onOpen={() => {}}
        />,
      ),
    );
    const choices = Array.from(el.querySelectorAll("button")).filter((b) =>
      b.className.includes("justify-between"),
    );
    expect(choices.length, d.key).toBeGreaterThanOrEqual(2);
    expect(choices.length, d.key).toBeLessThanOrEqual(4);
    expect(el.querySelector("input"), d.key).toBeNull();
    expect(el.textContent, d.key).not.toMatch(JARGON);
  }
});

it.each([
  ["email", "Send"],
  ["event", "Add to calendar"],
] as const)("%s uses the saved approval and waits for the server result", async (kind, label) => {
  await mount("aldo-approval", kind);
  await act(async () => button(label).click());
  expect(backend.fetch.mock.calls[0]![0]).toBe(`/api/approvals/${kind}`);
  expect(useAldoReceipts.getState().receipts[0]?.text).toBe("Decision received");
});
it("a refused command approval stays actionable with the actual reason", async () => {
  backend.fetch.mockResolvedValue(
    Response.json({ error: "This request was replaced." }, { status: 409 }),
  );
  await mount("approval");
  await act(async () => button("Allow").click());
  expect(el.querySelector('[role="alert"]')?.textContent).toBe("This request was replaced.");
  expect(button("Allow").disabled).toBe(false);
  expect(useAldoReceipts.getState().receipts).toHaveLength(0);
});

it.each([
  ["confirm", "Approve $24.00"],
  ["start", "Start"],
] as const)(
  "%s approval submits through the full card without losing its terms",
  async (kind, label) => {
    await mount("aldo-approval", kind);
    await act(async () => {
      await import("./AldoApprovalCard");
    });
    if (kind === "confirm") expect(el.textContent).toContain("Return within 30 days");
    await act(async () => button(label).click());
    expect(backend.fetch.mock.calls[0]![0]).toBe(`/api/approvals/${kind}`);
    expect(JSON.parse(backend.fetch.mock.calls[0]![1].body)).toEqual({ decision: "approve" });
  },
);
it.each(["email", "event"])("discards a %s through its existing approval route", async (kind) => {
  await mount("aldo-approval", kind);
  await act(async () => button("Discard").click());
  expect(JSON.parse(backend.fetch.mock.calls[0]![1].body)).toEqual({ decision: "discard" });
});

it("submits several selected answers through the same request without a one-choice shortcut", async () => {
  const original = decisions.find((d) => d.kind === "question")!;
  if (original.kind !== "question") throw new Error("Question fixture missing");
  const d = {
    ...original,
    key: "question:multi",
    pending: {
      ...original.pending,
      requestId: "multi",
      questions: [
        {
          id: "format",
          header: "Files",
          question: "Which files?",
          multiSelect: true,
          options: [
            { label: "PDF", description: "" },
            { label: "Workbook", description: "" },
          ],
        },
      ],
    },
  };
  d.conversation = { ...d.conversation, pending: d.pending };
  await act(async () =>
    root.render(<DecisionCard decision={d} now={Date.now()} pick={null} open onOpen={() => {}} />),
  );
  await act(async () => {
    button("PDF").click();
    button("Workbook").click();
  });
  expect(backend.fetch).not.toHaveBeenCalled();
  await act(async () =>
    el
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(JSON.parse(backend.fetch.mock.calls[0]![1].body)).toMatchObject({
    action: "answer",
    requestId: "multi",
    answers: { format: ["PDF", "Workbook"] },
  });
});

it("retries against older servers through the existing message route", async () => {
  const d = decisions.find((d) => d.kind === "failed")!;
  if (d.kind !== "failed") throw new Error("Failed fixture missing");
  const { canRetry: _capability, ...conversation } = d.conversation;
  await act(async () =>
    root.render(
      <DecisionCard
        decision={{ ...d, conversation }}
        now={Date.now()}
        pick={null}
        open
        onOpen={() => {}}
      />,
    ),
  );
  await act(async () => button("Retry").click());
  expect(backend.fetch.mock.calls[0]![0]).toBe("/api/environments/failed/messages");
  expect(JSON.parse(backend.fetch.mock.calls[0]![1].body).text).toBe(
    "Carry on where you left off.",
  );
});

it("keeps an approval open when a successful HTTP response says the effect is still pending", async () => {
  backend.fetch.mockResolvedValue(
    Response.json({
      approval: { ...home.approvals![0], status: "pending", failed: true },
      message: "The draft could not be sent. It is still pending.",
    }),
  );
  await mount("aldo-approval", "email");
  await act(async () => button("Send").click());
  expect(el.querySelector('[role="alert"]')?.textContent).toContain("could not be sent");
  expect(useAldoReceipts.getState().receipts).toHaveLength(0);
  expect(button("Send").disabled).toBe(false);
});
it("a handoff whose details have not arrived still has a direct way into the request", async () => {
  await mount("handoff");
  expect(el.textContent).toContain("Open browser request");
});
