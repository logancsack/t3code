// An opaque replay frame cannot use IndexedDB, and must never use the
// visitor's connection catalog. Its only environment is the local script.
import {
  ConnectionTargetStore,
  ConnectionRegistrationStore,
  EnvironmentCacheStore,
} from "@t3tools/client-runtime/platform";
import { ProfileStore, CredentialStore } from "@t3tools/client-runtime/connection";
import { TokenStore } from "@t3tools/client-runtime/authorization";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { workReplaySnapshots, workReplayConfig } from "./runtime";

const noWrite = () => Effect.void;
const absent = () => Effect.succeedNone;
export const workReplayStorageLayer = Layer.mergeAll(
  Layer.succeed(ConnectionTargetStore, {
    list: Effect.succeed([]),
    listDisabled: Effect.succeed([]),
  }),
  Layer.succeed(ConnectionRegistrationStore, {
    register: noWrite,
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
  Layer.succeed(EnvironmentCacheStore, {
    loadShell: () => Effect.sync(() => Option.some(workReplaySnapshots().shell)),
    loadThread: () => Effect.sync(() => Option.some(workReplaySnapshots().detail)),
    loadServerConfig: () => Effect.sync(() => Option.some(workReplayConfig())),
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
