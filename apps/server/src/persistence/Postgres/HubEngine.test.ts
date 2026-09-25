/**
 * Hub prototype: two users' orchestration engines in one process over one
 * Postgres database. Runs only when T3_HUB_TEST_DATABASE_URL points at a
 * disposable database, e.g.
 *   T3_HUB_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54339/hub
 */
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import * as NodeCrypto from "node:crypto";

import * as PgClient from "@effect/sql-pg/PgClient";
import { assert, expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { hubPgTypes } from "../Layers/Postgres.ts";
import { makeHubSharedLayer, makeHubUserEngineLayer, type HubSharedServices } from "./HubEngine.ts";
import { HUB_TENANT_TABLES, hubRowLevelSecurityStatements } from "./Schema.ts";

const databaseUrl = process.env.T3_HUB_TEST_DATABASE_URL;
const runId = NodeCrypto.randomUUID().slice(0, 8);
const userA = `test-user-a-${runId}`;
const userB = `test-user-b-${runId}`;
const createdAt = "2026-09-25T00:00:00.000Z";
const at = (second: number) => `2026-09-25T00:00:${String(second).padStart(2, "0")}.000Z`;
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" };

// Both users deliberately reuse the same project, thread, message, and command
// ids: isolation must come from the tenant key, not from id uniqueness.
const commandsFor = (label: string): ReadonlyArray<OrchestrationCommand> => [
  {
    type: "project.create",
    commandId: CommandId.make("cmd-project-create"),
    projectId: ProjectId.make("project-shared"),
    title: `Project of ${label}`,
    workspaceRoot: `/workspace/${label}`,
    defaultModelSelection: modelSelection,
    createdAt: at(1),
  },
  {
    type: "thread.create",
    commandId: CommandId.make("cmd-thread-create"),
    threadId: ThreadId.make("thread-shared"),
    projectId: ProjectId.make("project-shared"),
    title: `Thread of ${label}`,
    modelSelection,
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    runtimeMode: "approval-required",
    branch: null,
    worktreePath: null,
    createdAt: at(2),
  },
  {
    type: "thread.turn.start",
    commandId: CommandId.make("cmd-turn-start"),
    threadId: ThreadId.make("thread-shared"),
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
    type: "thread.activity.append",
    commandId: CommandId.make("cmd-activity-1"),
    threadId: ThreadId.make("thread-shared"),
    activity: {
      id: EventId.make("activity-1"),
      tone: "tool",
      kind: "tool.completed",
      summary: `tool ran for ${label}`,
      payload: { owner: label },
      turnId: null,
      createdAt: at(4),
    },
    createdAt: at(5),
  },
  {
    type: "thread.message.assistant.delta",
    commandId: CommandId.make("cmd-assistant-delta-1"),
    threadId: ThreadId.make("thread-shared"),
    messageId: MessageId.make("msg-assistant-1"),
    delta: `reply to ${label}`,
    createdAt: at(6),
  },
  {
    type: "thread.message.assistant.complete",
    commandId: CommandId.make("cmd-assistant-complete-1"),
    threadId: ThreadId.make("thread-shared"),
    messageId: MessageId.make("msg-assistant-1"),
    createdAt: at(7),
  },
];

const extraThreadFor = (label: string): OrchestrationCommand => ({
  type: "thread.create",
  commandId: CommandId.make("cmd-thread-extra-create"),
  threadId: ThreadId.make("thread-extra"),
  projectId: ProjectId.make("project-shared"),
  title: `Extra thread of ${label}`,
  modelSelection,
  interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
  runtimeMode: "approval-required",
  branch: null,
  worktreePath: null,
  createdAt,
});

type UserEngine = {
  readonly run: <A, E>(
    effect: Effect.Effect<A, E, OrchestrationEngineService | ProjectionSnapshotQuery>,
  ) => Effect.Effect<A, E>;
  readonly scope: Scope.Closeable;
};

// Builds one user's engine (bootstrap + command read model) over the shared
// pool and platform services, in its own scope so it can be evicted.
const activateUser = (userId: string) =>
  Effect.gen(function* () {
    const shared = yield* Effect.context<HubSharedServices>();
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(makeHubUserEngineLayer({ userId, shared }), scope);
    return {
      scope,
      run: (effect) => Effect.provideContext(effect, context),
    } satisfies UserEngine;
  });

const readEvents = (user: UserEngine, fromSequenceExclusive = 0) =>
  user.run(
    Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService;
      const chunk = yield* Stream.runCollect(engine.readEvents(fromSequenceExclusive));
      return Array.from(chunk) as OrchestrationEvent[];
    }),
  );

const dispatch = (user: UserEngine, command: OrchestrationCommand) =>
  user.run(
    Effect.flatMap(Effect.service(OrchestrationEngineService), (engine) =>
      engine.dispatch(command),
    ),
  );

const withQuery = <A, E>(
  user: UserEngine,
  read: (query: ProjectionSnapshotQuery["Service"]) => Effect.Effect<A, E>,
) => user.run(Effect.flatMap(Effect.service(ProjectionSnapshotQuery), read));

const deleteUsers = (users: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    for (const table of [...HUB_TENANT_TABLES, "hub_users"]) {
      yield* sql`DELETE FROM ${sql(table)} WHERE ${sql.in("user_id", users)}`;
    }
  });

if (databaseUrl === undefined) {
  it.skip("hub engines on Postgres (set T3_HUB_TEST_DATABASE_URL)", () => {});
} else {
  it.layer(makeHubSharedLayer({ url: databaseUrl, maxConnections: 4 }), {
    excludeTestServices: true,
  })("hub engines on Postgres", (it) => {
    it.effect("isolates projects, threads, events, and sequences per user in one process", () =>
      Effect.gen(function* () {
        yield* deleteUsers([userA, userB]);
        const a = yield* activateUser(userA);
        const b = yield* activateUser(userB);

        // Interleave the two users' commands through their own engines.
        const commandsA = commandsFor("alice");
        const commandsB = commandsFor("bob");
        const sequencesA: number[] = [];
        const sequencesB: number[] = [];
        for (let index = 0; index < commandsA.length; index += 1) {
          sequencesA.push((yield* dispatch(a, commandsA[index]!)).sequence);
          sequencesB.push((yield* dispatch(b, commandsB[index]!)).sequence);
        }
        sequencesA.push((yield* dispatch(a, extraThreadFor("alice"))).sequence);

        const eventsA = yield* readEvents(a);
        const eventsB = yield* readEvents(b);

        // Per-user sequences start at 1 and are contiguous, so clients resume per user.
        assert.deepStrictEqual(
          eventsA.map((event) => event.sequence),
          Array.from({ length: eventsA.length }, (_, index) => index + 1),
        );
        assert.deepStrictEqual(
          eventsB.map((event) => event.sequence),
          Array.from({ length: eventsB.length }, (_, index) => index + 1),
        );
        assert.strictEqual(sequencesA.at(-1), eventsA.length);
        assert.strictEqual(sequencesB.at(-1), eventsB.length);
        assert.isAbove(eventsA.length, eventsB.length);

        // Events never cross users, even though ids are identical.
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        expect(JSON.stringify(eventsA)).not.toContain("bob");
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        expect(JSON.stringify(eventsB)).not.toContain("alice");

        // Resume-by-sequence reads only the caller's later events.
        const resumeFrom = 3;
        const resumedA = yield* readEvents(a, resumeFrom);
        assert.deepStrictEqual(
          resumedA.map((event) => event.sequence),
          eventsA.filter((event) => event.sequence > resumeFrom).map((event) => event.sequence),
        );

        // Shell snapshots.
        const shellA = yield* withQuery(a, (query) => query.getShellSnapshot());
        const shellB = yield* withQuery(b, (query) => query.getShellSnapshot());
        assert.deepStrictEqual(
          shellA.projects.map((project) => project.title),
          ["Project of alice"],
        );
        assert.deepStrictEqual(
          shellB.projects.map((project) => project.title),
          ["Project of bob"],
        );
        assert.deepStrictEqual(shellA.threads.map((thread) => thread.title).toSorted(), [
          "Extra thread of alice",
          "Thread of alice",
        ]);
        assert.deepStrictEqual(
          shellB.threads.map((thread) => thread.title),
          ["Thread of bob"],
        );
        assert.strictEqual(shellA.snapshotSequence, eventsA.length);
        assert.strictEqual(shellB.snapshotSequence, eventsB.length);

        // Thread detail snapshots: full and windowed.
        for (const window of [undefined, { turnLimit: 5 }]) {
          const threadA = Option.getOrThrow(
            yield* withQuery(a, (query) =>
              query.getThreadDetailSnapshot(ThreadId.make("thread-shared"), window),
            ),
          ).thread;
          const threadB = Option.getOrThrow(
            yield* withQuery(b, (query) =>
              query.getThreadDetailSnapshot(ThreadId.make("thread-shared"), window),
            ),
          ).thread;
          assert.deepStrictEqual(
            threadA.messages.map((message) => message.text),
            ["hello from alice", "reply to alice"],
          );
          assert.deepStrictEqual(
            threadB.messages.map((message) => message.text),
            ["hello from bob", "reply to bob"],
          );
          assert.deepStrictEqual(
            threadA.activities.map((activity) => activity.summary),
            ["tool ran for alice"],
          );
          assert.deepStrictEqual(
            threadB.activities.map((activity) => activity.summary),
            ["tool ran for bob"],
          );
        }

        // Counts and command receipts are tenant-scoped too: replaying user A's
        // command id against user B's engine is B's own replay, not a conflict.
        assert.deepStrictEqual(yield* withQuery(a, (query) => query.getCounts()), {
          projectCount: 1,
          threadCount: 2,
        });
        assert.deepStrictEqual(yield* withQuery(b, (query) => query.getCounts()), {
          projectCount: 1,
          threadCount: 1,
        });
        assert.strictEqual((yield* dispatch(b, commandsB[0]!)).replayed, true);

        // Evicting and reactivating A rebuilds the same command read model.
        const readModelBefore = yield* withQuery(a, (query) => query.getCommandReadModel());
        yield* Scope.close(a.scope, Exit.void);
        const a2 = yield* activateUser(userA);
        const readModelAfter = yield* withQuery(a2, (query) => query.getCommandReadModel());
        assert.deepStrictEqual(readModelAfter, readModelBefore);
        assert.strictEqual(readModelAfter.snapshotSequence, eventsA.length);
        assert.strictEqual(readModelAfter.threads.length, 2);

        yield* Scope.close(a2.scope, Exit.void);
        yield* Scope.close(b.scope, Exit.void);
        yield* deleteUsers([userA, userB]);
      }),
    );

    it.effect("row-level security backstop fails closed without a tenant context", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* deleteUsers([userA, userB]);
        yield* sql`
          INSERT INTO projection_projects (user_id, project_id, title, workspace_root, scripts_json, created_at, updated_at)
          VALUES
            (${userA}, 'rls-project', 'rls a', '/a', '[]', ${createdAt}, ${createdAt}),
            (${userB}, 'rls-project', 'rls b', '/b', '[]', ${createdAt}, ${createdAt})
        `;
        yield* sql`
          DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hub_rls_probe') THEN
              CREATE ROLE hub_rls_probe NOLOGIN;
            END IF;
          END $$
        `;
        yield* sql`GRANT SELECT, INSERT ON projection_projects TO hub_rls_probe`;
        for (const statement of hubRowLevelSecurityStatements(["projection_projects"])) {
          yield* sql.unsafe(statement);
        }

        // A non-owner role inside a transaction, optionally with a tenant context.
        const asProbe = <A, E, R>(tenant: string | null, effect: Effect.Effect<A, E, R>) =>
          sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`SET LOCAL ROLE hub_rls_probe`;
              if (tenant !== null) {
                yield* sql`SELECT set_config('hub.user_id', ${tenant}, true)`;
              }
              return yield* effect;
            }),
          );
        const titles = (tenant: string | null) =>
          asProbe(
            tenant,
            sql<{ title: string }>`
              SELECT title FROM projection_projects WHERE project_id = 'rls-project' ORDER BY title
            `.pipe(Effect.map((rows) => rows.map((row) => row.title))),
          );

        yield* Effect.gen(function* () {
          // No tenant context: nothing is visible, even without a user_id predicate.
          assert.deepStrictEqual(yield* titles(null), []);
          assert.deepStrictEqual(yield* titles(userA), ["rls a"]);
          assert.deepStrictEqual(yield* titles(userB), ["rls b"]);
          // Writes for another tenant are rejected by WITH CHECK.
          const forged = yield* asProbe(
            userA,
            sql`
              INSERT INTO projection_projects (user_id, project_id, title, workspace_root, scripts_json, created_at, updated_at)
              VALUES (${userB}, 'rls-forged', 'forged', '/b', '[]', ${createdAt}, ${createdAt})
            `,
          ).pipe(Effect.exit);
          assert.isTrue(Exit.isFailure(forged));
          // The setting is transaction-local, so the next transaction starts clean.
          assert.deepStrictEqual(yield* titles(null), []);
        }).pipe(
          Effect.ensuring(
            sql`ALTER TABLE projection_projects DISABLE ROW LEVEL SECURITY`.pipe(Effect.orDie),
          ),
        );
        yield* deleteUsers([userA, userB]);
      }),
    );

    it.effect(
      "shows why schema-per-user cannot rely on session search_path over a shared connection",
      () =>
        Effect.gen(function* () {
          // One pooled connection stands in for a PgBouncer server connection that
          // transaction pooling hands to whichever client runs the next transaction.
          const single = yield* Layer.build(
            Layer.fresh(
              PgClient.layer({
                url: Redacted.make(databaseUrl),
                maxConnections: 1,
                types: hubPgTypes,
              }),
            ),
          );
          const db = Context.get(single, SqlClient.SqlClient);
          for (const schema of ["hub_probe_a", "hub_probe_b"]) {
            yield* db`CREATE SCHEMA IF NOT EXISTS ${db(schema)}`;
            yield* db`CREATE TABLE IF NOT EXISTS ${db(schema)}.probe_threads (title text)`;
            yield* db`TRUNCATE ${db(schema)}.probe_threads`;
            yield* db`INSERT INTO ${db(schema)}.probe_threads VALUES (${schema})`;
          }
          // Tenant A sets its schema for the session...
          yield* db`SET search_path TO hub_probe_a`;
          // ...and tenant B's next statement on that connection reads A's data.
          const leaked = yield* db<{ title: string }>`SELECT title FROM probe_threads`;
          yield* db`RESET search_path`;
          // SET LOCAL is scoped to one transaction, which is safe behind a pooler,
          // but then every statement must run inside such a transaction.
          const scoped = yield* db.withTransaction(
            Effect.gen(function* () {
              yield* db`SET LOCAL search_path TO hub_probe_b`;
              return yield* db<{ title: string }>`SELECT title FROM probe_threads`;
            }),
          );
          const after = yield* db<{ search_path: string }>`SHOW search_path`;
          yield* db`DROP SCHEMA hub_probe_a CASCADE`;
          yield* db`DROP SCHEMA hub_probe_b CASCADE`;

          assert.deepStrictEqual(
            leaked.map((row) => row.title),
            ["hub_probe_a"],
          );
          assert.deepStrictEqual(
            scoped.map((row) => row.title),
            ["hub_probe_b"],
          );
          assert.strictEqual(after[0]?.search_path, '"$user", public');
        }),
    );
  });
}
