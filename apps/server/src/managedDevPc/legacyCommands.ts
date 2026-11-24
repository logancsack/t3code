/**
 * The commands Aldo sends to `/api/_devpc/dispatch`, in the first orchestration model's shape.
 * `ManagedDevPc.dispatch` turns each into the current model's commands. Fields Aldo adds for its
 * own bookkeeping (`createdAt`, `aldoNow`, ...) are accepted and ignored.
 */
import {
  ChatAttachment,
  ChatAttachmentId,
  CommandId,
  IsoDateTime,
  MessageId,
  ModelSelection,
  PlanId,
  ProjectId,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  ProviderApprovalDecision,
  ProviderInteractionMode,
  ProviderUserInputAnswers,
  RunId,
  RuntimeMode,
  RuntimeRequestId,
  ThreadId,
  TrimmedNonEmptyString,
  NonNegativeInt,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

/** An image sent inline, as the first model's clients uploaded them. */
export const LegacyUploadImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  id: Schema.optional(ChatAttachmentId),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
  dataUrl: TrimmedNonEmptyString.check(Schema.isMaxLength(14_000_000)),
});
export type LegacyUploadImageAttachment = typeof LegacyUploadImageAttachment.Type;

const target = { commandId: CommandId, threadId: ThreadId } as const;

const TurnStart = Schema.Struct({
  type: Schema.Literal("thread.turn.start"),
  ...target,
  message: Schema.Struct({
    messageId: MessageId,
    text: Schema.String,
    attachments: Schema.Array(Schema.Union([LegacyUploadImageAttachment, ChatAttachment])),
  }),
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: Schema.optional(RuntimeMode),
  interactionMode: Schema.optional(ProviderInteractionMode),
  bootstrap: Schema.optional(
    Schema.Struct({
      createThread: Schema.optional(
        Schema.Struct({
          projectId: ProjectId,
          title: TrimmedNonEmptyString,
          modelSelection: ModelSelection,
          runtimeMode: RuntimeMode,
          interactionMode: ProviderInteractionMode,
          branch: Schema.NullOr(TrimmedNonEmptyString),
          worktreePath: Schema.NullOr(TrimmedNonEmptyString),
        }),
      ),
    }),
  ),
  sourceProposedPlan: Schema.optional(Schema.Struct({ threadId: ThreadId, planId: PlanId })),
  /** Carry on a settled turn: the new turn continues that one. */
  continuation: Schema.optional(Schema.Struct({ turnId: RunId })),
});

export const LegacyCommand = Schema.Union([
  TurnStart,
  Schema.Struct({
    type: Schema.Literal("thread.turn.interrupt"),
    ...target,
    turnId: Schema.optional(RunId),
  }),
  Schema.Struct({
    type: Schema.Literal("thread.meta.update"),
    ...target,
    title: Schema.optional(TrimmedNonEmptyString),
    modelSelection: Schema.optional(ModelSelection),
    branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
    worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  }),
  Schema.Struct({
    type: Schema.Literal("thread.runtime-mode.set"),
    ...target,
    runtimeMode: RuntimeMode,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.interaction-mode.set"),
    ...target,
    interactionMode: ProviderInteractionMode,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.approval.respond"),
    ...target,
    requestId: RuntimeRequestId,
    decision: ProviderApprovalDecision,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.user-input.respond"),
    ...target,
    requestId: RuntimeRequestId,
    answers: ProviderUserInputAnswers,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.user-input.dismiss"),
    ...target,
    requestId: RuntimeRequestId,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.checkpoint.revert"),
    ...target,
    turnCount: NonNegativeInt,
  }),
  Schema.Struct({ type: Schema.Literal("thread.archive"), ...target }),
  Schema.Struct({ type: Schema.Literal("thread.unarchive"), ...target }),
  Schema.Struct({ type: Schema.Literal("thread.delete"), ...target }),
  Schema.Struct({ type: Schema.Literal("thread.settle"), ...target }),
  Schema.Struct({ type: Schema.Literal("thread.unsettle"), ...target }),
  Schema.Struct({
    type: Schema.Literal("thread.snooze"),
    ...target,
    snoozedUntil: IsoDateTime,
  }),
  Schema.Struct({ type: Schema.Literal("thread.unsnooze"), ...target }),
  Schema.Struct({ type: Schema.Literal("thread.pin"), ...target }),
  Schema.Struct({ type: Schema.Literal("thread.unpin"), ...target }),
]);
export type LegacyCommand = typeof LegacyCommand.Type;
export type LegacyTurnStart = typeof TurnStart.Type;
