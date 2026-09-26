/**
 * The landing demo served as a hub (`?aldoDemo=1&aldoDemoHub=1`): repository
 * and blank projects, and threads whose machines are running, starting,
 * asleep, and failed. Browser-local data only; nothing here reaches a server.
 */
import {
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationProjectShell,
  type OrchestrationThread,
  type SourceControlDiscoveryResult,
  type SourceControlRepositorySummary,
  type ThreadMachineStatus,
  type VcsListRefsResult,
} from "@t3tools/contracts";
import * as Option from "effect/Option";

const MINUTE_MS = 60_000;

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * MINUTE_MS).toISOString();
}

export const hubDemoBlankProjectId = ProjectId.make("aldo-demo-scratchpad");

export function hubDemoProjects(
  primary: OrchestrationProjectShell,
): ReadonlyArray<OrchestrationProjectShell> {
  return [
    {
      ...primary,
      workspaceRoot: `/workspace/p/${primary.id}`,
      repositoryIdentity: {
        canonicalKey: "github.com/aldo-demo/northstar",
        locator: {
          source: "git-remote",
          remoteName: "origin",
          remoteUrl: "https://github.com/aldo-demo/northstar",
        },
        displayName: "aldo-demo/northstar",
        provider: "github",
        owner: "aldo-demo",
        name: "northstar",
      },
    },
    {
      ...primary,
      id: hubDemoBlankProjectId,
      title: "Scratchpad",
      workspaceRoot: `/workspace/p/${hubDemoBlankProjectId}`,
      repositoryIdentity: null,
    },
  ];
}

export interface HubDemoThread {
  readonly thread: OrchestrationThread;
  readonly machine: ThreadMachineStatus;
}

function userMessage(threadId: string, text: string, createdAt: string, turnId: TurnId) {
  return {
    id: MessageId.make(`${threadId}-user`),
    role: "user" as const,
    text,
    attachments: [],
    turnId,
    streaming: false,
    createdAt,
    updatedAt: createdAt,
  };
}

/** Threads beside the demo's own, one per machine state worth seeing. */
export function hubDemoThreads(base: OrchestrationThread): ReadonlyArray<HubDemoThread> {
  const make = (input: {
    readonly id: string;
    readonly title: string;
    readonly branch: string;
    readonly minutesAgo: number;
    readonly prompt: string;
    readonly reply: string | null;
    readonly turnState: "running" | "completed" | "error";
    readonly sessionStatus: "running" | "ready" | "error";
    readonly lastError?: string;
    readonly activities?: OrchestrationThread["activities"];
    readonly machine: Omit<ThreadMachineStatus, "updatedAt">;
  }): HubDemoThread => {
    const threadId = ThreadId.make(input.id);
    const turnId = TurnId.make(`${input.id}-turn`);
    const requestedAt = isoMinutesAgo(input.minutesAgo);
    const completedAt = input.turnState === "running" ? null : isoMinutesAgo(input.minutesAgo - 1);
    const replyId = MessageId.make(`${input.id}-reply`);
    return {
      machine: { ...input.machine, updatedAt: requestedAt },
      thread: {
        ...base,
        id: threadId,
        title: input.title,
        branch: input.branch,
        worktreePath: `/workspace/t/${input.id}`,
        createdAt: requestedAt,
        updatedAt: completedAt ?? requestedAt,
        messages: [
          userMessage(input.id, input.prompt, requestedAt, turnId),
          ...(input.reply && completedAt
            ? [
                {
                  id: replyId,
                  role: "assistant" as const,
                  text: input.reply,
                  turnId,
                  streaming: false,
                  createdAt: completedAt,
                  updatedAt: completedAt,
                },
              ]
            : []),
        ],
        activities: input.activities ?? [],
        latestTurn: {
          turnId,
          state: input.turnState,
          requestedAt,
          startedAt: requestedAt,
          completedAt,
          assistantMessageId: input.reply && completedAt ? replyId : null,
        },
        session: base.session
          ? {
              ...base.session,
              threadId,
              status: input.sessionStatus,
              activeTurnId: input.turnState === "running" ? turnId : null,
              lastError: input.lastError ?? null,
              updatedAt: completedAt ?? requestedAt,
            }
          : null,
      },
    };
  };

  return [
    make({
      id: "aldo-demo-login-redirect",
      title: "Fix the login redirect loop",
      branch: "aldo/fix-login-redirect",
      minutesAgo: 0.4,
      prompt: "Signing in on Safari bounces back to /login forever. Find out why and fix it.",
      reply: null,
      turnState: "running",
      sessionStatus: "running",
      machine: { state: "starting", detail: "Cloning aldo-demo/northstar" },
    }),
    make({
      id: "aldo-demo-pricing",
      title: "Add a pricing page",
      branch: "aldo/pricing-page",
      minutesAgo: 95,
      prompt: "Add a pricing page with three tiers and a monthly/yearly toggle.",
      reply:
        "Added `pricing.html` with Starter, Team, and Enterprise tiers, a monthly/yearly toggle, and a link from the nav. The build and lint both pass.",
      turnState: "completed",
      sessionStatus: "ready",
      machine: { state: "paused", detail: null },
    }),
    make({
      id: "aldo-demo-react-upgrade",
      title: "Upgrade the site to React 20",
      branch: "aldo/react-20",
      minutesAgo: 12,
      prompt: "Upgrade the marketing site to React 20 and fix anything that breaks.",
      reply: null,
      turnState: "error",
      sessionStatus: "error",
      lastError: "Thread machine is unavailable",
      activities: [
        {
          id: EventId.make("aldo-demo-react-upgrade-failed"),
          tone: "error",
          kind: "thread-machine.failed",
          summary: "Thread machine is unavailable",
          payload: { detail: "No machine capacity in this region right now." },
          turnId: null,
          createdAt: isoMinutesAgo(11),
        },
      ],
      machine: { state: "failed", detail: "No machine capacity in this region right now." },
    }),
  ];
}

export const hubDemoRefs: VcsListRefsResult = {
  refs: [
    { name: "main", current: false, isDefault: true, worktreePath: null },
    { name: "aldo/pricing-page", current: false, isDefault: false, worktreePath: null },
    { name: "release/2026-09", current: false, isDefault: false, worktreePath: null },
  ],
  isRepo: true,
  hasPrimaryRemote: true,
  nextCursor: null,
  totalCount: 3,
};

const githubDiscovery = {
  kind: "github" as const,
  label: "GitHub",
  status: "available" as const,
  version: Option.none(),
  installHint: "Connect GitHub in Aldo.",
  detail: Option.none(),
  auth: {
    status: "authenticated" as const,
    account: Option.some("aldo-demo"),
    host: Option.some("github.com"),
    detail: Option.none(),
  },
};

export const hubDemoDiscovery: SourceControlDiscoveryResult = {
  versionControlSystems: [],
  sourceControlProviders: [githubDiscovery],
};

function repository(
  name: string,
  description: string,
  flags: Partial<Pick<SourceControlRepositorySummary, "isPrivate" | "isFork">> = {},
): SourceControlRepositorySummary {
  return {
    provider: "github",
    nameWithOwner: `aldo-demo/${name}`,
    name,
    owner: "aldo-demo",
    url: `https://github.com/aldo-demo/${name}`,
    sshUrl: `git@github.com:aldo-demo/${name}.git`,
    description,
    isPrivate: flags.isPrivate ?? true,
    isArchived: false,
    isFork: flags.isFork ?? false,
  };
}

export const hubDemoRepositories: ReadonlyArray<SourceControlRepositorySummary> = [
  repository("northstar", "Marketing site and docs"),
  repository("api", "Public API and webhooks"),
  repository("mobile", "iOS and Android apps"),
  repository("design-system", "Shared components and tokens", { isPrivate: false }),
  repository("infra", "Terraform and deploy scripts"),
];
