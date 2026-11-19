import type { AldoApproval, AldoHome, AldoHomeConversation, AldoHomePullRequest } from "./homeApi";

/** An agent's own words for what it's blocked on, as a turn ended with them (never a card's text). */
export const BLOCKED_NOTE =
  "Dedicated account remains unspecified. Private holdouts and provenance are prepared but unadmitted; production reports unavailable coverage.";

const blocked: NonNullable<AldoHomeConversation["result"]> = {
  state: "blocked_on_user",
  doneWhen: [{ criterion: "Run live model comparisons", met: false, evidence: BLOCKED_NOTE }],
  checked: [],
  notChecked: [],
  decided: [],
};

export function homeActionsFixture(now = Date.now()): AldoHome {
  const at = new Date(now - 8 * 60_000).toISOString();
  const conversation = (
    ref: string,
    title: string,
    over: Partial<AldoHomeConversation> = {},
  ): AldoHomeConversation => ({
    ref,
    title,
    thread: { environmentId: `aldo-${ref}`, threadId: `c-${ref}` },
    repos: [],
    branch: "aldo/test",
    state: "waiting",
    machine: "running",
    at,
    ...over,
  });
  const approval = (
    kind: AldoApproval["kind"],
    title: string,
    body: string,
    fields: AldoApproval["fields"],
    approveLabel: string,
  ): AldoApproval => ({
    id: kind,
    kind,
    title,
    body,
    fields,
    approveLabel,
    discardLabel: kind === "confirm" ? "Don’t" : "Discard",
    summary: fields.map((f) => f.value).join(" · "),
    provider: kind === "email" || kind === "event" ? "google" : null,
    status: "pending",
    result: null,
    failed: false,
    thread: null,
    threadTitle: null,
    createdAt: at,
    decidedAt: null,
    ...(kind === "confirm" ? { reasons: ["Too expensive", "Bad timing"] } : {}),
  });
  const release = conversation("release", "Home action cards", {
    progress: {
      execution: "replied",
      verdict: "finished",
      next: { owner: "you", kind: "release" },
      label: "Release held for you",
      detail: "Waiting for your merge decision.",
    },
  });
  const pr: AldoHomePullRequest = {
    environmentId: release.thread.environmentId,
    thread: release.thread,
    threadTitle: release.title,
    repo: "logancsack/aldo",
    number: 123,
    title: "Show real actions on Home",
    url: "https://github.com/logancsack/aldo/pull/123",
    status: "watching",
    stage: "green",
    checks: { passed: 6, failed: 0, running: 0 },
    deploy: null,
    followups: 0,
    reviewsExhausted: false,
    greenSince: at,
    mergesAt: null,
    held: true,
    mergedAt: null,
    updatedAt: at,
  };
  return {
    at: new Date(now).toISOString(),
    conversations: [
      conversation("question", "Choose the rollout", {
        pending: {
          kind: "question",
          requestId: "rollout",
          questions: [
            {
              id: "scope",
              header: "Rollout",
              question: "Who should try the change first?",
              multiSelect: false,
              options: [
                {
                  label: "Only my account (Recommended)",
                  description: "Check the live change before opening it to everyone.",
                },
                { label: "Everyone", description: "Make the change available to every account." },
              ],
            },
          ],
        },
      }),
      conversation("plan", "Prepare the launch", {
        plan: {
          id: "launch-plan",
          text: "# Launch plan\n\nUpdate Home, check the actions on phone and desktop, then hold the release for your review.\n\n## Checks\n- Exercise every action against seeded items.\n- Check light and dark themes.\n- Keep the change held until you approve it.",
        },
      }),
      conversation("approval", "Run the checks", {
        pending: {
          kind: "approval",
          requestId: "command",
          summary: "Allow the agent to run the local checks?",
          detail: "pnpm typecheck && pnpm lint\nRuns inside the thread’s computer.",
          options: [
            { decision: "accept", label: "Allow" },
            { decision: "decline", label: "Decline" },
          ],
        },
      }),
      conversation("handoff", "Sign in to the supplier", {
        pending: {
          kind: "handoff",
          requestId: "supplier-code",
          summary: "The supplier sent a code to your phone.",
        },
      }),
      conversation("failed", "Check the deployment", {
        state: "failed",
        canRetry: true,
        summary: "The deployment check lost its connection. No automatic retry is scheduled.",
      }),
      // From an older Aldo: a turn that ended blocked, with only the agent's notes.
      conversation("waiting", "Plan: production-grade agent practices for Aldo", {
        summary: BLOCKED_NOTE,
        result: blocked,
      }),
      // From Aldo now: the same turn, asked in plain words (`ask:` + its turn).
      conversation("turn-ask", "Advisory comparisons", {
        summary: "Which account should the live model comparisons use?",
        result: blocked,
        pending: {
          kind: "question",
          requestId: "ask:turn-9",
          questions: [
            {
              id: "ask",
              header: "",
              question: "Which account should the live model comparisons use?",
              multiSelect: false,
              options: [
                { label: "Aldo's included model usage (Recommended)", description: "" },
                { label: "A separate subscription account", description: "" },
                { label: "Skip comparisons for now", description: "" },
              ],
            },
          ],
        },
      }),
      conversation("paused", "Finish the report", { state: "working", machine: "asleep" }),
      ...(["windows", "gpu"] as const).map((computer) =>
        conversation(
          computer,
          computer === "windows" ? "Refresh the workbook" : "Render the final frames",
          {
            computers: [
              {
                computer,
                status: "asked",
                askedAt: at,
                creditsPerHour: computer === "windows" ? 90 : 310,
                why:
                  computer === "windows"
                    ? "Excel needs to refresh the workbook’s Power Query connections."
                    : "Render the final Blender frames on the RTX 4090.",
                forAccount: true,
              },
            ],
          },
        ),
      ),
      release,
    ],
    pullRequests: [pr],
    upcoming: [],
    actions: [],
    approvals: [
      approval(
        "email",
        "Launch update",
        "Hi Alex,\n\nThe Home update is ready for your review. Every waiting item now shows its actions in place.\n\nPlease check the preview before we release it.\n\nLogan",
        [{ label: "To", value: "alex@example.com" }],
        "Send",
      ),
      approval(
        "event",
        "Review the Home update",
        "Walk through the new action cards on phone and desktop.",
        [
          { label: "When", value: "Tomorrow, 2:00 PM – 2:30 PM" },
          { label: "Invites", value: "alex@example.com" },
        ],
        "Add to calendar",
      ),
      approval(
        "confirm",
        "Buy the reference book",
        "One printed copy for the project. No subscription or renewal.",
        [
          { label: "Where", value: "Example Books" },
          { label: "Total", value: "$24.00 including delivery" },
          { label: "Terms", value: "Return within 30 days. No renewal." },
        ],
        "Approve $24.00",
      ),
      {
        ...approval(
          "confirm",
          "Ship the Home update",
          "The preview is ready for your review. Approving lets Aldo carry on with checks and release it under your existing permissions.\n\n[View result](https://example.com/home-preview)",
          [
            { label: "Result", value: "Phone and desktop preview ready" },
            { label: "Scope", value: "Release the Home action-card update" },
          ],
          "Approve and ship",
        ),
        id: "result-review",
        discardLabel: "Keep held",
      },
      approval(
        "start",
        "Check the launch page",
        "Open the launch page, check the links and report anything that stops people signing up.",
        [{ label: "Cost", value: "Your connected plan; computer credits apply" }],
        "Start",
      ),
    ],
    payments: [
      {
        id: "payment",
        merchant: "Example Books",
        site: "books.example.com",
        total: "$24.00",
        items: [{ name: "Reference book", quantity: 1, price: "$24.00" }],
        context: "One printed copy. No renewal. Return within 30 days.",
        status: "pending_approval",
        approvalUrl: "https://example.com/review-payment",
        expiresAt: new Date(now + 25 * 60_000).toISOString(),
        cardLast4: null,
        test: true,
        thread: null,
        threadTitle: null,
        createdAt: at,
        updatedAt: at,
      },
    ],
    handoffs: [
      {
        id: "supplier-code",
        kind: "code",
        reason: "The supplier sent a code to your phone.",
        how: "Type the code so Aldo can finish signing in.",
        site: "supplier.example.com",
        url: "https://supplier.example.com/sign-in",
        seconds: 30,
        thread: { environmentId: "aldo-handoff", threadId: "c-handoff" },
        threadTitle: "Sign in to the supplier",
        createdAt: at,
        expiresAt: new Date(now + 30 * 60_000).toISOString(),
      },
    ],
    usage: {
      configured: true,
      metered: false,
      plan: null,
      period: null,
      credits: null,
      bill: null,
      alert: "none",
      agents: { running: 0, limit: null },
    },
    spends: { once: 0, monthly: 0, recent: [] },
    health: { providers: [], connected: [], environments: [] },
    policy: { everywhere: {}, workspaces: [] },
  };
}
