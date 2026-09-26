import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { expandHomePath } from "../os-jank.ts";
import {
  HubImportError,
  importStandaloneState,
  type HubImportReport,
} from "../persistence/Postgres/HubImport.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";

const HubImportEnv = Config.all({
  databaseUrl: Config.redacted("T3CODE_HUB_DATABASE_URL"),
  databaseAdminUrl: Config.redacted("T3CODE_HUB_DATABASE_ADMIN_URL").pipe(Config.option),
  tenantId: Config.string("T3CODE_HUB_TENANT_ID"),
  secretKey: Config.redacted("T3CODE_HUB_SECRET_KEY"),
});

type ReadonlySqliteLoader = {
  readonly layer: (config: {
    readonly filename: string;
    readonly readonly?: boolean;
  }) => Layer.Layer<SqlClient.SqlClient, SqlError>;
};

/** Opens `state.sqlite` read-only; the import never migrates or writes the source. */
const openReadonlySqlite = (filename: string) =>
  Effect.gen(function* () {
    const loader = yield* Effect.promise<ReadonlySqliteLoader>(() =>
      process.versions.bun !== undefined
        ? import("@effect/sql-sqlite-bun/SqliteClient")
        : import("../persistence/NodeSqliteClient.ts"),
    );
    const context = yield* Layer.build(loader.layer({ filename, readonly: true }));
    return Context.get(context, SqlClient.SqlClient);
  });

const formatReport = (report: HubImportReport) =>
  [
    report.replacedExisting
      ? "Replaced the tenant's hub data with the standalone state."
      : "Imported the standalone state into the hub tenant.",
    ...Object.entries(report.rows).map(([table, count]) => `  ${table}: ${count} rows`),
    `  documents: ${report.documents}`,
    `  attachments: ${report.attachments} (skipped ${report.attachmentsSkipped})`,
    `  provider secrets: ${report.secrets}`,
    `  repository identities: ${report.repositoryIdentities}`,
    `  next event sequence: ${report.lastEventSequence + 1}`,
    "",
  ].join("\n");

const importCommand = Command.make("import", {
  stateDir: Argument.string("state-dir").pipe(
    Argument.withDescription(
      "Standalone state directory holding state.sqlite, for example ~/.t3/userdata.",
    ),
  ),
  replace: Flag.boolean("replace").pipe(
    Flag.withDescription("Delete the tenant's existing hub data before importing."),
  ),
  skipRepositoryIdentity: Flag.boolean("skip-repository-identity").pipe(
    Flag.withDescription(
      "Do not record repository identities from project checkouts on this machine.",
    ),
  ),
}).pipe(
  Command.withDescription(
    "Import a standalone T3 state directory into a hub tenant. Reads the hub database, tenant, and secret key from the T3CODE_HUB_* environment. Prints counts only.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const env = yield* HubImportEnv;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stateDir = path.resolve(yield* expandHomePath(flags.stateDir));
      const databasePath = path.join(stateDir, "state.sqlite");
      if (!(yield* fileSystem.exists(databasePath))) {
        return yield* new HubImportError({
          reason: "source-missing",
          detail: `No state.sqlite in ${stateDir}.`,
        });
      }

      // Loaded on use so other `t3` commands never load the Postgres driver.
      const { makeHubDatabase } = yield* Effect.promise(
        () => import("../persistence/Postgres/HubDatabaseLive.ts"),
      );
      const hub = yield* makeHubDatabase({
        databaseUrl: Redacted.value(env.databaseUrl),
        databaseAdminUrl: Option.getOrUndefined(Option.map(env.databaseAdminUrl, Redacted.value)),
        tenantId: env.tenantId,
      });
      const source = yield* openReadonlySqlite(databasePath);
      const resolver = flags.skipRepositoryIdentity
        ? undefined
        : Context.get(
            yield* Layer.build(RepositoryIdentityResolver.layer),
            RepositoryIdentityResolver.RepositoryIdentityResolver,
          );

      const report = yield* importStandaloneState({
        stateDir,
        source,
        hub,
        secretKey: Redacted.value(env.secretKey),
        replace: flags.replace,
        ...(resolver ? { resolveRepositoryIdentity: resolver.resolve } : {}),
      });
      yield* Console.log(formatReport(report));
    }).pipe(Effect.scoped),
  ),
);

const HubMigrateEnv = Config.all({
  databaseUrl: Config.redacted("T3CODE_HUB_DATABASE_URL"),
  databaseAdminUrl: Config.redacted("T3CODE_HUB_DATABASE_ADMIN_URL").pipe(Config.option),
});

/**
 * `t3 hub migrate`: the hub host runs this once before activating tenants, so
 * tenant processes never need schema-change privileges. It applies every
 * pending hub migration with `T3CODE_HUB_DATABASE_ADMIN_URL` (or the runtime
 * role when that is absent), grants the runtime role access, starts no server,
 * touches no tenant data, and is idempotent. Other `T3CODE_HUB_*` variables
 * (tenant, secret key) are accepted and ignored. Prints no credentials.
 */
const migrateCommand = Command.make("migrate", {
  baseDir: Flag.string("base-dir").pipe(
    Flag.withDescription("Accepted for symmetry with other commands; nothing is written there."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription(
    "Apply the hub database migrations and grant the runtime role access. Reads T3CODE_HUB_DATABASE_URL and the optional T3CODE_HUB_DATABASE_ADMIN_URL; starts no server and touches no tenant data.",
  ),
  Command.withHandler(() =>
    Effect.gen(function* () {
      const env = yield* HubMigrateEnv;
      // Loaded on use so other `t3` commands never load the Postgres driver.
      const { migrateHubDatabase } = yield* Effect.promise(
        () => import("../persistence/Postgres/HubDatabaseLive.ts"),
      );
      const report = yield* migrateHubDatabase({
        databaseUrl: Redacted.value(env.databaseUrl),
        databaseAdminUrl: Option.getOrUndefined(Option.map(env.databaseAdminUrl, Redacted.value)),
      });
      yield* Console.log(
        [
          report.applied.length === 0
            ? "The hub database schema is current; nothing to apply."
            : `Applied ${report.applied.length} hub migrations: ${report.applied
                .map((entry) => `${String(entry.id).padStart(3, "0")}_${entry.name}`)
                .join(", ")}.`,
          report.grantedRole === null
            ? "The runtime role migrated the schema itself; no grants needed."
            : "Granted the runtime role access to the hub tables.",
          "",
        ].join("\n"),
      );
    }),
  ),
);

export const hubCommand = Command.make("hub").pipe(
  Command.withDescription("Manage thread-machine hub state."),
  Command.withSubcommands([importCommand, migrateCommand]),
);
