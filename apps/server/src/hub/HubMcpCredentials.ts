/**
 * MCP credentials that survive hub restarts.
 *
 * The hub mints an MCP credential for every provider session it starts and
 * the runner hands it to the provider CLI. Those sessions run on thread
 * machines and outlive the hub process, so the hub persists each credential's
 * hash and scope (never the token) in `McpCredentialStore`; a restarted hub
 * loads them and keeps answering the sessions' MCP calls. Persistence failures
 * are logged: the credential still works for this process.
 *
 * @module hub/HubMcpCredentials
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  McpCredentialStore,
  type McpCredentialRow,
} from "../persistence/Services/HubThreadMachineState.ts";
import { McpCredentialPersistence } from "../serverModeHooks.ts";

export const layer = Layer.effect(
  McpCredentialPersistence,
  Effect.gen(function* () {
    const store = yield* McpCredentialStore;
    const logFailure =
      (operation: string) =>
      (error: { readonly message: string }): Effect.Effect<void> =>
        Effect.logWarning("MCP credential persistence failed", {
          operation,
          detail: error.message,
        });
    return {
      load: store
        .list()
        .pipe(
          Effect.catch((error) =>
            logFailure("load")(error).pipe(Effect.as([] as ReadonlyArray<McpCredentialRow>)),
          ),
        ),
      save: (record) => store.put(record).pipe(Effect.catch(logFailure("save"))),
      touch: (tokenHashes, lastAliveAt) =>
        store.touch(tokenHashes, lastAliveAt).pipe(Effect.catch(logFailure("touch"))),
      remove: (tokenHashes) => store.remove(tokenHashes).pipe(Effect.catch(logFailure("remove"))),
    };
  }),
);
