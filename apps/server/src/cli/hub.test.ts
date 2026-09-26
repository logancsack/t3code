// @effect-diagnostics nodeBuiltinImport:off -- The test prepares a throwaway base directory like the hub host does.
/**
 * `t3 hub migrate` as the hub host runs it: the exact allowlisted environment,
 * no machines URL, no gateway token, no port. Runs only with
 * T3_HUB_TEST_DATABASE_URL (see persistence/Postgres/hubTestDatabase.ts).
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as NetService from "@t3tools/shared/Net";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/unstable/cli";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";

import { makeCli } from "../bin.ts";
import { makeHubPool } from "../persistence/Postgres/HubClient.ts";
import { hubMigrations } from "../persistence/Postgres/migrations/index.ts";
import {
  HUB_TEST_SECRET_KEY,
  hubTestDatabaseUrl,
  makeHubTestSchema,
} from "../persistence/Postgres/hubTestDatabase.ts";

const runMigrate = (env: Record<string, string>, baseDir: string) =>
  Effect.gen(function* () {
    yield* Command.runWith(makeCli(), { version: "0.0.0" })([
      "hub",
      "migrate",
      "--base-dir",
      baseDir,
    ]);
    return (yield* TestConsole.logLines).filter((line): line is string => typeof line === "string");
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        TestConsole.layer,
        NodeServices.layer,
        NetService.layer,
        ConfigProvider.layer(ConfigProvider.fromEnv({ env })),
      ),
    ),
  );

describe.skipIf(hubTestDatabaseUrl === undefined)("t3 hub migrate", () => {
  it.effect("applies every hub migration once, grants the runtime role, and is idempotent", () =>
    Effect.gen(function* () {
      const schema = yield* makeHubTestSchema(hubTestDatabaseUrl!);
      const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-hub-migrate-"));
      // The host's allowlist: no machines URL or token, no gateway token, no port.
      const env: Record<string, string> = {
        PATH: process.env.PATH ?? "",
        HOME: NodePath.join(dir, "home"),
        LANG: "C.UTF-8",
        NODE_ENV: "production",
        T3CODE_HOME: dir,
        T3CODE_SERVER_MODE: "hub",
        T3CODE_HUB_DATABASE_URL: schema.runtimeUrl,
        ...(schema.separateRuntimeRole ? { T3CODE_HUB_DATABASE_ADMIN_URL: schema.adminUrl } : {}),
        T3CODE_HUB_TENANT_ID: "00000000-0000-4000-8000-000000000000",
        T3CODE_HUB_SECRET_KEY: HUB_TEST_SECRET_KEY,
        T3CODE_TELEMETRY_ENABLED: "false",
      };

      const first = (yield* runMigrate(env, dir)).join("\n");
      assert.include(first, `Applied ${hubMigrations.length} hub migrations`);
      assert.include(first, "051_HubThreadMachineServices");
      assert.notInclude(first, schema.runtimeUrl);
      assert.notInclude(first, schema.adminUrl);
      assert.include((yield* runMigrate(env, dir)).join("\n"), "nothing to apply");

      const admin = yield* makeHubPool({ url: schema.adminUrl, maxConnections: 1 });
      const applied = yield* admin<{ readonly id: number }>`
        SELECT id FROM hub_schema_migrations ORDER BY id
      `;
      assert.deepStrictEqual(
        applied.map((row) => Number(row.id)),
        hubMigrations.map((entry) => entry.id),
      );
      // It touched no tenant data.
      const [documents] = yield* admin<{ readonly count: number }>`
        SELECT count(*) AS count FROM hub_documents
      `;
      assert.strictEqual(Number(documents?.count), 0);
      // The runtime role can use the tables it was granted.
      const runtime = yield* makeHubPool({ url: schema.runtimeUrl, maxConnections: 1 });
      yield* runtime`SELECT count(*) FROM hub_thread_machine_status`;

      // An unreachable database fails the command.
      const failed = yield* runMigrate(
        { ...env, T3CODE_HUB_DATABASE_URL: "postgres://nobody@127.0.0.1:9/none" },
        dir,
      ).pipe(Effect.exit);
      assert.strictEqual(failed._tag, "Failure");
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }).pipe(Effect.scoped, Effect.provide(Reactivity.layer)),
  );
});
