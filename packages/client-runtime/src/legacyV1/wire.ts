/**
 * The generation-1 orchestration wire shapes this client still reads and writes for machines that
 * keep their original runtime. Copied from the fork's last protocol-1 contracts
 * (`packages/contracts/src/orchestration.ts` at tag `backup/pre-v0.1.11-branch`) and cut down to
 * what the adapter uses. Delete this directory when the last such machine is gone.
 */
import {
  ApprovalRequestId,
  ChatAttachment,
  CheckpointRef,
  CommandId,
  EventId,
  IsoDateTime,
  MessageId,
  ModelSelection,
  NonNegativeInt,
  OrchestrationMessageContext,
  OrchestrationProjectShell,
  PlanId,
  ProjectId,
  ProviderApprovalDecision,
  ProviderInteractionMode,
  ProviderUserInputAnswers,
  RuntimeMode,
  ThreadId,
  ThreadLinkedPullRequest,
  ThreadPullRequestLink,
  TrimmedNonEmptyString,
  TurnId,
  UploadChatAttachment,
  UserInputAttachments,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const V1_WS_METHODS = {
  dispatchCommand: "orchestration.dispatchCommand",
  subscribeShell: "orchestration.subscribeShell",
  subscribeThread: "orchestration.subscribeThread",
  getArchivedShellSnapshot: "orchestration.getArchivedShellSnapshot",
} as const;

export const V1SubscribeShellInput = Schema.Struct({
  afterSequence: Schema.optionalKey(NonNegativeInt),
  requestCompletionMarker: Schema.optionalKey(Schema.Boolean),
});

/** Without `turnLimit` the machine sends the whole thread, which is what the adapter maps. */
export const V1SubscribeThreadInput = Schema.Struct({
  threadId: ThreadId,
  reasoningMessages: Schema.optionalKey(Schema.Boolean),
  requestCompletionMarker: Schema.optionalKey(Schema.Boolean),
});

/** Every V1 orchestration failure carries a message; the rest of its shape is not read. */
export const V1Failure = Schema.Struct({ _tag: Schema.String, message: Schema.String });
export type V1Failure = typeof V1Failure.Type;

const SourceProposedPlan = Schema.Struct({ threadId: ThreadId, planId: PlanId });

export const V1Message = Schema.Struct({
  id: MessageId,
  role: Schema.Literals(["user", "assistant", "system", "reasoning"]),
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  context: Schema.optional(OrchestrationMessageContext),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type V1Message = typeof V1Message.Type;

export const V1ProposedPlan = Schema.Struct({
  id: PlanId,
  turnId: Schema.NullOr(TurnId),
  planMarkdown: Schema.String,
  approvedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  implementedAt: Schema.NullOr(IsoDateTime),
  implementationThreadId: Schema.NullOr(ThreadId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type V1ProposedPlan = typeof V1ProposedPlan.Type;

export const V1Session = Schema.Struct({
  threadId: ThreadId,
  status: Schema.Literals([
    "idle",
    "starting",
    "running",
    "ready",
    "interrupted",
    "stopped",
    "error",
  ]),
  providerName: Schema.NullOr(Schema.String),
  runtimeMode: RuntimeMode,
  activeTurnId: Schema.NullOr(TurnId),
  lastError: Schema.NullOr(Schema.String),
  updatedAt: IsoDateTime,
});
export type V1Session = typeof V1Session.Type;

export const V1Activity = Schema.Struct({
  id: EventId,
  tone: Schema.Literals(["info", "tool", "approval", "error"]),
  kind: Schema.String,
  summary: Schema.String,
  payload: Schema.Unknown,
  turnId: Schema.NullOr(TurnId),
  sequence: Schema.optional(NonNegativeInt),
  createdAt: IsoDateTime,
});
export type V1Activity = typeof V1Activity.Type;

export const V1LatestTurn = Schema.Struct({
  turnId: TurnId,
  state: Schema.Literals(["running", "interrupted", "completed", "error"]),
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  assistantMessageId: Schema.NullOr(MessageId),
  sourceProposedPlan: Schema.optional(SourceProposedPlan),
});
export type V1LatestTurn = typeof V1LatestTurn.Type;

export const V1Checkpoint = Schema.Struct({
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: Schema.Literals(["ready", "missing", "error"]),
  files: Schema.Array(
    Schema.Struct({
      path: Schema.NonEmptyString,
      kind: TrimmedNonEmptyString,
      additions: NonNegativeInt,
      deletions: NonNegativeInt,
    }),
  ),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});
export type V1Checkpoint = typeof V1Checkpoint.Type;

const NullableDate = Schema.optional(Schema.NullOr(IsoDateTime));

/** The fields a thread carries in both its list row and its detail. */
const V1ThreadFields = {
  id: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  linkedPullRequest: Schema.optional(Schema.NullOr(ThreadLinkedPullRequest)),
  pullRequests: Schema.optional(Schema.Array(ThreadPullRequestLink)),
  branchPullRequest: Schema.optional(Schema.NullOr(ThreadLinkedPullRequest)),
  latestTurn: Schema.NullOr(V1LatestTurn),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: NullableDate,
  settledOverride: Schema.optional(Schema.NullOr(Schema.Literals(["settled", "active"]))),
  settledAt: NullableDate,
  unsettledAt: NullableDate,
  snoozedUntil: NullableDate,
  snoozedAt: NullableDate,
  pinnedAt: NullableDate,
  pinOrderKey: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  activeOrderKey: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  autoSettleDisabledAt: NullableDate,
  titleRegeneration: Schema.optional(
    Schema.NullOr(Schema.Struct({ requestId: CommandId, startedAt: IsoDateTime })),
  ),
  session: Schema.NullOr(V1Session),
} as const;

export const V1Thread = Schema.Struct({
  ...V1ThreadFields,
  deletedAt: Schema.NullOr(IsoDateTime),
  messages: Schema.Array(V1Message),
  proposedPlans: Schema.optional(Schema.Array(V1ProposedPlan)),
  activities: Schema.Array(V1Activity),
  checkpoints: Schema.Array(V1Checkpoint),
});
export type V1Thread = typeof V1Thread.Type;

export const V1ThreadShell = Schema.Struct({
  ...V1ThreadFields,
  latestUserMessageAt: Schema.NullOr(IsoDateTime),
  hasPendingApprovals: Schema.Boolean,
  hasPendingUserInput: Schema.Boolean,
  hasActionableProposedPlan: Schema.Boolean,
  /** Aldo's machines say what a running turn does now; neither is stored. */
  planProgress: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        step: TrimmedNonEmptyString,
        completedSteps: NonNegativeInt,
        totalSteps: NonNegativeInt,
      }),
    ),
  ),
  currentWork: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        kind: Schema.Literals(["thinking", "tool", "writing"]),
        startedAt: IsoDateTime,
        activity: Schema.NullOr(V1Activity),
      }),
    ),
  ),
});
export type V1ThreadShell = typeof V1ThreadShell.Type;

export const V1ShellSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(OrchestrationProjectShell),
  threads: Schema.Array(V1ThreadShell),
});
export type V1ShellSnapshot = typeof V1ShellSnapshot.Type;

export const V1ShellStreamItem = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("synchronized") }),
  Schema.Struct({ kind: Schema.Literal("snapshot"), snapshot: V1ShellSnapshot }),
  Schema.Struct({
    kind: Schema.Literal("project-upserted"),
    sequence: NonNegativeInt,
    project: OrchestrationProjectShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("project-removed"),
    sequence: NonNegativeInt,
    projectId: ProjectId,
  }),
  Schema.Struct({
    kind: Schema.Literal("thread-upserted"),
    sequence: NonNegativeInt,
    thread: V1ThreadShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("thread-removed"),
    sequence: NonNegativeInt,
    threadId: ThreadId,
  }),
]);
export type V1ShellStreamItem = typeof V1ShellStreamItem.Type;

export const V1ThreadDetailSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  thread: V1Thread,
  page: Schema.optional(
    Schema.Struct({ beforeCursor: Schema.NullOr(Schema.String), hasMore: Schema.Boolean }),
  ),
});
export type V1ThreadDetailSnapshot = typeof V1ThreadDetailSnapshot.Type;

/** A thread event with its payload left raw: only the hot ones are applied in place. */
export const V1Event = Schema.Struct({
  sequence: NonNegativeInt,
  type: Schema.String,
  occurredAt: IsoDateTime,
  payload: Schema.Unknown,
});
export type V1Event = typeof V1Event.Type;

export const V1ThreadStreamItem = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("synchronized") }),
  Schema.Struct({ kind: Schema.Literal("snapshot"), snapshot: V1ThreadDetailSnapshot }),
  Schema.Struct({ kind: Schema.Literal("event"), event: V1Event }),
]);
export type V1ThreadStreamItem = typeof V1ThreadStreamItem.Type;

/** The payloads of the events that arrive many times a second while an agent works. */
export const V1MessageSentPayload = Schema.Struct({
  messageId: MessageId,
  role: V1Message.fields.role,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  context: Schema.optional(OrchestrationMessageContext),
  turnId: Schema.optional(Schema.NullOr(TurnId)),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export const V1ActivityAppendedPayload = Schema.Struct({ activity: V1Activity });
export const V1SessionSetPayload = Schema.Struct({ session: V1Session });

const base = { commandId: CommandId, threadId: ThreadId } as const;
const stamped = { ...base, createdAt: IsoDateTime } as const;
const plain = <Type extends string>(type: Type) =>
  Schema.Struct({ type: Schema.Literal(type), ...base });

/** The commands a client sends that the adapter can produce. */
export const V1ClientCommand = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("thread.create"),
    ...stamped,
    projectId: ProjectId,
    title: TrimmedNonEmptyString,
    modelSelection: ModelSelection,
    runtimeMode: RuntimeMode,
    interactionMode: ProviderInteractionMode,
    branch: Schema.NullOr(TrimmedNonEmptyString),
    worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  }),
  plain("thread.delete"),
  plain("thread.archive"),
  plain("thread.unarchive"),
  plain("thread.settle"),
  Schema.Struct({
    type: Schema.Literal("thread.unsettle"),
    ...base,
    reason: Schema.Literal("user"),
  }),
  Schema.Struct({ type: Schema.Literal("thread.snooze"), ...base, snoozedUntil: IsoDateTime }),
  Schema.Struct({
    type: Schema.Literal("thread.unsnooze"),
    ...base,
    reason: Schema.Literal("user"),
  }),
  Schema.Struct({
    type: Schema.Literal("thread.pin"),
    ...base,
    orderKey: Schema.optional(TrimmedNonEmptyString),
  }),
  plain("thread.unpin"),
  Schema.Struct({
    type: Schema.Literals(["thread.pin.reorder", "thread.active.reorder"]),
    ...base,
    orderKey: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.auto-settle.set"),
    ...base,
    enabled: Schema.Boolean,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.meta.update"),
    ...base,
    title: Schema.optional(TrimmedNonEmptyString),
    regenerateTitle: Schema.optional(Schema.Literal(true)),
    modelSelection: Schema.optional(ModelSelection),
    branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
    expectedBranch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
    worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
    linkedPullRequest: Schema.optional(Schema.NullOr(ThreadLinkedPullRequest)),
  }),
  Schema.Struct({
    type: Schema.Literal("thread.runtime-mode.set"),
    ...stamped,
    runtimeMode: RuntimeMode,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.interaction-mode.set"),
    ...stamped,
    interactionMode: ProviderInteractionMode,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.turn.start"),
    ...stamped,
    message: Schema.Struct({
      messageId: MessageId,
      role: Schema.Literal("user"),
      text: Schema.String,
      attachments: Schema.Array(Schema.Union([UploadChatAttachment, ChatAttachment])),
      context: Schema.optional(OrchestrationMessageContext),
    }),
    modelSelection: Schema.optional(ModelSelection),
    titleSeed: Schema.optional(TrimmedNonEmptyString),
    runtimeMode: RuntimeMode,
    interactionMode: ProviderInteractionMode,
    bootstrap: Schema.optional(
      Schema.Struct({
        createThread: Schema.Struct({
          projectId: ProjectId,
          title: TrimmedNonEmptyString,
          modelSelection: ModelSelection,
          runtimeMode: RuntimeMode,
          interactionMode: ProviderInteractionMode,
          branch: Schema.NullOr(TrimmedNonEmptyString),
          worktreePath: Schema.NullOr(TrimmedNonEmptyString),
          createdAt: IsoDateTime,
        }),
        prepareWorktree: Schema.optional(
          Schema.Struct({
            projectCwd: TrimmedNonEmptyString,
            baseBranch: TrimmedNonEmptyString,
            branch: Schema.optional(TrimmedNonEmptyString),
            startFromOrigin: Schema.optional(Schema.Boolean),
          }),
        ),
        runSetupScript: Schema.optional(Schema.Boolean),
      }),
    ),
    sourceProposedPlan: Schema.optional(SourceProposedPlan),
    continuation: Schema.optional(Schema.Struct({ turnId: TurnId })),
  }),
  Schema.Struct({
    type: Schema.Literal("thread.turn.interrupt"),
    ...stamped,
    turnId: Schema.optional(TurnId),
  }),
  Schema.Struct({
    type: Schema.Literal("thread.approval.respond"),
    ...stamped,
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.user-input.respond"),
    ...stamped,
    requestId: ApprovalRequestId,
    answers: ProviderUserInputAnswers,
    attachmentsByQuestionId: Schema.optional(UserInputAttachments),
  }),
  Schema.Struct({
    type: Schema.Literal("thread.user-input.dismiss"),
    ...stamped,
    requestId: ApprovalRequestId,
  }),
]);
export type V1ClientCommand = typeof V1ClientCommand.Type;
