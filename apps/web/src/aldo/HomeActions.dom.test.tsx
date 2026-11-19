// @vitest-environment jsdom
import { act, createContext, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { homeActionsFixture } from "./homeActions.test-fixtures";
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
const mount = async (kind: string, approvalKind?: string) => {
  const d = decisions.find(
    (d) =>
      d.kind === kind &&
      (!approvalKind || (d.kind === "aldo-approval" && d.approval.kind === approvalKind)),
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
  await mount("question");
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
it("a prose blocker replies to the thread, preserves words on failure and never claims it succeeded", async () => {
  backend.fetch.mockResolvedValue(
    Response.json({ error: "Couldn't keep the reply. Try again." }, { status: 503 }),
  );
  await mount("waiting");
  expect(el.textContent).toContain("Choose the dedicated subscription account");
  const input = el.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Use my test account",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    el
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(backend.fetch.mock.calls[0]![0]).toBe("/api/environments/waiting/messages");
  expect(el.querySelector('[role="alert"]')?.textContent).toContain("Couldn't keep the reply");
  expect(input.value).toBe("Use my test account");
  expect(useAldoReceipts.getState().receipts).toHaveLength(0);
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
