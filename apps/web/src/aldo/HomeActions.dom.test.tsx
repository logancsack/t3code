// @vitest-environment jsdom
import { act, createContext, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { BLOCKED_NOTE, homeActionsFixture } from "./homeActions.test-fixtures";
import { aldoDecisions } from "./decisions.logic";
import { needsYouKind } from "./home.logic";
import type { AldoHomePending } from "./homeApi";
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
// A choice row is named by its label; the line under it says what it does.
const button = (name: string) =>
  Array.from(el.querySelectorAll("button")).find(
    (b) => (b.querySelector("[data-aldo-choice-label]") ?? b).textContent?.trim() === name,
  )!;
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
    questionIds: ["scope"],
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
const sent = () => JSON.parse(backend.fetch.mock.calls[0]![1].body);
const JARGON = /holdout|provenance|unadmitted|coverage|dedicated account/i;

it("a thread that only waits is no card: with nothing to ask, nothing is shown", async () => {
  const waiting = home.conversations.find((c) => c.ref === "waiting")!;
  expect(waiting.summary).toBe(BLOCKED_NOTE);
  expect(needsYouKind(waiting)).toBeNull();
  expect(decisions.some((d) => "conversation" in d && d.conversation.ref === "waiting")).toBe(
    false,
  );
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
    questionIds: ["ask"],
    answers: { ask: "Aldo's included model usage (Recommended)" },
  });
  expect(useAldoReceipts.getState().receipts[0]?.text).toBe(
    "Answered “Aldo's included model usage” for Advisory comparisons",
  );
});

it("the board's form for a thread that only waits is empty, not a made-up question", async () => {
  const { PendingForm } = await import("./AldoHomeInbox");
  const waiting = home.conversations.find((c) => c.ref === "waiting")!;
  await act(async () => root.render(<PendingForm conversation={waiting} onActed={() => {}} />));
  expect(el.textContent).toBe("");
  expect(el.querySelector("button")).toBeNull();
});

it("no thread waiting on Home is left with only a text box", async () => {
  // A computer to start has its own card (AldoComputerRequest), as Up next leaves it out.
  const waits = decisions.filter((d) => d.kind === "question");
  expect(waits.map((d) => d.key.split(":")[1]).toSorted()).toEqual(["question", "turn-ask"]);
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
    // The recommended one's mark is black or white by the theme alone: nothing
    // worked out at runtime that a theme switch or a copied page can leave stale.
    const marked = choices.filter((b) => /Recommended|Aldo's pick/.test(b.textContent ?? ""));
    for (const b of marked) {
      const mark = b.querySelector("svg");
      expect(mark?.getAttribute("class"), d.key).toContain("text-black dark:text-white");
      expect(b.querySelector("[data-aldo-frame], [style*='--aldo-frame-ink']"), d.key).toBeNull();
    }
    expect(marked.length, d.key).toBeGreaterThan(0);
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
const explained = (
  explain: NonNullable<Extract<AldoHomePending, { kind: "approval" }>["explain"]>,
  detail: string,
) => {
  const base = decisions.find((d) => d.kind === "approval")!;
  if (base.kind !== "approval") throw new Error("Approval fixture missing");
  return {
    ...base,
    key: `${base.key}:explained`,
    pending: {
      ...base.pending,
      summary: "Approval requested",
      detail,
      requestKind: "command",
      explain,
    },
  };
};
const mountDecision = async (d: ReturnType<typeof explained>) =>
  act(async () =>
    root.render(
      <DecisionCard key={d.key} decision={d} now={Date.now()} pick={null} open onOpen={() => {}} />,
    ),
  );

it("an approval says what the step is, why, whether it's safe and which answer Aldo recommends, with the raw command behind Details", async () => {
  await mountDecision(
    explained(
      {
        what: "Run a command that reads",
        why: "The agent is looking at its workspace.",
        safety: {
          level: "safe",
          text: "It looks like it only reads or lists things. Nothing is changed.",
        },
        recommended: "accept",
      },
      "git status --short",
    ),
  );
  expect(el.querySelector("h4")?.textContent).toBe("Run a command that reads?");
  expect(el.textContent).toContain("The agent is looking at its workspace.");
  expect(el.textContent).toContain("Safe to allow.");
  expect(el.textContent).not.toMatch(/Approval requested|git status/);
  // The recommended answer is first, and marked on its own button.
  const choices = Array.from(el.querySelectorAll("button")).filter((b) =>
    b.className.includes("justify-between"),
  );
  expect(choices.map((b) => b.textContent)).toEqual(["AllowRecommended", "Don't allow"]);
  // The command is one tap away, not in the way.
  await act(async () => button("Details").click());
  expect(el.textContent).toContain("git status --short");
  await act(async () => button("AllowRecommended").click());
  expect(JSON.parse(backend.fetch.mock.calls[0]![1].body)).toMatchObject({
    action: "answer",
    decision: "accept",
  });
});

it("an approval that could do harm recommends not allowing it, and says why in plain words", async () => {
  await mountDecision(
    explained(
      {
        what: "Run a command that looks like it force-pushes code, overwriting work in a remote repository",
        why: "This thread asks before it runs commands.",
        safety: {
          level: "risky",
          text: "It can overwrite published work, which can't easily be undone. Allow it only if you asked for something like this.",
        },
        recommended: "decline",
      },
      "git push --force origin main",
    ),
  );
  expect(el.textContent).toContain("Be careful.");
  const choices = Array.from(el.querySelectorAll("button")).filter((b) =>
    b.className.includes("justify-between"),
  );
  expect(choices.map((b) => b.textContent)).toEqual(["Don't allowRecommended", "Allow"]);
  expect(el.textContent).not.toMatch(/force origin|git push/);
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
  ["confirm", "Allow"],
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
    expect(JSON.parse(backend.fetch.mock.calls[0]![1].body)).toEqual({
      decision: "approve",
      seen: "",
    });
  },
);
it.each(["email", "event"])("discards a %s through its existing approval route", async (kind) => {
  await mount("aldo-approval", kind);
  await act(async () => button("Discard").click());
  expect(JSON.parse(backend.fetch.mock.calls[0]![1].body)).toEqual({
    decision: "discard",
    seen: "",
  });
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

it("keeps a failed thread’s technical report behind Details beside its original retry action", async () => {
  const found = decisions.find((d) => d.kind === "failed")!;
  if (found.kind !== "failed") throw new Error("Failed fixture missing");
  const d = {
    ...found,
    conversation: {
      ...found.conversation,
      summary: "The agent reports CI failed. Type checking and lint passed.",
    },
  };
  await act(async () =>
    root.render(<DecisionCard decision={d} now={Date.now()} open onOpen={() => {}} pick={null} />),
  );
  const details = el.querySelector("details")!;
  expect(details.open).toBe(false);
  expect(el.textContent).toContain("I couldn’t finish this attempt.");
  expect(details.textContent).toContain("The agent reports CI failed.");
  await act(async () => details.querySelector("summary")!.click());
  expect(details.open).toBe(true);
  expect(button("Retry")).toBeDefined();
});

it("uses the current Home-written failure summary with the retry card", async () => {
  const { useAldoAssistant } = await import("./assistantSession");
  const previous = useAldoAssistant.getState().entries;
  const d = decisions.find((d) => d.kind === "failed")!;
  if (d.kind !== "failed") throw new Error("Failed fixture missing");
  const summary = "I couldn’t reach the supplier’s website. The draft is saved.";
  useAldoAssistant.setState({
    entries: [
      {
        kind: "message",
        role: "assistant",
        at: new Date().toISOString(),
        text: summary,
        update: {
          id: "failure",
          title: d.conversation.title,
          thread: d.conversation.thread,
          state: "failed",
          summary,
          checked: [],
          notChecked: [],
          notes: ["The saved draft is ready to retry."],
          links: [{ label: "Change evidence", url: "https://github.com/acme/guide/pull/7" }],
        },
      },
    ],
  });
  try {
    await act(async () =>
      root.render(
        <DecisionCard decision={d} now={Date.now()} pick={null} open onOpen={() => {}} />,
      ),
    );
    expect(el.textContent).toContain(summary);
    expect(el.textContent).not.toContain("I couldn’t finish this attempt.");
    expect(el.querySelector("details")?.textContent).toContain(
      "The saved draft is ready to retry.",
    );
    expect(el.querySelector("details a")?.getAttribute("href")).toBe(
      "https://github.com/acme/guide/pull/7",
    );
  } finally {
    await act(async () => useAldoAssistant.setState({ entries: previous }));
  }
});

it.each(["272 deterministic reliability checks passed.", "I’ve prepared the draft."])(
  "keeps supplementary notes in Details beside the real question and choices: %s",
  async (note) => {
    const found = decisions.find((d) => d.kind === "question")!;
    if (found.kind !== "question") throw new Error("Question fixture missing");
    const question = found.pending.questions[0]!.question;
    const d = {
      ...found,
      conversation: {
        ...found.conversation,
        summary: `${question} ${note}`,
      },
    };
    await act(async () =>
      root.render(
        <DecisionCard decision={d} now={Date.now()} pick={null} open onOpen={() => {}} />,
      ),
    );
    expect(el.textContent).toContain(question);
    const details = el.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(
      [...el.querySelectorAll("p")]
        .filter((p) => !p.closest("details"))
        .map((p) => p.textContent)
        .join(" "),
    ).not.toContain(note);
    await act(async () => details.querySelector("summary")!.click());
    expect(details.open).toBe(true);
    expect(details.textContent).toContain(note);
    const label = found.pending.questions[0]!.options[0]!.label.replace(/\s*\(recommended\)/i, "");
    expect([...el.querySelectorAll("button")].some((b) => b.textContent?.includes(label))).toBe(
      true,
    );
  },
);

it("a bare blocked report with no question is no card, whatever its notes say", () => {
  const base = home.conversations.find((c) => c.ref === "waiting")!;
  const c = {
    ...base,
    title: "Learn from Grok Bot",
    summary: "I need your decision before I can finish.",
    result: {
      state: "blocked_on_user" as const,
      doneWhen: [
        {
          criterion: "Run Grok tasks",
          met: false,
          evidence: "Grok needs Premium; payment was declined and the account shows Free.",
        },
      ],
      checked: [],
      notChecked: [],
      decided: [],
    },
  };
  expect(needsYouKind(c)).toBeNull();
  expect(
    aldoDecisions({ ...home, conversations: [c] }, Date.now()).filter((d) => "conversation" in d),
  ).toEqual([]);
});

it("an old server's generic made-up question is no card either", () => {
  const base = home.conversations.find((c) => c.ref === "turn-ask")!;
  for (const question of [
    "I need your decision before I can finish.",
    "I haven't recorded what I need from you to finish “Learn from Grok Bot”.",
  ]) {
    const c = {
      ...base,
      title: "Learn from Grok Bot",
      pending: {
        kind: "question" as const,
        requestId: "ask:old",
        questions: [
          {
            id: "ask",
            header: "",
            question,
            options: [
              { label: "Explain exactly what you need from me (Recommended)", description: "" },
              { label: "Finish only the parts you can do without me", description: "" },
            ],
            multiSelect: false,
          },
        ],
      },
    };
    expect(needsYouKind(c), question).toBeNull();
    expect(
      aldoDecisions({ ...home, conversations: [c] }, Date.now()).filter((d) => "conversation" in d),
      question,
    ).toEqual([]);
  }
});

it("a changed decision refreshes without an approval receipt or a dead-end error", async () => {
  await mount("plan");
  backend.fetch.mockResolvedValueOnce(
    Response.json(
      { error: "The request changed. Review what it asks now.", decisionChanged: true },
      { status: 409 },
    ),
  );
  await act(async () => button("Approve the plan").click());
  expect(el.querySelector('[role="alert"]')).toBeNull();
  expect(el.textContent).toContain("This request changed. Review it before choosing.");
  expect(useAldoReceipts.getState().receipts).toHaveLength(0);
  expect(backend.toast).not.toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
});
