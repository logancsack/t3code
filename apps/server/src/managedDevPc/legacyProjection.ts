/**
 * Aldo's `/api/_devpc` routes answer in the shapes T3's first orchestration model had, which Aldo's
 * control plane and workspace coordinator read. These pure functions derive those shapes from the
 * current read model, so the contract holds while the server underneath changes. A turn is a run:
 * `turnId` carries the run id.
 */
import {
  isListedThreadLineage,
  latestProviderTurnForAttempt,
  type OrchestrationProjectShell,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadShell,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { stallReasonOf } from "./turnStall.ts";

type Utc = OrchestrationV2ThreadShell["createdAt"];

const iso = (value: Utc) => DateTime.formatIso(value);
const isoOrNull = (value: Utc | null | undefined) => (value == null ? null : iso(value));

type RunStatus = OrchestrationV2Run["status"];
type LegacyTurnState = "running" | "interrupted" | "completed" | "error";
type LegacySessionStatus = "starting" | "running" | "ready" | "interrupted" | "error";

const legacyTurnState = (status: RunStatus): LegacyTurnState => {
  switch (status) {
    case "preparing":
    case "queued":
    case "starting":
    case "running":
    case "waiting":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "error";
    case "interrupted":
    case "cancelled":
    case "rolled_back":
      return "interrupted";
  }
};

const legacySessionStatus = (status: RunStatus): LegacySessionStatus => {
  switch (status) {
    case "preparing":
    case "queued":
    case "starting":
      return "starting";
    case "running":
    case "waiting":
      return "running";
    case "completed":
      return "ready";
    case "failed":
      return "error";
    case "interrupted":
    case "cancelled":
    case "rolled_back":
      return "interrupted";
  }
};

/** "working" while subagents or awaited work run, "monitoring" when watch loops are all that is left. */
function legacyBackgroundLiveness(
  shell: Pick<OrchestrationV2ThreadShell, "pendingBackgroundTasks">,
): "working" | "monitoring" | null {
  const tasks = shell.pendingBackgroundTasks ?? [];
  if (tasks.length === 0) return null;
  return tasks.some(
    (task) => task.kind === "subagent" || task.kind === "background_task" || task.awaited === true,
  )
    ? "working"
    : "monitoring";
}

export function legacyThreadShell(shell: OrchestrationV2ThreadShell) {
  const turnId = shell.activeRunId ?? shell.latestRunId;
  // The shell's status is its latest run's; a run still active under a queued follow-up is running.
  const status: RunStatus | null =
    shell.activeRunId !== null && shell.activeRunId !== shell.latestRunId
      ? (shell.activityRunStatus ?? "running")
      : shell.status === "idle"
        ? null
        : shell.status;
  const live = status !== null && legacyTurnState(status) === "running";
  const pending = shell.pendingRuntimeRequest;
  const backgroundLiveness = legacyBackgroundLiveness(shell);
  const updatedAt = iso(shell.updatedAt);
  return {
    id: shell.id,
    projectId: shell.projectId,
    title: shell.title,
    modelSelection: shell.modelSelection,
    runtimeMode: shell.runtimeMode,
    interactionMode: shell.interactionMode,
    branch: shell.branch,
    worktreePath: shell.worktreePath,
    latestTurn:
      turnId === null || status === null
        ? null
        : {
            turnId,
            state: legacyTurnState(status),
            requestedAt: isoOrNull(shell.latestRunRequestedAt) ?? iso(shell.createdAt),
            startedAt: isoOrNull(shell.activityRunStartedAt ?? shell.latestRunStartedAt),
            completedAt: live ? null : isoOrNull(shell.latestRunCompletedAt),
            assistantMessageId: null,
          },
    createdAt: iso(shell.createdAt),
    updatedAt,
    archivedAt: isoOrNull(shell.archivedAt),
    settledOverride: shell.settledOverride,
    settledAt: isoOrNull(shell.settledAt),
    unsettledAt: isoOrNull(shell.unsettledAt),
    snoozedUntil: isoOrNull(shell.snoozedUntil),
    snoozedAt: isoOrNull(shell.snoozedAt),
    pinnedAt: isoOrNull(shell.pinnedAt),
    pinOrderKey: shell.pinOrderKey ?? null,
    activeOrderKey: shell.activeOrderKey ?? null,
    autoSettleDisabledAt: isoOrNull(shell.autoSettleDisabledAt),
    ...(shell.goal === undefined ? {} : { goal: shell.goal }),
    session:
      status === null
        ? null
        : {
            threadId: shell.id,
            status: legacySessionStatus(status),
            providerName: null,
            providerInstanceId: shell.providerInstanceId,
            runtimeMode: shell.runtimeMode,
            activeTurnId: live ? turnId : null,
            lastError: status === "failed" ? (shell.lastError ?? null) : null,
            updatedAt,
          },
    latestUserMessageAt: isoOrNull(shell.latestUserMessageAt),
    hasPendingApprovals: pending !== null && pending.kind !== "user_input",
    hasPendingUserInput: pending !== null && pending.kind === "user_input",
    hasActionableProposedPlan: shell.hasActionableProposedPlan,
    ...(backgroundLiveness === null ? {} : { backgroundLiveness }),
    ...legacyLiveWork(shell.liveWork),
  };
}

/** The first model's `currentWork` and `planProgress`, which Aldo's Home reads for a live line. */
function legacyLiveWork(work: OrchestrationV2ThreadShell["liveWork"]) {
  if (work === undefined) return {};
  return {
    currentWork: {
      kind: work.kind,
      startedAt: iso(work.startedAt),
      activity: work.tool === null ? null : (itemActivities(work.tool, new Map())[0] ?? null),
    },
    planProgress: work.plan,
  };
}
export type LegacyThreadShell = ReturnType<typeof legacyThreadShell>;

function legacyProjectShell(project: OrchestrationProjectShell) {
  return project;
}

/** Threads a client lists: subagent children and side chats stay inside their parent. */
export function legacyShellSnapshot(input: {
  readonly snapshotSequence: number;
  readonly threads: ReadonlyArray<OrchestrationV2ThreadShell>;
  readonly projects: ReadonlyArray<OrchestrationProjectShell>;
  readonly now: Utc;
}) {
  return {
    snapshotSequence: input.snapshotSequence,
    projects: input.projects.map(legacyProjectShell),
    threads: input.threads
      .filter((thread) => thread.deletedAt === null && isListedThreadLineage(thread.lineage))
      .map(legacyThreadShell),
    updatedAt: iso(input.now),
  };
}

type TurnItem = OrchestrationV2TurnItem;
type ItemOf<Type extends TurnItem["type"]> = Extract<TurnItem, { readonly type: Type }>;

interface LegacyActivity {
  readonly id: string;
  readonly tone: "info" | "tool" | "approval" | "error";
  readonly kind: string;
  readonly summary: string;
  readonly payload: unknown;
  readonly turnId: string | null;
  readonly createdAt: string;
}

const TOOL_ITEM_TYPES = new Set<TurnItem["type"]>([
  "command_execution",
  "file_change",
  "file_search",
  "web_search",
  "dynamic_tool",
  "subagent",
]);

const ENDED_ITEM_STATUSES = new Set<TurnItem["status"]>([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

const itemAt = (item: TurnItem) => iso(item.startedAt ?? item.updatedAt);
const itemEndedAt = (item: TurnItem) => iso(item.completedAt ?? item.updatedAt);

function toolDetail(item: TurnItem): string | undefined {
  switch (item.type) {
    case "command_execution":
      return item.input;
    case "file_change":
      return item.fileName;
    case "file_search":
      return item.pattern;
    case "web_search":
      return item.patterns?.join(", ");
    case "dynamic_tool":
      return item.toolName ?? undefined;
    case "subagent":
      return item.prompt;
    default:
      return undefined;
  }
}

function requestActivities(
  item: ItemOf<"approval_request"> | ItemOf<"user_input_request">,
  request: OrchestrationV2ThreadProjection["runtimeRequests"][number] | undefined,
): ReadonlyArray<LegacyActivity> {
  const approval = item.type === "approval_request";
  const prefix = approval ? "approval" : "user-input";
  const requested: LegacyActivity = {
    id: `${item.id}:requested`,
    tone: approval ? "approval" : "info",
    kind: `${prefix}.requested`,
    summary: item.title?.trim() || (approval ? "Approval requested" : "User input requested"),
    payload:
      item.type === "approval_request"
        ? {
            requestId: item.requestId,
            requestKind: item.requestKind,
            requestType: item.requestKind,
            ...(item.prompt ? { detail: item.prompt } : item.reason ? { detail: item.reason } : {}),
          }
        : {
            requestId: item.requestId,
            questions: item.questions,
            ...(item.responseMode ? { responseMode: item.responseMode } : {}),
          },
    turnId: item.runId,
    createdAt: itemAt(item),
  };
  // A request the read model no longer holds as pending is over, whether answered or left behind.
  const open =
    request === undefined ? !ENDED_ITEM_STATUSES.has(item.status) : request.status === "pending";
  if (open) return [requested];
  return [
    requested,
    {
      id: `${item.id}:resolved`,
      tone: "info",
      kind: `${prefix}.resolved`,
      summary: approval ? "Approval resolved" : "User input submitted",
      payload: {
        requestId: item.requestId,
        ...(request?.decision === undefined ? {} : { decision: request.decision }),
        ...(request?.answers === undefined ? {} : { answers: request.answers }),
        ...(request === undefined || request.status === "resolved"
          ? {}
          : { status: request.status }),
      },
      turnId: item.runId,
      createdAt: isoOrNull(request?.resolvedAt) ?? itemEndedAt(item),
    },
  ];
}

function itemActivities(
  item: TurnItem,
  requests: ReadonlyMap<string, OrchestrationV2ThreadProjection["runtimeRequests"][number]>,
): ReadonlyArray<LegacyActivity> {
  if (item.type === "approval_request" || item.type === "user_input_request") {
    return requestActivities(item, requests.get(item.requestId));
  }
  if (item.type === "error") {
    return [
      {
        id: item.id,
        tone: "error",
        kind: "runtime.error",
        summary: item.failure.message,
        payload: {
          message: item.failure.message,
          class: item.failure.class,
          code: item.failure.code,
          retryable: item.failure.retryable,
        },
        turnId: item.runId,
        createdAt: itemAt(item),
      },
    ];
  }
  if (item.type === "run_interrupt_request") {
    // Only the watchdog's stop is a stall; a person's Stop is an ordinary interrupted turn.
    const reason = stallReasonOf(item.message);
    return reason === null
      ? []
      : [
          {
            id: item.id,
            tone: "error",
            kind: "turn.stalled",
            summary: item.message,
            payload: { turnId: item.runId, reason },
            turnId: item.runId,
            createdAt: itemAt(item),
          },
        ];
  }
  if (item.type === "system_notice") {
    const message = item.message.trim();
    return message.length === 0
      ? []
      : [
          {
            id: item.id,
            tone: item.level === "error" ? "error" : "info",
            kind: "runtime.warning",
            summary: message,
            payload: { message },
            turnId: item.runId,
            createdAt: itemAt(item),
          },
        ];
  }
  if (!TOOL_ITEM_TYPES.has(item.type)) return [];
  const ended = ENDED_ITEM_STATUSES.has(item.status);
  const detail = toolDetail(item);
  return [
    {
      id: item.id,
      tone: "tool",
      kind: ended ? "tool.completed" : "tool.updated",
      summary: item.title?.trim() || item.type,
      payload: {
        toolCallId: item.id,
        itemType: item.type,
        status: ended ? item.status : "inProgress",
        ...(detail ? { detail } : {}),
      },
      turnId: item.runId,
      createdAt: ended ? itemEndedAt(item) : itemAt(item),
    },
  ];
}

const byCreatedAt = <Row extends { readonly createdAt: string }>(left: Row, right: Row) =>
  left.createdAt < right.createdAt ? -1 : left.createdAt > right.createdAt ? 1 : 0;

/**
 * One thread with the turns `runIds` names (all of them when absent), in the first model's shape:
 * messages, proposed plans, checkpoints, and the tool calls, requests, errors and context usage
 * the first model recorded as activities.
 */
export function legacyThreadDetail(input: {
  readonly shell: OrchestrationV2ThreadShell;
  readonly projection: OrchestrationV2ThreadProjection;
  readonly runIds?: ReadonlySet<string> | undefined;
  /** What each run was given with its message, by run id. */
  readonly instructions?:
    | ReadonlyMap<string, { readonly contract: string; readonly version: number }>
    | undefined;
}) {
  const { projection, runIds } = input;
  const inPage = (runId: string | null) =>
    runIds === undefined || runId === null || runIds.has(runId);
  const requests = new Map(projection.runtimeRequests.map((request) => [request.id, request]));
  const attemptRuns = new Map(projection.attempts.map((attempt) => [attempt.id, attempt.runId]));

  const activities: LegacyActivity[] = [];
  const messagesById = new Map(projection.messages.map((message) => [message.id, message]));
  for (const run of projection.runs) {
    if (!inPage(run.id) || run.status === "queued") continue;
    // What this turn was started with, as the first model recorded when it reached the provider.
    activities.push({
      id: `${run.id}:dispatched`,
      tone: "info",
      kind: "provider.turn.dispatched",
      summary: "Turn sent to provider",
      payload: {
        requestId: run.userMessageId,
        modelSelection: run.modelSelection,
        started: run.startedAt != null,
        ...(run.userMessageId === null
          ? {}
          : {
              collaborationOrigin: messagesById.get(run.userMessageId)?.delegatedCompletion
                ?.parentRunId,
            }),
        executedModel:
          latestProviderTurnForAttempt(projection.providerTurns, run.activeAttemptId)?.model ??
          null,
        ...(input.instructions?.has(run.id)
          ? { instructions: input.instructions.get(run.id) }
          : {}),
      },
      turnId: null,
      createdAt: iso(run.startedAt ?? run.requestedAt),
    });
  }
  for (const item of projection.turnItems) {
    if (inPage(item.runId)) activities.push(...itemActivities(item, requests));
  }
  for (const turn of projection.providerTurns) {
    const usage = turn.tokenUsage;
    const runId = turn.runAttemptId === null ? null : (attemptRuns.get(turn.runAttemptId) ?? null);
    if (usage === undefined || !inPage(runId)) continue;
    activities.push({
      id: `${turn.id}:context`,
      tone: "info",
      kind: "context-window.updated",
      summary: "Context window updated",
      payload: {
        usedTokens: usage.usedTokens,
        ...(usage.maxTokens == null ? {} : { maxTokens: usage.maxTokens }),
        ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
        ...(usage.cachedInputTokens === undefined
          ? {}
          : { cachedInputTokens: usage.cachedInputTokens }),
        ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
      },
      turnId: runId,
      createdAt: usage.updatedAt,
    });
  }

  const planItems = new Map(
    projection.turnItems.flatMap((item) =>
      item.type === "proposed_plan" ? [[item.planId, item] as const] : [],
    ),
  );
  const implementations = new Map(
    projection.runs.flatMap((run) =>
      run.sourcePlanRef === undefined ? [] : [[run.sourcePlanRef.planId, run] as const],
    ),
  );

  return {
    ...legacyThreadShell(input.shell),
    deletedAt: isoOrNull(input.shell.deletedAt),
    messages: projection.messages
      .filter((message) => inPage(message.runId))
      .map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        ...(message.attachments.length === 0 ? {} : { attachments: message.attachments }),
        turnId: message.runId,
        streaming: message.streaming,
        createdAt: iso(message.createdAt),
        updatedAt: iso(message.updatedAt),
      }))
      .toSorted(byCreatedAt),
    proposedPlans: projection.plans.flatMap((plan) => {
      if (plan.kind !== "proposed_plan" || !inPage(plan.runId)) return [];
      const markdown = plan.markdown.trim();
      if (markdown.length === 0) return [];
      const item = planItems.get(plan.id);
      const implementation = implementations.get(plan.id);
      const at = item === undefined ? iso(projection.updatedAt) : itemAt(item);
      const implementedAt = implementation === undefined ? null : iso(implementation.requestedAt);
      return [
        {
          id: plan.id,
          turnId: plan.runId,
          planMarkdown: markdown,
          approvedAt: implementedAt,
          implementedAt,
          implementationThreadId: implementation?.threadId ?? null,
          createdAt: at,
          updatedAt: item === undefined ? at : iso(item.updatedAt),
        },
      ];
    }),
    activities: activities.toSorted(byCreatedAt),
    checkpoints: projection.checkpoints.flatMap((checkpoint) =>
      checkpoint.runId === null || !inPage(checkpoint.runId)
        ? []
        : [
            {
              turnId: checkpoint.runId,
              checkpointTurnCount: checkpoint.appRunOrdinal ?? checkpoint.ordinalWithinScope,
              checkpointRef: checkpoint.ref,
              status: checkpoint.status === "stale" ? ("missing" as const) : checkpoint.status,
              files: checkpoint.files,
              assistantMessageId: null,
              completedAt: iso(checkpoint.capturedAt),
            },
          ],
    ),
  };
}

/**
 * The newest `turnLimit` turns older than `beforeCursor` (a run ordinal), and the cursor for the
 * page before them. Runs come oldest first.
 */
export function legacyTurnPage(input: {
  readonly runs: ReadonlyArray<Pick<OrchestrationV2Run, "id" | "ordinal">>;
  readonly turnLimit: number;
  readonly beforeCursor?: number | undefined;
  /** Turns older than `runs` exist that this read did not load. */
  readonly olderUnloaded?: boolean | undefined;
}) {
  const ordered = input.runs.toSorted((left, right) => left.ordinal - right.ordinal);
  const eligible =
    input.beforeCursor === undefined
      ? ordered
      : ordered.filter((run) => run.ordinal < (input.beforeCursor as number));
  const page = eligible.slice(Math.max(0, eligible.length - input.turnLimit));
  const hasMore = page.length < eligible.length || input.olderUnloaded === true;
  const first = page[0];
  return {
    runIds: new Set<string>(page.map((run) => run.id)),
    page: {
      beforeCursor: hasMore && first !== undefined ? String(first.ordinal) : null,
      hasMore,
    },
  };
}

function hasRunningManagedTurn(threads: ReadonlyArray<LegacyThreadShell>): boolean {
  return threads.some(
    (thread) =>
      thread.latestTurn?.state === "running" &&
      thread.session?.status === "running" &&
      thread.session.activeTurnId === thread.latestTurn.turnId &&
      !thread.hasPendingApprovals &&
      !thread.hasPendingUserInput &&
      !thread.hasActionableProposedPlan,
  );
}

/** Client timestamps may be slightly ahead of the server, but not arbitrarily so. */
export const QUEUED_TURN_START_FUTURE_SKEW_MS = 2 * 60_000;

/** An accepted message stays work until a turn adopts it or a failed start rejects it. */
function hasQueuedManagedTurnStart(
  threads: ReadonlyArray<LegacyThreadShell>,
  nowMs: number,
): boolean {
  return threads.some((thread) => {
    if (thread.session?.status === "error") return false;
    if (thread.latestUserMessageAt === null) return false;
    const messageAtMs = Date.parse(thread.latestUserMessageAt);
    if (!Number.isFinite(messageAtMs)) return false;
    const latestTurnAtMs =
      thread.latestTurn === null
        ? Number.NEGATIVE_INFINITY
        : Math.max(
            ...[
              thread.latestTurn.requestedAt,
              thread.latestTurn.startedAt,
              thread.latestTurn.completedAt,
            ].map((candidate) =>
              candidate == null ? Number.NEGATIVE_INFINITY : Date.parse(candidate),
            ),
          );
    return messageAtMs > latestTurnAtMs && messageAtMs <= nowMs + QUEUED_TURN_START_FUTURE_SKEW_MS;
  });
}

/** A provider session mid-boot is about to run a turn; that is agent work too. */
function hasStartingManagedSession(threads: ReadonlyArray<LegacyThreadShell>): boolean {
  return threads.some((thread) => thread.session?.status === "starting");
}

/**
 * Background work alive after a turn settled. "working" counts as active; "monitoring" is
 * reported apart so the platform holds the workspace under its own bounded policy instead of
 * forever for a forgotten background shell.
 */
function managedBackgroundWork(
  threads: ReadonlyArray<LegacyThreadShell>,
): "working" | "monitoring" | null {
  let monitoring = false;
  for (const thread of threads) {
    if (thread.backgroundLiveness === "working") return "working";
    if (thread.backgroundLiveness === "monitoring") monitoring = true;
  }
  return monitoring ? "monitoring" : null;
}

/** Work blocked on the human: safe to pause under, yet not "nothing to do". */
function hasPendingManagedWork(threads: ReadonlyArray<LegacyThreadShell>): boolean {
  return threads.some(
    (thread) =>
      thread.hasPendingApprovals || thread.hasPendingUserInput || thread.hasActionableProposedPlan,
  );
}

export function managedActivity(threads: ReadonlyArray<LegacyThreadShell>, nowMs: number) {
  const backgroundWork = managedBackgroundWork(threads);
  const active = hasRunningManagedTurn(threads) || backgroundWork === "working";
  return {
    active,
    working:
      active || hasQueuedManagedTurnStart(threads, nowMs) || hasStartingManagedSession(threads),
    pendingWork: hasPendingManagedWork(threads),
    backgroundWork,
  };
}

export function managedThreadNeedsTerminalization(
  thread: LegacyThreadShell,
  nowMs: number,
): boolean {
  return (
    thread.latestTurn?.state === "running" ||
    thread.session?.status === "starting" ||
    thread.session?.status === "running" ||
    hasQueuedManagedTurnStart([thread], nowMs)
  );
}
