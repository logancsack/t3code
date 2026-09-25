/**
 * HubDatabase - the tenant-scoped Postgres database of a hub process.
 *
 * Set only in hub mode (`T3CODE_SERVER_MODE=hub` with a hub database URL), where
 * one process serves exactly one tenant and its base directory is disposable.
 * Everything a standalone server keeps in SQLite or in state-directory files
 * switches to Postgres when it is set:
 *
 *   - repository layers pick their Postgres port through `localOrHub`;
 *   - the SQLite persistence layer hands out this client instead of opening
 *     `state.sqlite`;
 *   - file-backed stores (settings, keybindings, secrets, environment id,
 *     attachments) read it directly.
 *
 * It is a reference rather than a required service so that standalone layer
 * types, tests, and behavior stay exactly as upstream T3 has them. The server
 * and the auth CLI provide `layerConfig` once at their root.
 *
 * @module HubDatabase
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerConfig } from "../../config.ts";
import { HubTenant } from "./HubTenant.ts";

export interface HubDatabaseShape {
  /** The Aldo user this process serves. */
  readonly tenantId: string;
  /** Applies the tenant to every statement and transaction (the RLS backstop). */
  readonly sql: SqlClient.SqlClient;
}

export class HubDatabase extends Context.Reference<HubDatabaseShape | undefined>(
  "t3/persistence/Postgres/HubDatabase",
  { defaultValue: () => undefined },
) {}

/**
 * Hub mode: applies hub migrations and connects the tenant client. Otherwise
 * provides nothing, so standalone composition is unchanged.
 */
export const layerConfig = Layer.unwrap(
  Effect.gen(function* () {
    const { hub } = yield* ServerConfig;
    if (!hub?.databaseUrl) {
      return Layer.empty;
    }
    // Loaded lazily so a standalone server never loads the Postgres driver.
    const { makeHubDatabase } = yield* Effect.promise(() => import("./HubDatabaseLive.ts"));
    return Layer.effect(
      HubDatabase,
      makeHubDatabase({
        databaseUrl: hub.databaseUrl,
        databaseAdminUrl: hub.databaseAdminUrl,
        tenantId: hub.tenantId,
      }),
    );
  }),
);

/**
 * Chooses a service implementation by persistence backend: `local` (SQLite or
 * files) normally, `hub` when this process is a hub. The hub layer receives
 * the tenant client as its `SqlClient` and the tenant as `HubTenant`.
 */
export const localOrHub = <A, E1, R1, E2, R2>(
  local: Layer.Layer<A, E1, R1>,
  hub: Layer.Layer<A, E2, R2>,
): Layer.Layer<A, E1 | E2, R1 | Exclude<R2, HubTenant | SqlClient.SqlClient>> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const database = yield* HubDatabase;
      const selected: Layer.Layer<A, E1 | E2, R1 | Exclude<R2, HubTenant | SqlClient.SqlClient>> =
        database === undefined
          ? local
          : hub.pipe(
              Layer.provide(
                Layer.succeedContext(
                  Context.make(HubTenant, { userId: database.tenantId }).pipe(
                    Context.add(SqlClient.SqlClient, database.sql),
                  ),
                ),
              ),
            );
      return selected;
    }),
  );
