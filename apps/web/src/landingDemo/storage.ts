// An opaque replay frame cannot use IndexedDB, and must never use the
// visitor's connection catalog. Its only environment is the local script.
import { Persistence } from "@t3tools/client-runtime/platform";
import { ProfileStore, CredentialStore } from "@t3tools/client-runtime/connection";
import { TokenStore } from "@t3tools/client-runtime/authorization";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { workReplaySnapshots, workReplayConfig } from "./runtime";

const noWrite = () => Effect.void;
const absent = () => Effect.succeedNone;
export const workReplayStorageLayer = Layer.mergeAll(
  Layer.succeed(Persistence.ConnectionTargetStore, {
    list: Effect.succeed([]),
    listDisabled: Effect.succeed([]),
  }),
  Layer.succeed(Persistence.ConnectionRegistrationStore, {
    register: noWrite,
    setRoutes: noWrite,
    remove: noWrite,
    setEnabled: noWrite,
  }),
  Layer.succeed(ProfileStore.ConnectionProfileStore, {
    get: absent,
    put: noWrite,
    remove: noWrite,
  }),
  Layer.succeed(CredentialStore.ConnectionCredentialStore, {
    get: absent,
    put: noWrite,
    remove: noWrite,
  }),
  Layer.succeed(TokenStore.RemoteDpopAccessTokenStore, {
    get: absent,
    put: noWrite,
    remove: noWrite,
  }),
  Layer.succeed(Persistence.EnvironmentCacheStore, {
    loadShell: Effect.fn("Persistence.EnvironmentCacheStore.loadShell")(() =>
      Effect.map(workReplaySnapshots, ({ shell }) => Option.some(shell)),
    ),
    loadThread: Effect.fn("Persistence.EnvironmentCacheStore.loadThread")(() =>
      Effect.map(workReplaySnapshots, ({ detail }) => Option.some(detail)),
    ),
    loadServerConfig: Effect.fn("Persistence.EnvironmentCacheStore.loadServerConfig")(() =>
      Effect.sync(() => Option.some(workReplayConfig())),
    ),
    saveShell: noWrite,
    saveThread: noWrite,
    removeThread: noWrite,
    saveServerConfig: noWrite,
    loadVcsRefs: absent,
    saveVcsRefs: noWrite,
    removeVcsRefs: noWrite,
    clearVcsRefs: noWrite,
    clear: noWrite,
  }),
);
