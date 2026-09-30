import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

/**
 * The hub user whose rows a Postgres repository may read or write.
 *
 * Every hub repository resolves this once at construction and adds
 * `user_id = ${userId}` to each statement, so one process can run many users'
 * engines over a single shared connection pool.
 */
export class HubTenant extends Context.Service<
  HubTenant,
  {
    readonly userId: string;
  }
>()("t3/persistence/Postgres/HubTenant") {}

export const hubTenantLayer = (userId: string) => Layer.succeed(HubTenant, { userId });
