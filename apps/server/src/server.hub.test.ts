/**
 * Boots the real server composition in hub mode against Postgres, creates a
 * project and a thread through the engine and the HTTP dispatch route, reads
 * the shell and thread snapshots, restarts on a fresh base directory, and
 * checks that everything (including the bearer session) survived while the
 * disposable base directory kept no durable state.
 *
 * Runs only with T3_HUB_TEST_DATABASE_URL (see persistence/Postgres/hubTestDatabase.ts).
 * No runner is configured, so the hub's runner client is inert; nothing here
 * needs a thread machine.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EnvironmentHttpApi,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as NetService from "@t3tools/shared/Net";
import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import { FetchHttpClient, HttpServer } from "effect/unstable/http";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";

import * as EnvironmentAuth from "./auth/EnvironmentAuth.ts";
import * as ServerConfig from "./config.ts";
import { ServerEnvironment } from "./environment/ServerEnvironment.ts";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";
import { AuthAdministrativeScopes } from "@t3tools/contracts";
import { HubDatabase } from "./persistence/Postgres/HubDatabase.ts";
import { makeHubDocuments } from "./persistence/Postgres/HubDocuments.ts";
import {
  hubTestDatabaseLayer,
  hubTestDatabaseUrl,
  hubTestServerConfigLayer,
  makeHubTestSchema,
  type HubTestSchema,
} from "./persistence/Postgres/hubTestDatabase.ts";
import { makeServerLayer } from "./server.ts";

const TENANT = "user_hub_boot";
const projectId = ProjectId.make("project-hub-boot");
const threadId = ThreadId.make("thread-hub-boot");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" };
const repositoryIdentity = {
  canonicalKey: "github.com/aldo/app",
  locator: {
    source: "git-remote" as const,
    remoteName: "origin",
    remoteUrl: "https://github.com/aldo/app.git",
  },
  provider: "github",
  owner: "aldo",
  name: "app",
  defaultBranch: "main",
};

const hubConfig = (schema: HubTestSchema, baseDir: string) =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    return {
      ...config,
      host: "127.0.0.1",
      port: 0,
      logLevel: (process.env.T3_HUB_TEST_LOG_LEVEL ??
        "Warn") as ServerConfig.ServerConfig["Service"]["logLevel"],
      noBrowser: true,
      startupPresentation: "headless",
    } satisfies ServerConfig.ServerConfig["Service"];
  }).pipe(Effect.provide(hubTestServerConfigLayer(schema, TENANT, { baseDir })));

/**
 * Starts one hub process the way the CLI does (the server layer held open by
 * a fiber); `stop` interrupts it like a shutdown signal.
 */
const startHub = (schema: HubTestSchema, baseDir: string) =>
  Effect.gen(function* () {
    const config = yield* hubConfig(schema, baseDir);
    const ready = yield* Deferred.make<Context.Context<never>>();
    const fiber = yield* Effect.forkChild(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(makeServerLayer);
          yield* Deferred.succeed(ready, context as Context.Context<never>);
          return yield* Effect.never;
        }),
      ).pipe(Effect.provideService(ServerConfig.ServerConfig, config)),
    );
    const context = yield* Effect.raceFirst(Deferred.await(ready), Fiber.join(fiber));
    const server = Context.getUnsafe(context, HttpServer.HttpServer);
    const address = server.address;
    if (typeof address === "string" || !("port" in address)) {
      return yield* Effect.die(new Error("hub server has no TCP address"));
    }
    return {
      config,
      origin: `http://127.0.0.1:${address.port}`,
      engine: Context.getUnsafe(context, OrchestrationEngineService),
      auth: Context.getUnsafe(context, EnvironmentAuth.EnvironmentAuth),
      environment: Context.getUnsafe(context, ServerEnvironment),
      stop: Fiber.interrupt(fiber),
    };
  });

const durableStateFiles = (config: ServerConfig.ServerConfig["Service"]) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const candidates = [
      config.dbPath,
      config.settingsPath,
      config.keybindingsConfigPath,
      config.environmentIdPath,
      config.anonymousIdPath,
      config.secretsDir,
    ];
    const present: Array<string> = [];
    for (const candidate of candidates) {
      if (yield* fileSystem.exists(candidate)) present.push(candidate);
    }
    return present;
  });

describe.skipIf(hubTestDatabaseUrl === undefined)("hub server", () => {
  it.effect(
    "serves projects and threads from Postgres across restarts with no durable local state",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const schema = yield* makeHubTestSchema(hubTestDatabaseUrl!);

        // Provider update checks would reach the network; the hub reads its
        // settings from Postgres, so seed them there.
        yield* Effect.gen(function* () {
          const database = yield* HubDatabase;
          yield* makeHubDocuments(database!).write(
            "settings.json",
            '{ "enableProviderUpdateChecks": false }\n',
          );
        }).pipe(Effect.provide(hubTestDatabaseLayer(schema, TENANT)));

        const firstBaseDir = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3-hub-boot-a-",
        });
        const first = yield* startHub(schema, firstBaseDir);
        const client = yield* HttpApiClient.make(EnvironmentHttpApi, { baseUrl: first.origin });

        const issued = yield* first.auth.issueSession({
          scopes: AuthAdministrativeScopes,
          label: "hub boot test",
        });
        const headers = { authorization: `Bearer ${issued.token}` };

        // The project CLI and managed platform dispatch through the engine; a
        // hub has no checkout to normalize a workspace root against.
        yield* first.engine.dispatch({
          type: "project.create",
          commandId: CommandId.make("cmd-hub-boot-project"),
          projectId,
          title: "Hub project",
          workspaceRoot: `/workspace/p/${projectId}`,
          defaultModelSelection: modelSelection,
          repositoryIdentity,
          createdAt: "2026-09-25T00:00:00.000Z",
        });
        yield* client.orchestration.dispatch({
          headers,
          payload: {
            type: "thread.create",
            commandId: CommandId.make("cmd-hub-boot-thread"),
            threadId,
            projectId,
            title: "Hub thread",
            modelSelection,
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            runtimeMode: "approval-required",
            branch: null,
            worktreePath: `/workspace/t/${threadId}`,
            createdAt: "2026-09-25T00:00:01.000Z",
          },
        });

        const shell = yield* client.orchestration.shellSnapshot({ headers });
        assert.deepStrictEqual(
          shell.projects.map((project) => [project.id, project.repositoryIdentity?.defaultBranch]),
          [[projectId, "main"]],
        );
        assert.deepStrictEqual(
          shell.threads.map((thread) => thread.id),
          [threadId],
        );
        const detail = yield* client.orchestration.threadSnapshot({
          headers,
          params: { threadId },
          payload: {},
        });
        assert.strictEqual(detail.thread.title, "Hub thread");
        const environmentId = yield* first.environment.getEnvironmentId;

        assert.deepStrictEqual(yield* durableStateFiles(first.config), []);
        yield* first.stop;

        // A new process on an empty base directory: nothing came from disk.
        const secondBaseDir = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3-hub-boot-b-",
        });
        assert.deepStrictEqual(yield* fileSystem.readDirectory(secondBaseDir), []);
        const second = yield* startHub(schema, secondBaseDir);
        const secondClient = yield* HttpApiClient.make(EnvironmentHttpApi, {
          baseUrl: second.origin,
        });

        // The bearer session issued by the first process still authenticates.
        const restartedShell = yield* secondClient.orchestration.shellSnapshot({ headers });
        assert.deepStrictEqual(
          restartedShell.projects.map((project) => [
            project.id,
            project.title,
            project.repositoryIdentity?.canonicalKey,
          ]),
          [[projectId, "Hub project", "github.com/aldo/app"]],
        );
        assert.deepStrictEqual(
          restartedShell.threads.map((thread) => [thread.id, thread.title]),
          [[threadId, "Hub thread"]],
        );
        assert.isAtLeast(restartedShell.snapshotSequence, shell.snapshotSequence);
        assert.strictEqual(yield* second.environment.getEnvironmentId, environmentId);

        // Commands keep sequencing after the restart.
        yield* secondClient.orchestration.dispatch({
          headers,
          payload: {
            type: "thread.meta.update",
            commandId: CommandId.make("cmd-hub-boot-rename"),
            threadId,
            title: "Hub thread, renamed",
          },
        });
        const renamed = yield* secondClient.orchestration.threadSnapshot({
          headers,
          params: { threadId },
          payload: {},
        });
        assert.strictEqual(renamed.thread.title, "Hub thread, renamed");
        assert.isAbove(renamed.snapshotSequence, restartedShell.snapshotSequence);

        assert.deepStrictEqual(yield* durableStateFiles(second.config), []);
        yield* second.stop;
      }).pipe(
        Effect.scoped,
        Effect.provide(
          Layer.mergeAll(
            NodeServices.layer,
            NetService.layer,
            FetchHttpClient.layer,
            Reactivity.layer,
          ),
        ),
      ),
  );
});
