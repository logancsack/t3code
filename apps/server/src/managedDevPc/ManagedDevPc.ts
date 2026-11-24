/**
 * What Aldo's managed cloud workspaces ask of a T3 server (`T3CODE_MANAGED_DEVPC`): whether the
 * workspace is working, its threads in the shape Aldo reads, and commands in the shape Aldo sends.
 * Aldo's control plane and the coordinator beside the server call these through `/api/_devpc`.
 */
import {
  ChatAttachmentId,
  CommandId,
  type ChatAttachment,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadShell,
  type ServerProvider,
  type ThreadId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  attachmentRelativePath,
  createPendingAttachmentId,
  PENDING_ATTACHMENT_THREAD_SEGMENT,
  parseThreadSegmentFromAttachmentId,
} from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import { parseBase64DataUrl } from "../imageMime.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ThreadMessageIntake from "../orchestration-v2/ThreadMessageIntake.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { THREAD_HISTORY_SNAPSHOT_ROW_LIMIT } from "../orchestration-v2/threadHistoryPaging.ts";
import * as DocumentText from "../provider/DocumentText.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TurnInstructions from "./TurnInstructions.ts";
import type {
  LegacyCommand,
  LegacyTurnStart,
  LegacyUploadImageAttachment,
} from "./legacyCommands.ts";
import {
  legacyShellSnapshot,
  legacyThreadDetail,
  legacyThreadShell,
  legacyTurnPage,
  managedActivity,
  managedThreadNeedsTerminalization,
} from "./legacyProjection.ts";

export const MANAGED_DEVPC_DRAIN_DETAIL =
  "The agent run was stopped because the workspace is being paused. The run is complete with an infrastructure interruption; the original request remains available to retry after resume.";

/** Reads could not be answered now; the caller tries again. */
export class ManagedDevPcUnavailableError extends Schema.TaggedError<ManagedDevPcUnavailableError>()(
  "ManagedDevPcUnavailableError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "The managed workspace state is unavailable.";
  }
}

/**
 * A command was not taken. `refused` means the same command can never succeed (it broke a rule,
 * or was rejected before), so the caller drops it; otherwise the server is in trouble and the
 * caller keeps it for another try.
 */
export class ManagedDevPcDispatchError extends Schema.TaggedError<ManagedDevPcDispatchError>()(
  "ManagedDevPcDispatchError",
  { refused: Schema.Boolean, detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return this.detail;
  }
}

const REFUSAL_TAGS = new Set([
  "OrchestratorCommandRejectedError",
  "OrchestratorCommandPreviouslyRejectedError",
  "OrchestratorCommandIdConflictError",
  "OrchestratorThreadAlreadyExistsError",
  "OrchestratorSubagentThreadReadOnlyError",
  "OrchestratorThreadAboveModeLimitError",
  "OrchestratorRuntimeModeAboveCeilingError",
  "ThreadManagementProviderInstanceDisabledError",
  "ThreadManagementThreadNotFoundError",
  "ThreadManagementThreadArchivedError",
  "AttachmentClaimError",
]);

/** The refusal anywhere in a failure's causes, if it has one. */
function findRefusal(
  error: unknown,
): { readonly _tag: string; readonly message: string; readonly detail?: string } | null {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current !== "object" || current === null || seen.has(current)) continue;
    seen.add(current);
    const tagged = current as {
      readonly _tag?: unknown;
      readonly message?: unknown;
      readonly detail?: unknown;
    };
    if (typeof tagged._tag === "string" && REFUSAL_TAGS.has(tagged._tag)) {
      return {
        _tag: tagged._tag,
        message: String(tagged.message ?? tagged._tag),
        ...(typeof tagged.detail === "string" ? { detail: tagged.detail } : {}),
      };
    }
    if ("cause" in current) pending.push(current.cause);
  }
  return null;
}

const isDispatchError = Schema.is(ManagedDevPcDispatchError);

function toDispatchError(commandId: string) {
  return (cause: unknown) => {
    if (isDispatchError(cause)) return cause;
    const refusal = findRefusal(cause);
    if (refusal === null) {
      return new ManagedDevPcDispatchError({
        refused: false,
        detail: cause instanceof Error ? cause.message : "The command could not be taken now.",
        cause,
      });
    }
    return new ManagedDevPcDispatchError({
      refused: true,
      // Aldo recognises a durable rejection by these words, whatever status carries them.
      detail:
        refusal._tag === "OrchestratorCommandPreviouslyRejectedError"
          ? `Command previously rejected (${commandId}): ${refusal.detail ?? refusal.message}`
          : refusal.message,
      cause,
    });
  };
}

const refuse = (detail: string) => new ManagedDevPcDispatchError({ refused: true, detail });

/**
 * The provider catalog as the workspace coordinator needs it: enabled instances, their models,
 * and each model's selectable options. Slash commands, skills and update state are UI concerns.
 */
export function projectManagedProviders(providers: ReadonlyArray<ServerProvider>) {
  return providers
    .filter((provider) => provider.enabled)
    .map((provider) => ({
      instanceId: provider.instanceId,
      driver: provider.driver,
      displayName: provider.displayName ?? provider.instanceId,
      installed: provider.installed,
      status: provider.status,
      auth: provider.auth.status,
      availability: provider.availability ?? "available",
      ...(provider.unavailableReason ? { unavailableReason: provider.unavailableReason } : {}),
      ...(provider.supportedRuntimeModes
        ? { supportedRuntimeModes: [...provider.supportedRuntimeModes] }
        : {}),
      models: provider.models.map((model) => ({
        slug: model.slug,
        name: model.name,
        ...(model.shortName ? { shortName: model.shortName } : {}),
        ...(model.aliases && model.aliases.length > 0 ? { aliases: [...model.aliases] } : {}),
        ...(model.isDefault ? { isDefault: true } : {}),
        ...(model.isLegacy ? { isLegacy: true } : {}),
        options: (model.capabilities?.optionDescriptors ?? []).map((option) =>
          option.type === "select"
            ? {
                id: option.id,
                label: option.label,
                type: option.type,
                ...(option.currentValue !== undefined ? { currentValue: option.currentValue } : {}),
                choices: option.options.map((choice) => ({
                  id: choice.id,
                  label: choice.label,
                  ...(choice.description ? { description: choice.description } : {}),
                  ...(choice.isDefault ? { isDefault: true } : {}),
                })),
              }
            : {
                id: option.id,
                label: option.label,
                type: option.type,
                ...(option.currentValue !== undefined ? { currentValue: option.currentValue } : {}),
              },
        ),
      })),
    }));
}

export interface ManagedDevPcThreadQuery {
  /** The newest turns to answer with; absent answers with the whole thread. */
  readonly turnLimit?: number | undefined;
  /** The `page.beforeCursor` of an earlier answer, for the turns before it. */
  readonly beforeCursor?: number | undefined;
}

type LegacyShell = ReturnType<typeof legacyShellSnapshot>;
type LegacyThread = ReturnType<typeof legacyThreadDetail>;

export class ManagedDevPc extends Context.Service<
  ManagedDevPc,
  {
    readonly activity: Effect.Effect<
      ReturnType<typeof managedActivity>,
      ManagedDevPcUnavailableError
    >;
    readonly shellSnapshot: Effect.Effect<LegacyShell, ManagedDevPcUnavailableError>;
    /** None when the thread does not exist. */
    readonly threadSnapshot: (
      threadId: ThreadId,
      query: ManagedDevPcThreadQuery,
    ) => Effect.Effect<
      Option.Option<{
        readonly snapshotSequence: number;
        readonly thread: LegacyThread;
        readonly page?: ReturnType<typeof legacyTurnPage>["page"];
      }>,
      ManagedDevPcUnavailableError
    >;
    readonly providers: Effect.Effect<{
      readonly providers: ReturnType<typeof projectManagedProviders>;
      readonly threadProviderContinuation: true;
      readonly threadModelHandoff: true;
    }>;
    readonly dispatch: (
      command: LegacyCommand,
    ) => Effect.Effect<{ readonly sequence: number }, ManagedDevPcDispatchError>;
    /** Stops every run before the workspace pauses, so none is cut off mid-write. */
    readonly drain: Effect.Effect<
      { readonly drained: true; readonly terminalizedRuns: number },
      ManagedDevPcUnavailableError
    >;
  }
>()("t3/managedDevPc/ManagedDevPc") {}

const unavailable = (cause: unknown) => new ManagedDevPcUnavailableError({ cause });

export const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const turnInstructions = yield* TurnInstructions.TurnInstructions;
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const intakeContext = yield* Effect.context<
    | ThreadManagementService.ThreadManagementService
    | ThreadLaunchService.ThreadLaunchService
    | FileSystem.FileSystem
    | ServerConfig.ServerConfig
    | ServerSettings.ServerSettingsService
    | DocumentText.DocumentText
  >();

  const loadShells = Effect.fn("ManagedDevPc.loadShells")(function* () {
    const [active, archived] = yield* Effect.all(
      [
        threads.getShellSnapshot({ location: "active" }),
        threads.getShellSnapshot({ location: "archive" }),
      ],
      { concurrency: 2 },
    );
    const byId = new Map<string, OrchestrationV2ThreadShell>();
    for (const thread of [
      ...active.threads,
      ...active.archivedThreads,
      ...archived.threads,
      ...archived.archivedThreads,
    ]) {
      byId.set(thread.id, thread);
    }
    return {
      snapshotSequence: Math.max(active.snapshotSequence, archived.snapshotSequence),
      threads: [...byId.values()],
    };
  });

  const shellSnapshot = Effect.gen(function* () {
    const shells = yield* loadShells();
    return legacyShellSnapshot({
      ...shells,
      projects: yield* projects.listShells(),
      now: yield* DateTime.now,
    });
  }).pipe(Effect.mapError(unavailable), Effect.withSpan("ManagedDevPc.shellSnapshot"));

  // Subagent children count here: their work is the workspace's work.
  const liveShells = threads
    .getShellSnapshot({ location: "active" })
    .pipe(
      Effect.map((snapshot) =>
        snapshot.threads.filter((thread) => thread.deletedAt === null).map(legacyThreadShell),
      ),
    );

  const activity = Effect.gen(function* () {
    return managedActivity(yield* liveShells, yield* Clock.currentTimeMillis);
  }).pipe(Effect.mapError(unavailable), Effect.withSpan("ManagedDevPc.activity"));

  const threadSnapshot = Effect.fn("ManagedDevPc.threadSnapshot")(function* (
    threadId: ThreadId,
    query: ManagedDevPcThreadQuery,
  ) {
    const shell = yield* threads.getThreadShell(threadId);
    if (shell === null || shell.deletedAt !== null) return Option.none();
    // Only the newest turns are read when that is all that was asked for.
    const windowed = query.turnLimit !== undefined && query.beforeCursor === undefined;
    const snapshot = windowed
      ? yield* threads.getThreadSnapshotWindow(threadId, {
          rowLimit: THREAD_HISTORY_SNAPSHOT_ROW_LIMIT,
          userTurnLimit: query.turnLimit,
        })
      : yield* threads.getThreadSnapshot(threadId);
    const instructions = yield* turnInstructions.supplied(
      snapshot.projection.runs.map((run) => run.id),
    );
    if (query.turnLimit === undefined) {
      return Option.some({
        snapshotSequence: snapshot.snapshotSequence,
        thread: legacyThreadDetail({ shell, projection: snapshot.projection, instructions }),
      });
    }
    const loaded = new Set(snapshot.projection.turnItems.map((item) => item.runId));
    const runs = windowed
      ? snapshot.projection.runs.filter((run) => loaded.has(run.id))
      : snapshot.projection.runs;
    const { runIds, page } = legacyTurnPage({
      runs,
      turnLimit: query.turnLimit,
      beforeCursor: query.beforeCursor,
      olderUnloaded: windowed && runs.every((run) => run.ordinal > 1) && runs.length > 0,
    });
    return Option.some({
      snapshotSequence: snapshot.snapshotSequence,
      thread: legacyThreadDetail({
        shell,
        projection: snapshot.projection,
        runIds,
        instructions,
      }),
      page,
    });
  }, Effect.mapError(unavailable));

  const providers = providerRegistry.getProviders.pipe(
    Effect.map((list) => ({
      providers: projectManagedProviders(list),
      threadProviderContinuation: true as const,
      threadModelHandoff: true as const,
    })),
  );

  const send = (command: OrchestrationV2Command) =>
    ThreadMessageIntake.dispatchCommand(
      ThreadManagementService.withCreationProvenance(command, {
        createdBy: "user",
        creationSource: "web",
      }),
      { managesProviders: false },
    ).pipe(Effect.provide(intakeContext));

  /** Stores an inline image as a pending upload, which sending then claims for its thread. */
  const storeInlineImage = Effect.fn("ManagedDevPc.storeInlineImage")(function* (
    image: LegacyUploadImageAttachment,
  ) {
    const parsed = parseBase64DataUrl(image.dataUrl);
    if (parsed === null) return yield* refuse(`Attachment '${image.name}' is not a base64 image.`);
    const bytes = Buffer.from(parsed.base64, "base64");
    if (bytes.byteLength !== image.sizeBytes) {
      return yield* refuse(`Attachment '${image.name}' does not match its stated size.`);
    }
    const attachment: ChatAttachment = {
      type: "image",
      id: ChatAttachmentId.make(createPendingAttachmentId()),
      name: image.name,
      mimeType: parsed.mimeType.toLowerCase(),
      sizeBytes: image.sizeBytes,
    };
    const relativePath = attachmentRelativePath(attachment);
    if (relativePath === null) return yield* refuse(`Attachment '${image.name}' cannot be stored.`);
    yield* fileSystem.makeDirectory(config.attachmentsDir, { recursive: true });
    yield* fileSystem.writeFile(path.join(config.attachmentsDir, relativePath), bytes);
    return attachment;
  });

  const prepareAttachments = Effect.fn("ManagedDevPc.prepareAttachments")(function* (
    command: LegacyTurnStart,
  ) {
    // A command already taken replays its receipt; its files were stored the first time.
    if (yield* threads.hasReceipt(command.commandId)) {
      return command.message.attachments.filter(
        (attachment): attachment is ChatAttachment =>
          !("dataUrl" in attachment) &&
          parseThreadSegmentFromAttachmentId(attachment.id) !== PENDING_ATTACHMENT_THREAD_SEGMENT,
      );
    }
    return yield* Effect.forEach(command.message.attachments, (attachment) =>
      "dataUrl" in attachment ? storeInlineImage(attachment) : Effect.succeed(attachment),
    );
  });

  const startTurn = Effect.fn("ManagedDevPc.startTurn")(function* (command: LegacyTurnStart) {
    const shell = yield* threads.getThreadShell(command.threadId);
    const attachments = yield* prepareAttachments(command);
    const create = command.bootstrap?.createThread;
    if (shell === null || shell.deletedAt !== null) {
      if (create === undefined) return yield* refuse(`Thread ${command.threadId} does not exist.`);
      const launched = yield* ThreadMessageIntake.launchThread({
        commandId: command.commandId,
        threadId: command.threadId,
        reuseExistingThread: true,
        projectId: create.projectId,
        title: create.title,
        modelSelection: command.modelSelection ?? create.modelSelection,
        runtimeMode: command.runtimeMode ?? create.runtimeMode,
        interactionMode: command.interactionMode ?? create.interactionMode,
        workspaceStrategy:
          create.worktreePath === null
            ? { type: "root", ...(create.branch === null ? {} : { branch: create.branch }) }
            : {
                type: "existing_worktree",
                worktreePath: create.worktreePath,
                ...(create.branch === null ? {} : { branch: create.branch }),
              },
        initialMessage: {
          messageId: command.message.messageId,
          text: command.message.text,
          attachments,
        },
        createdBy: "user",
        creationSource: "web",
      }).pipe(Effect.provide(intakeContext));
      return { sequence: launched.sequence ?? 0 };
    }

    // As a client changes them before a turn. A replay leaves the thread as it now is.
    if (!(yield* threads.hasReceipt(command.commandId))) {
      if (command.runtimeMode !== undefined && command.runtimeMode !== shell.runtimeMode) {
        yield* send({
          type: "thread.runtime-mode.set",
          commandId: CommandId.make(`${command.commandId}:runtime-mode`),
          threadId: command.threadId,
          runtimeMode: command.runtimeMode,
        });
      }
      // Carrying out a plan leaves plan mode with the same command that starts the work.
      if (
        command.interactionMode !== undefined &&
        command.interactionMode !== shell.interactionMode
      ) {
        yield* send({
          type: "thread.interaction-mode.set",
          commandId: CommandId.make(`${command.commandId}:interaction-mode`),
          threadId: command.threadId,
          interactionMode: command.interactionMode,
        });
      }
    }
    const busy = shell.activeRunId !== null || shell.status === "queued";
    return yield* send({
      type: "message.dispatch",
      commandId: command.commandId,
      threadId: command.threadId,
      messageId: command.message.messageId,
      text: command.message.text,
      attachments,
      ...(command.titleSeed === undefined ? {} : { titleSeed: command.titleSeed }),
      ...(command.modelSelection === undefined ? {} : { modelSelection: command.modelSelection }),
      ...(command.sourceProposedPlan === undefined
        ? {}
        : { sourcePlanRef: command.sourceProposedPlan }),
      ...(command.continuation === undefined
        ? {}
        : { manualContinuationOfRunId: command.continuation.turnId }),
      // A message sent under a running turn waits its turn, as the first model queued it.
      dispatchMode: { type: busy ? "queue_after_active" : "start_immediately" },
      createdBy: "user",
      creationSource: "web",
    });
  });

  const revertCheckpoint = Effect.fn("ManagedDevPc.revertCheckpoint")(function* (
    command: Extract<LegacyCommand, { readonly type: "thread.checkpoint.revert" }>,
  ) {
    const records = yield* threads.getThreadRecords(command.threadId, ["checkpoints"]);
    const checkpoint = records.checkpoints.findLast(
      (candidate) =>
        candidate.status === "ready" &&
        (candidate.appRunOrdinal ?? candidate.ordinalWithinScope) === command.turnCount,
    );
    if (checkpoint === undefined) {
      return yield* refuse(`Thread ${command.threadId} has no checkpoint ${command.turnCount}.`);
    }
    return yield* send({
      type: "checkpoint.rollback",
      commandId: command.commandId,
      threadId: command.threadId,
      scopeId: checkpoint.scopeId,
      checkpointId: checkpoint.id,
    });
  });

  const updateMeta = Effect.fn("ManagedDevPc.updateMeta")(function* (
    command: Extract<LegacyCommand, { readonly type: "thread.meta.update" }>,
  ) {
    const metadata =
      command.title !== undefined ||
      command.branch !== undefined ||
      command.worktreePath !== undefined;
    let result: { readonly sequence: number } | undefined;
    if (metadata) {
      result = yield* send({
        type: "thread.metadata.update",
        commandId: command.commandId,
        threadId: command.threadId,
        ...(command.title === undefined ? {} : { title: command.title }),
        ...(command.branch === undefined ? {} : { branch: command.branch }),
        ...(command.worktreePath === undefined ? {} : { worktreePath: command.worktreePath }),
      });
    }
    if (command.modelSelection !== undefined) {
      result = yield* send({
        type: "thread.model-selection.set",
        commandId: metadata ? CommandId.make(`${command.commandId}:model`) : command.commandId,
        threadId: command.threadId,
        modelSelection: command.modelSelection,
      });
    }
    return result ?? (yield* refuse("thread.meta.update names nothing to change."));
  });

  const translate = (command: LegacyCommand) => {
    const { commandId, threadId } = command;
    switch (command.type) {
      case "thread.turn.start":
        return startTurn(command);
      case "thread.meta.update":
        return updateMeta(command);
      case "thread.checkpoint.revert":
        return revertCheckpoint(command);
      case "thread.turn.interrupt":
        return send({ type: "thread.stop", commandId, threadId });
      case "thread.runtime-mode.set":
        return send({ ...command, type: "thread.runtime-mode.set" });
      case "thread.interaction-mode.set":
        return send({ ...command, type: "thread.interaction-mode.set" });
      case "thread.approval.respond":
        return send({
          type: "runtime-request.respond",
          commandId,
          threadId,
          requestId: command.requestId,
          decision: command.decision,
        });
      case "thread.user-input.respond":
        return send({
          type: "runtime-request.respond",
          commandId,
          threadId,
          requestId: command.requestId,
          answers: command.answers,
        });
      case "thread.user-input.dismiss":
        return send({ ...command, type: "thread.user-input.dismiss" });
      case "thread.snooze":
        return send({ ...command, type: "thread.snooze" });
      case "thread.unsettle":
      case "thread.unsnooze":
        return send({ type: command.type, commandId, threadId, reason: "user" });
      case "thread.archive":
      case "thread.unarchive":
      case "thread.delete":
      case "thread.settle":
      case "thread.pin":
      case "thread.unpin":
        return send({ type: command.type, commandId, threadId });
    }
  };

  const dispatch = Effect.fn("ManagedDevPc.dispatch")(function* (command: LegacyCommand) {
    const result = yield* translate(command).pipe(
      Effect.mapError(toDispatchError(command.commandId)),
    );
    return { sequence: result.sequence };
  });

  const drain = Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    const targets = (yield* liveShells).filter((thread) =>
      managedThreadNeedsTerminalization(thread, nowMs),
    );
    yield* Effect.forEach(
      targets,
      (thread) =>
        threads
          .dispatch({
            type: "thread.stop",
            commandId: CommandId.make(`server:managed-drain:${thread.id}:${nowMs}`),
            threadId: thread.id,
            reason: MANAGED_DEVPC_DRAIN_DETAIL,
          })
          // A run that ended on its own meanwhile needs no stop.
          .pipe(Effect.ignore),
      { concurrency: 1, discard: true },
    );
    return { drained: true as const, terminalizedRuns: targets.length };
  }).pipe(Effect.mapError(unavailable), Effect.withSpan("ManagedDevPc.drain"));

  return ManagedDevPc.of({ activity, shellSnapshot, threadSnapshot, providers, dispatch, drain });
});

export const layer = Layer.effect(ManagedDevPc, make);
