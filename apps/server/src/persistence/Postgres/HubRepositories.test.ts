/**
 * The hub's Postgres repositories against the standalone SQLite ones: the same
 * commands or calls must produce the same reads, and one tenant never sees
 * another's rows even when they reuse the same ids. Runs only with
 * T3_HUB_TEST_DATABASE_URL (see `hubTestDatabase.ts`).
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AuthStandardClientScopes,
  AuthSessionId,
  CheckpointRef,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as ServerConfig from "../../config.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { OrchestrationLayerLive } from "../../orchestration/runtimeLayer.ts";
import { RepositoryIdentityResolver } from "../../project/RepositoryIdentityResolver.ts";
import * as AuthPairingLinks from "../AuthPairingLinks.ts";
import * as AuthSessions from "../AuthSessions.ts";
import { ProjectionCheckpointRepositoryLive } from "../Layers/ProjectionCheckpoints.ts";
import { layerConfig as ServerPersistenceLive, SqlitePersistenceMemory } from "../Layers/Sqlite.ts";
import * as ProviderSessionRuntime from "../ProviderSessionRuntime.ts";
import { ProjectionCheckpointRepository } from "../Services/ProjectionCheckpoints.ts";
import {
  hubTestDatabaseLayer,
  hubTestDatabaseUrl,
  makeHubTestSchema,
  type HubTestSchema,
} from "./hubTestDatabase.ts";

const withSchema = <A, E, R>(use: (schema: HubTestSchema) => Effect.Effect<A, E, R>) =>
  Effect.scoped(Effect.flatMap(makeHubTestSchema(hubTestDatabaseUrl!), use)).pipe(
    Effect.provide(Reactivity.layer),
  );

const platform = Layer.mergeAll(
  ServerConfig.layerTest(process.cwd(), { prefix: "t3-hub-repositories-" }),
  Layer.succeed(RepositoryIdentityResolver, { resolve: () => Effect.succeed(null) }),
).pipe(Layer.provideMerge(NodeServices.layer));

/** Standalone persistence: a fresh migrated in-memory SQLite database. */
const sqlite = () => Layer.fresh(SqlitePersistenceMemory);

/** Hub persistence for `tenantId`: the same live layers, selected by HubDatabase. */
const hub = (schema: HubTestSchema, tenantId: string) =>
  ServerPersistenceLive.pipe(
    Layer.provideMerge(hubTestDatabaseLayer(schema, tenantId)),
    Layer.provide(platform),
  );

const at = (second: number) => `2026-09-25T00:00:${String(second).padStart(2, "0")}.000Z`;
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" };
const projectId = ProjectId.make("project-shared");
const threadId = ThreadId.make("thread-shared");
const otherThreadId = ThreadId.make("thread-archived");
const turnId = TurnId.make("turn-1");

// Both tenants reuse the same ids: isolation must come from the tenant key.
const commandsFor = (label: string): ReadonlyArray<OrchestrationCommand> => [
  {
    type: "project.create",
    commandId: CommandId.make("cmd-project-create"),
    projectId,
    title: `Project of ${label}`,
    workspaceRoot: `/workspace/p/${projectId}`,
    defaultModelSelection: modelSelection,
    createdAt: at(1),
  },
  {
    type: "thread.create",
    commandId: CommandId.make("cmd-thread-create"),
    threadId,
    projectId,
    title: `Thread of ${label}`,
    modelSelection,
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    runtimeMode: "approval-required",
    branch: null,
    worktreePath: `/workspace/t/${threadId}`,
    createdAt: at(2),
  },
  {
    type: "thread.turn.start",
    commandId: CommandId.make("cmd-turn-start"),
    threadId,
    message: {
      messageId: MessageId.make("msg-user-1"),
      role: "user",
      text: `hello from ${label}`,
      attachments: [],
    },
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    runtimeMode: "approval-required",
    createdAt: at(3),
  },
  {
    type: "thread.session.set",
    commandId: CommandId.make("cmd-session-set"),
    threadId,
    session: {
      threadId,
      status: "running",
      providerName: "codex",
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeMode: "approval-required",
      activeTurnId: turnId,
      lastError: null,
      updatedAt: at(4),
    },
    createdAt: at(4),
  },
  {
    type: "thread.activity.append",
    commandId: CommandId.make("cmd-activity-1"),
    threadId,
    activity: {
      id: EventId.make("activity-1"),
      tone: "tool",
      kind: "tool.completed",
      summary: `tool ran for ${label}`,
      // JSON payloads may carry escaped NULs; Postgres keeps them as text.
      payload: { owner: label, output: "binary\u0000tail" },
      turnId,
      createdAt: at(5),
    },
    createdAt: at(5),
  },
  {
    type: "thread.message.assistant.delta",
    commandId: CommandId.make("cmd-assistant-delta-1"),
    threadId,
    messageId: MessageId.make("msg-assistant-1"),
    delta: `reply to ${label}`,
    turnId,
    createdAt: at(6),
  },
  {
    type: "thread.message.assistant.complete",
    commandId: CommandId.make("cmd-assistant-complete-1"),
    threadId,
    messageId: MessageId.make("msg-assistant-1"),
    turnId,
    createdAt: at(7),
  },
  {
    type: "thread.proposed-plan.upsert",
    commandId: CommandId.make("cmd-plan-1"),
    threadId,
    proposedPlan: {
      id: "plan-1",
      turnId,
      planMarkdown: `# Plan for ${label}`,
      implementedAt: null,
      implementationThreadId: null,
      createdAt: at(8),
      updatedAt: at(8),
    },
    createdAt: at(8),
  },
  {
    type: "thread.turn.diff.complete",
    commandId: CommandId.make("cmd-diff-1"),
    threadId,
    turnId,
    completedAt: at(9),
    checkpointRef: CheckpointRef.make("refs/t3/checkpoints/thread-shared/turn/1"),
    status: "ready",
    files: [{ path: "notes.txt", kind: "modified", additions: 1, deletions: 0 }],
    assistantMessageId: MessageId.make("msg-assistant-1"),
    checkpointTurnCount: 1,
    createdAt: at(9),
  },
  {
    type: "thread.meta.update",
    commandId: CommandId.make("cmd-thread-rename"),
    threadId,
    title: `Renamed thread of ${label}`,
  },
  {
    type: "thread.create",
    commandId: CommandId.make("cmd-thread-archived-create"),
    threadId: otherThreadId,
    projectId,
    title: `Archived thread of ${label}`,
    modelSelection,
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    runtimeMode: "full-access",
    branch: null,
    worktreePath: null,
    createdAt: at(10),
  },
  {
    type: "thread.archive",
    commandId: CommandId.make("cmd-thread-archive"),
    threadId: otherThreadId,
  },
];

/** Dispatches the scenario and reads back through every snapshot query method. */
const orchestrationScenario = (label: string) =>
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;
    const query = yield* ProjectionSnapshotQuery;
    for (const command of commandsFor(label)) {
      yield* engine.dispatch(command);
    }
    const events = yield* Stream.runCollect(engine.readEvents(0));
    return {
      events: Array.from(events, (event) => ({
        sequence: event.sequence,
        type: event.type,
        aggregateId: event.aggregateId,
        payload: event.payload,
      })),
      commandReadModel: yield* query.getCommandReadModel(),
      snapshot: yield* query.getSnapshot(),
      shell: yield* query.getShellSnapshot(),
      archivedShell: yield* query.getArchivedShellSnapshot(),
      counts: yield* query.getCounts(),
      snapshotSequence: yield* query.getSnapshotSequence(),
      projectByRoot: yield* query.getActiveProjectByWorkspaceRoot(`/workspace/p/${projectId}`),
      projectShell: yield* query.getProjectShellById(projectId),
      firstThread: yield* query.getFirstActiveThreadIdByProjectId(projectId),
      checkpointContext: yield* query.getThreadCheckpointContext(threadId),
      fullDiffContext: yield* query.getFullThreadDiffContext(threadId, 1),
      threadShell: yield* query.getThreadShellById(threadId),
      threadDetail: yield* query.getThreadDetailById(threadId),
      detailSnapshot: yield* query.getThreadDetailSnapshot(threadId),
      windowedDetail: yield* query.getThreadDetailSnapshot(threadId, { turnLimit: 1 }),
      search: yield* query.searchThreads({ query: "RENAMED" }),
    };
  });

const runOrchestration = <E>(persistence: Layer.Layer<SqlClient.SqlClient, E>, label: string) =>
  orchestrationScenario(label).pipe(
    Effect.provide(
      OrchestrationLayerLive.pipe(Layer.provideMerge(persistence), Layer.provideMerge(platform)),
    ),
  );

describe.skipIf(hubTestDatabaseUrl === undefined)("hub repositories", () => {
  it.effect("match SQLite for every snapshot read and isolate tenants that reuse ids", () =>
    withSchema((schema) =>
      Effect.gen(function* () {
        const standalone = yield* runOrchestration(sqlite(), "alice");
        const alice = yield* runOrchestration(hub(schema, "tenant-alice"), "alice");
        assert.deepStrictEqual(alice, standalone);

        const bob = yield* runOrchestration(hub(schema, "tenant-bob"), "bob");
        assert.deepStrictEqual(
          bob.events.map((event) => event.sequence),
          alice.events.map((event) => event.sequence),
        );
        assert.strictEqual(bob.events[0]?.sequence, 1);
        assert.deepStrictEqual(
          bob.shell.threads.map((thread) => thread.title),
          ["Renamed thread of bob"],
        );
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        assert.notInclude(JSON.stringify(bob), "alice");

        // A new engine for alice rebuilds the same read model from Postgres.
        const reread = yield* Effect.gen(function* () {
          const query = yield* ProjectionSnapshotQuery;
          return {
            commandReadModel: yield* query.getCommandReadModel(),
            shell: yield* query.getShellSnapshot(),
          };
        }).pipe(
          Effect.provide(
            OrchestrationLayerLive.pipe(
              Layer.provideMerge(hub(schema, "tenant-alice")),
              Layer.provideMerge(platform),
            ),
          ),
        );
        assert.deepStrictEqual(reread.commandReadModel, alice.commandReadModel);
        assert.deepStrictEqual(reread.shell, alice.shell);
      }),
    ),
  );

  it.effect("keep auth sessions and pairing links per tenant", () =>
    withSchema((schema) =>
      Effect.gen(function* () {
        const t0 = DateTime.makeUnsafe("2026-09-25T00:00:00.000Z");
        const later = (minutes: number) => DateTime.add(t0, { minutes });
        const client = {
          label: "browser",
          ipAddress: "127.0.0.1",
          userAgent: "test",
          deviceType: "desktop" as const,
          os: null,
          browser: null,
        };
        const sessionA = AuthSessionId.make("session-a");
        const sessionB = AuthSessionId.make("session-b");

        const scenario = Effect.gen(function* () {
          const sessions = yield* AuthSessions.AuthSessionRepository;
          const links = yield* AuthPairingLinks.AuthPairingLinkRepository;
          for (const [sessionId, minute] of [
            [sessionA, 1],
            [sessionB, 2],
          ] as const) {
            yield* sessions.create({
              sessionId,
              subject: "owner",
              scopes: AuthStandardClientScopes,
              method: "browser-session-cookie",
              client,
              issuedAt: later(minute),
              expiresAt: later(60),
            });
          }
          yield* sessions.setLastConnectedAt({ sessionId: sessionA, lastConnectedAt: later(3) });
          yield* sessions.setClientConnection({
            sessionId: sessionA,
            surface: "web",
            appVersion: "1.2.3",
          });
          const activeBefore = yield* sessions.listActive({ now: later(4) });
          const revoked = yield* sessions.revoke({ sessionId: sessionA, revokedAt: later(5) });
          const revokedAgain = yield* sessions.revoke({ sessionId: sessionA, revokedAt: later(5) });
          const others = yield* sessions.revokeAllExcept({
            currentSessionId: sessionB,
            revokedAt: later(6),
          });

          for (const [id, credential, proofKeyThumbprint] of [
            ["link-1", "credential-1", null],
            ["link-2", "credential-2", "thumbprint"],
          ] as const) {
            yield* links.create({
              id,
              credential,
              method: "one-time-token",
              scopes: AuthStandardClientScopes,
              subject: "owner",
              label: null,
              proofKeyThumbprint,
              createdAt: later(1),
              expiresAt: later(30),
            });
          }
          const linksBefore = yield* links.listActive({ now: later(2) });
          const consumed = yield* links.consumeAvailable({
            credential: "credential-1",
            proofKeyThumbprint: null,
            consumedAt: later(3),
            now: later(3),
          });
          const consumedTwice = yield* links.consumeAvailable({
            credential: "credential-1",
            proofKeyThumbprint: null,
            consumedAt: later(3),
            now: later(3),
          });
          const wrongProof = yield* links.consumeAvailable({
            credential: "credential-2",
            proofKeyThumbprint: "other",
            consumedAt: later(4),
            now: later(4),
          });
          const revokedLink = yield* links.revoke({ id: "link-2", revokedAt: later(5) });
          return {
            session: yield* sessions.getById({ sessionId: sessionA }),
            activeBefore,
            activeAfter: yield* sessions.listActive({ now: later(7) }),
            revoked,
            revokedAgain,
            others,
            linksBefore,
            consumed,
            consumedTwice,
            wrongProof,
            revokedLink,
            byCredential: yield* links.getByCredential({ credential: "credential-1" }),
            linksAfter: yield* links.listActive({ now: later(6) }),
          };
        });
        const repositories = <E>(persistence: Layer.Layer<SqlClient.SqlClient, E>) =>
          Layer.mergeAll(AuthSessions.layer, AuthPairingLinks.layer).pipe(
            Layer.provideMerge(persistence),
          );

        const standalone = yield* scenario.pipe(Effect.provide(repositories(sqlite())));
        const tenantA = yield* scenario.pipe(Effect.provide(repositories(hub(schema, "tenant-a"))));
        assert.deepStrictEqual(tenantA, standalone);
        assert.isTrue(Option.isSome(tenantA.session));
        assert.strictEqual(tenantA.activeBefore.length, 2);

        // Another tenant sees none of it, even for the same ids and credentials.
        yield* Effect.gen(function* () {
          const sessions = yield* AuthSessions.AuthSessionRepository;
          const links = yield* AuthPairingLinks.AuthPairingLinkRepository;
          assert.isTrue(Option.isNone(yield* sessions.getById({ sessionId: sessionB })));
          assert.deepStrictEqual(yield* sessions.listActive({ now: later(4) }), []);
          assert.deepStrictEqual(
            yield* sessions.revokeAllExcept({ currentSessionId: sessionA, revokedAt: later(8) }),
            [],
          );
          assert.isTrue(
            Option.isNone(yield* links.getByCredential({ credential: "credential-1" })),
          );
          assert.isTrue(
            Option.isNone(
              yield* links.consumeAvailable({
                credential: "credential-2",
                proofKeyThumbprint: "thumbprint",
                consumedAt: later(2),
                now: later(2),
              }),
            ),
          );
        }).pipe(Effect.provide(repositories(hub(schema, "tenant-b"))));

        // A later process for tenant-a still finds its rows.
        const persisted = yield* Effect.flatMap(AuthSessions.AuthSessionRepository, (sessions) =>
          sessions.getById({ sessionId: sessionB }),
        ).pipe(Effect.provide(repositories(hub(schema, "tenant-a"))));
        assert.isTrue(Option.isSome(persisted));
      }),
    ),
  );

  it.effect("keep provider runtime and checkpoint rows per tenant", () =>
    withSchema((schema) =>
      Effect.gen(function* () {
        const scenario = Effect.gen(function* () {
          const runtime = yield* ProviderSessionRuntime.ProviderSessionRuntimeRepository;
          const checkpoints = yield* ProjectionCheckpointRepository;
          for (const [thread, seen] of [
            [ThreadId.make("thread-b"), at(2)],
            [ThreadId.make("thread-a"), at(1)],
          ] as const) {
            yield* runtime.upsert({
              threadId: thread,
              providerName: "codex",
              providerInstanceId: ProviderInstanceId.make("codex"),
              adapterKey: "codex",
              runtimeMode: "full-access",
              status: "running",
              lastSeenAt: seen,
              resumeCursor: { threadId: `${thread}-provider`, cursor: 7 },
              runtimePayload: null,
            });
          }
          yield* runtime.upsert({
            threadId: ThreadId.make("thread-a"),
            providerName: "codex",
            providerInstanceId: null,
            adapterKey: "codex",
            runtimeMode: "approval-required",
            status: "stopped",
            lastSeenAt: at(3),
            resumeCursor: null,
            runtimePayload: { reason: "stopped" },
          });
          yield* runtime.deleteByThreadId({ threadId: ThreadId.make("thread-b") });

          const checkpoint = {
            threadId,
            turnId,
            checkpointTurnCount: 1,
            checkpointRef: CheckpointRef.make("refs/t3/checkpoints/thread-shared/turn/1"),
            status: "ready" as const,
            files: [{ path: "a.ts", kind: "modified", additions: 2, deletions: 1 }],
            assistantMessageId: null,
            completedAt: at(4),
          };
          yield* checkpoints.upsert(checkpoint);
          return {
            runtime: yield* runtime.list(),
            runtimeA: yield* runtime.getByThreadId({ threadId: ThreadId.make("thread-a") }),
            checkpoints: yield* checkpoints.listByThreadId({ threadId }),
            checkpoint: yield* checkpoints.getByThreadAndTurnCount({
              threadId,
              checkpointTurnCount: 1,
            }),
          };
        });
        const repositories = <E>(persistence: Layer.Layer<SqlClient.SqlClient, E>) =>
          Layer.mergeAll(ProviderSessionRuntime.layer, ProjectionCheckpointRepositoryLive).pipe(
            Layer.provideMerge(persistence),
          );

        const standalone = yield* scenario.pipe(Effect.provide(repositories(sqlite())));
        const tenantA = yield* scenario.pipe(Effect.provide(repositories(hub(schema, "tenant-a"))));
        assert.deepStrictEqual(tenantA, standalone);
        assert.strictEqual(tenantA.runtime.length, 1);

        yield* Effect.gen(function* () {
          const runtime = yield* ProviderSessionRuntime.ProviderSessionRuntimeRepository;
          const checkpoints = yield* ProjectionCheckpointRepository;
          assert.deepStrictEqual(yield* runtime.list(), []);
          assert.deepStrictEqual(yield* checkpoints.listByThreadId({ threadId }), []);
          yield* checkpoints.deleteByThreadId({ threadId });
        }).pipe(Effect.provide(repositories(hub(schema, "tenant-b"))));

        // tenant-b's delete did not reach tenant-a.
        const stillThere = yield* Effect.flatMap(ProjectionCheckpointRepository, (checkpoints) =>
          checkpoints.listByThreadId({ threadId }),
        ).pipe(Effect.provide(repositories(hub(schema, "tenant-a"))));
        assert.strictEqual(stillThere.length, 1);
      }),
    ),
  );
});
