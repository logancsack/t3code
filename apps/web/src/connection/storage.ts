import {
  ConnectionCatalogDocument,
  type ConnectionCatalogDocument as ConnectionCatalogDocumentType,
  ConnectionPersistenceError,
  ConnectionRegistrationStore,
  ConnectionTargetStore,
  EMPTY_CONNECTION_CATALOG_DOCUMENT,
  EnvironmentCacheStore,
  encodeShellSnapshotForCache,
  putRemoteDpopTokenInCatalog,
  registerConnectionInCatalog,
  removeCatalogValue,
  removeConnectionFromCatalog,
  setConnectionEnabledInCatalog,
  replaceCatalogValue,
} from "@t3tools/client-runtime/platform";
import { TokenStore } from "@t3tools/client-runtime/authorization";
import {
  ConnectionTransientError,
  ConnectionBlockedError,
  CredentialStore,
  ProfileStore,
  GitHubRoutingPermissions,
  StoredGitHubRoutingPermission,
  gitHubRoutingConnectionKey,
  gitHubRoutingPermissionFor,
} from "@t3tools/client-runtime/connection";
import {
  EnvironmentId,
  OrchestrationShellSnapshot,
  OrchestrationThreadDetailSnapshot,
  ServerConfig,
  ThreadId,
  VcsListRefsResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { projectFaviconCache } from "../assets/projectFaviconCache";

import { aldoKeepsEnvironmentCache, aldoThreadDetail, isAldoConnectionId } from "../aldo/cloud";
import { withAldoTemplate } from "../aldo/serverConfig.logic";

const DATABASE_NAME = "t3code:connection-runtime";
const DATABASE_VERSION = 4;
const CATALOG_STORE_NAME = "catalog";
const SHELL_STORE_NAME = "shell";
const THREAD_STORE_NAME = "thread";
const SERVER_CONFIG_STORE_NAME = "server-config";
const VCS_REFS_STORE_NAME = "vcs-refs";
const CATALOG_KEY = "document";
const SHELL_SNAPSHOT_CACHE_SCHEMA_VERSION = 1;

const StoredShellSnapshot = Schema.Struct({
  schemaVersion: Schema.Literal(SHELL_SNAPSHOT_CACHE_SCHEMA_VERSION),
  environmentId: EnvironmentId,
  snapshot: OrchestrationShellSnapshot,
});
const StoredShellSnapshotJson = Schema.fromJsonString(StoredShellSnapshot);
// v2 stores the snapshot sequence alongside the thread so a warm cache can
// resume via `afterSequence` instead of re-downloading the full thread body.
// v3 adds windowed (paginated) snapshots carrying `page` metadata. The bump
// exists for rollback safety: a pre-pagination client would decode a windowed
// v2 record, silently drop the unknown `page` field, and treat the partial
// thread as complete forever. Older entries fail to decode → cold cache.
// v4 reloads pre-thinking caches: their fallback system roles cannot recover
// settled reasoning messages by resuming afterSequence.
const StoredThreadSnapshot = Schema.Struct({
  schemaVersion: Schema.Literal(4),
  environmentId: EnvironmentId,
  threadId: ThreadId,
  snapshot: OrchestrationThreadDetailSnapshot,
});
const StoredThreadSnapshotJson = Schema.fromJsonString(StoredThreadSnapshot);
const StoredServerConfig = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  environmentId: EnvironmentId,
  config: ServerConfig,
});
const StoredServerConfigJson = Schema.fromJsonString(StoredServerConfig);
const StoredVcsRefs = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  environmentId: EnvironmentId,
  cwd: Schema.String,
  refs: VcsListRefsResult,
});
const StoredVcsRefsJson = Schema.fromJsonString(StoredVcsRefs);
const ConnectionCatalogDocumentJson = Schema.fromJsonString(ConnectionCatalogDocument);
const decodeConnectionCatalogDocument = Schema.decodeUnknownEffect(ConnectionCatalogDocumentJson);
/**
 * Aldo: the stored shells read as the directory registers its machines
 * (readCachedShells, seedEnvironmentCache), for each machine's first load to
 * take instead of reading it again on its own. A few hundred separate reads
 * landed one at a time, and the sidebar rendered again for each.
 */
const shellsRead = new Map<EnvironmentId, string>();
const encodeConnectionCatalogDocument = Schema.encodeEffect(ConnectionCatalogDocumentJson);
const decodeStoredShellSnapshot = Schema.decodeUnknownEffect(StoredShellSnapshotJson);
const decodeStoredThreadSnapshot = Schema.decodeUnknownEffect(StoredThreadSnapshotJson);
const encodeStoredThreadSnapshot = Schema.encodeEffect(StoredThreadSnapshotJson);
const decodeStoredServerConfig = Schema.decodeUnknownEffect(StoredServerConfigJson);
const encodeStoredServerConfig = Schema.encodeEffect(StoredServerConfigJson);
const decodeStoredVcsRefs = Schema.decodeUnknownEffect(StoredVcsRefsJson);
const encodeStoredVcsRefs = Schema.encodeEffect(StoredVcsRefsJson);

function catalogError(operation: string, cause: unknown) {
  return new ConnectionTransientError({
    reason: "remote-unavailable",
    detail: `Could not ${operation} the local connection catalog: ${String(cause)}`,
  });
}

function persistenceError(
  operation:
    | "list-targets"
    | "list-disabled-targets"
    | "register-connection"
    | "remove-connection"
    | "set-connection-enabled"
    | "load-shell"
    | "save-shell"
    | "load-thread"
    | "save-thread"
    | "remove-thread"
    | "load-server-config"
    | "save-server-config"
    | "load-vcs-refs"
    | "save-vcs-refs"
    | "remove-vcs-refs"
    | "clear-vcs-refs"
    | "clear-environment",
  cause: unknown,
) {
  return new ConnectionPersistenceError({
    operation,
    message: `Could not ${operation.replaceAll("-", " ")}: ${String(cause)}`,
  });
}

const openDatabase = Effect.fn("web.connectionStorage.openDatabase")(function* () {
  return yield* Effect.callback<IDBDatabase, ConnectionTransientError>((resume) => {
    if (typeof indexedDB === "undefined") {
      resume(
        Effect.fail(catalogError("open", "IndexedDB is unavailable in this browser context.")),
      );
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(CATALOG_STORE_NAME)) {
        request.result.createObjectStore(CATALOG_STORE_NAME);
      }
      if (!request.result.objectStoreNames.contains(SHELL_STORE_NAME)) {
        request.result.createObjectStore(SHELL_STORE_NAME);
      }
      if (!request.result.objectStoreNames.contains(THREAD_STORE_NAME)) {
        request.result.createObjectStore(THREAD_STORE_NAME);
      }
      if (!request.result.objectStoreNames.contains(SERVER_CONFIG_STORE_NAME)) {
        request.result.createObjectStore(SERVER_CONFIG_STORE_NAME);
      }
      if (!request.result.objectStoreNames.contains(VCS_REFS_STORE_NAME)) {
        request.result.createObjectStore(VCS_REFS_STORE_NAME);
      }
    });
    request.addEventListener("error", () => {
      resume(Effect.fail(catalogError("open", request.error ?? "Unknown IndexedDB error")));
    });
    request.addEventListener("success", () => {
      resume(Effect.succeed(request.result));
    });
  });
});

function readDatabaseValue(database: IDBDatabase, storeName: string, key: IDBValidKey) {
  return Effect.callback<unknown, ConnectionTransientError>((resume) => {
    const request = database.transaction(storeName, "readonly").objectStore(storeName).get(key);
    request.addEventListener("error", () => {
      resume(Effect.fail(catalogError("read", request.error ?? "Unknown IndexedDB read error")));
    });
    request.addEventListener("success", () => {
      resume(Effect.succeed(request.result));
    });
  }).pipe(Effect.withSpan("web.connectionStorage.readDatabaseValue"));
}

function writeDatabaseValue(
  database: IDBDatabase,
  storeName: string,
  key: IDBValidKey,
  value: unknown,
) {
  return Effect.callback<void, ConnectionTransientError>((resume) => {
    const transaction = database.transaction(storeName, "readwrite");
    // Every failed write fires "abort". A failed commit, such as
    // QuotaExceededError, fires only "abort" and no "error".
    transaction.addEventListener("abort", () => {
      resume(
        Effect.fail(catalogError("write", transaction.error ?? "Unknown IndexedDB write error")),
      );
    });
    transaction.addEventListener("complete", () => {
      resume(Effect.void);
    });
    transaction.objectStore(storeName).put(value, key);
  }).pipe(Effect.withSpan("web.connectionStorage.writeDatabaseValue"));
}

function removeDatabaseValue(database: IDBDatabase, storeName: string, key: IDBValidKey) {
  return Effect.callback<void, ConnectionTransientError>((resume) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.addEventListener("error", () => {
      resume(
        Effect.fail(catalogError("remove", transaction.error ?? "Unknown IndexedDB remove error")),
      );
    });
    transaction.addEventListener("complete", () => {
      resume(Effect.void);
    });
    transaction.objectStore(storeName).delete(key);
  }).pipe(Effect.withSpan("web.connectionStorage.removeDatabaseValue"));
}

function removeDatabaseValuesInRange(database: IDBDatabase, storeName: string, range: IDBKeyRange) {
  return Effect.callback<void, ConnectionTransientError>((resume) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.addEventListener("error", () => {
      resume(
        Effect.fail(catalogError("remove", transaction.error ?? "Unknown IndexedDB cursor error")),
      );
    });
    transaction.addEventListener("complete", () => {
      resume(Effect.void);
    });
    const request = transaction.objectStore(storeName).openCursor(range);
    request.addEventListener("error", () => {
      resume(
        Effect.fail(catalogError("remove", request.error ?? "Unknown IndexedDB cursor error")),
      );
    });
    request.addEventListener("success", () => {
      const cursor = request.result;
      if (cursor === null) {
        return;
      }
      cursor.delete();
      cursor.continue();
    });
  }).pipe(Effect.withSpan("web.connectionStorage.removeDatabaseValuesInRange"));
}

function threadCacheKey(environmentId: EnvironmentId, threadId: ThreadId) {
  return `${environmentId}:${threadId}`;
}

function vcsRefsCacheKey(environmentId: EnvironmentId, cwd: string) {
  return `${environmentId}:${cwd}`;
}

const decodeCatalog = Effect.fn("web.connectionStorage.decodeCatalog")(function* (raw: string) {
  return yield* decodeConnectionCatalogDocument(raw).pipe(
    Effect.mapError((cause) => catalogError("decode", cause)),
  );
});

const encodeCatalog = Effect.fn("web.connectionStorage.encodeCatalog")(function* (
  catalog: ConnectionCatalogDocumentType,
) {
  return yield* encodeConnectionCatalogDocument(catalog).pipe(
    Effect.mapError((cause) => catalogError("encode", cause)),
  );
});

export interface CatalogBackend {
  readonly read: Effect.Effect<string | null, ConnectionTransientError>;
  readonly write: (raw: string) => Effect.Effect<void, ConnectionTransientError>;
  readonly quarantine?: (raw: string) => Effect.Effect<void, ConnectionTransientError>;
}

export function makeCatalogBackend(database: IDBDatabase): CatalogBackend {
  const bridge = window.desktopBridge;
  if (bridge?.getConnectionCatalog !== undefined && bridge.setConnectionCatalog !== undefined) {
    return {
      read: Effect.tryPromise({
        try: () => bridge.getConnectionCatalog!(),
        catch: (cause) => catalogError("load", cause),
      }),
      write: (raw) =>
        Effect.tryPromise({
          try: () => bridge.setConnectionCatalog!(raw),
          catch: (cause) => catalogError("save", cause),
        }).pipe(
          Effect.flatMap((stored) =>
            stored
              ? Effect.void
              : Effect.fail(
                  catalogError(
                    "save",
                    "Desktop secure storage is unavailable in this system context.",
                  ),
                ),
          ),
        ),
    };
  }

  return {
    read: readDatabaseValue(database, CATALOG_STORE_NAME, CATALOG_KEY).pipe(
      Effect.map((value) => (typeof value === "string" ? value : null)),
    ),
    write: (raw) => writeDatabaseValue(database, CATALOG_STORE_NAME, CATALOG_KEY, raw),
    quarantine: (raw) =>
      writeDatabaseValue(database, CATALOG_STORE_NAME, `${CATALOG_KEY}:corrupt:${Date.now()}`, raw),
  };
}

interface CatalogStore {
  readonly read: Effect.Effect<ConnectionCatalogDocumentType, ConnectionTransientError>;
  readonly update: (
    transform: (catalog: ConnectionCatalogDocumentType) => ConnectionCatalogDocumentType,
  ) => Effect.Effect<void, ConnectionTransientError>;
}

export const makeCatalogStore = Effect.fn("web.connectionStorage.makeCatalogStore")(function* (
  backend: CatalogBackend,
) {
  const state = yield* Ref.make<Option.Option<ConnectionCatalogDocumentType>>(Option.none());
  const lock = yield* Semaphore.make(1);

  const loadUnlocked = Effect.fn("web.connectionStorage.loadCatalog")(function* () {
    const cached = yield* Ref.get(state);
    if (Option.isSome(cached)) {
      return cached.value;
    }
    const raw = yield* backend.read;
    let catalog = EMPTY_CONNECTION_CATALOG_DOCUMENT;
    if (raw !== null && raw.trim() !== "") {
      catalog = yield* decodeCatalog(raw).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            yield* Effect.logWarning("Discarding a corrupt web connection catalog.", {
              error: error.message,
            });
            if (backend.quarantine !== undefined) {
              yield* backend.quarantine(raw).pipe(
                Effect.catch((cause) =>
                  Effect.logWarning("Could not quarantine the corrupt web connection catalog.", {
                    error: cause.message,
                  }),
                ),
              );
            }
            const encoded = yield* encodeCatalog(EMPTY_CONNECTION_CATALOG_DOCUMENT);
            yield* backend.write(encoded).pipe(
              Effect.catch((cause) =>
                Effect.logWarning("Could not persist the recovered web connection catalog.", {
                  error: cause.message,
                }),
              ),
            );
            return EMPTY_CONNECTION_CATALOG_DOCUMENT;
          }),
        ),
      );
    }
    yield* Ref.set(state, Option.some(catalog));
    return catalog;
  });

  const read = lock.withPermits(1)(loadUnlocked());
  const update: CatalogStore["update"] = Effect.fn("web.connectionStorage.updateCatalog")(
    function* (transform) {
      yield* lock.withPermits(1)(
        Effect.gen(function* () {
          const next = transform(yield* loadUnlocked());
          yield* backend.write(yield* encodeCatalog(next));
          yield* Ref.set(state, Option.some(next));
        }),
      );
    },
  );

  return { read, update } satisfies CatalogStore;
});

const GITHUB_ROUTING_KEY_PREFIX = "t3code:github-routing:";
const GITHUB_ROUTING_CHANGED = "t3code:github-routing-changed";
const isStoredGitHubRoutingPermission = Schema.is(StoredGitHubRoutingPermission);
const encodeStoredGitHubRoutingPermission = Schema.encodeSync(
  Schema.fromJsonString(StoredGitHubRoutingPermission),
);

/** Each grant has its own key so stale tabs and unrelated catalog saves cannot restore trust. */
export function makeBrowserGitHubRoutingPermissions(
  browser: Pick<Window, "localStorage"> & EventTarget = window,
) {
  const read = (key: string): StoredGitHubRoutingPermission | null => {
    try {
      const raw = browser.localStorage.getItem(key);
      const value: unknown = raw === null ? null : JSON.parse(raw);
      return isStoredGitHubRoutingPermission(value) &&
        key === `${GITHUB_ROUTING_KEY_PREFIX}${value.environmentId}`
        ? value
        : null;
    } catch {
      return null;
    }
  };
  const readAll = (): ReadonlyArray<StoredGitHubRoutingPermission> => {
    try {
      const values: StoredGitHubRoutingPermission[] = [];
      const storage = browser.localStorage;
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (key?.startsWith(GITHUB_ROUTING_KEY_PREFIX)) {
          const value = read(key);
          if (value !== null) values.push(value);
        }
      }
      return values;
    } catch {
      return [];
    }
  };
  const write = (environmentId: EnvironmentId, value: StoredGitHubRoutingPermission | null) =>
    Effect.try({
      try: () => {
        const key = `${GITHUB_ROUTING_KEY_PREFIX}${environmentId}`;
        if (value === null) browser.localStorage.removeItem(key);
        else browser.localStorage.setItem(key, encodeStoredGitHubRoutingPermission(value));
        browser.dispatchEvent(new Event(GITHUB_ROUTING_CHANGED));
      },
      catch: (cause) => catalogError("save GitHub routing permissions in", cause),
    });
  return GitHubRoutingPermissions.of({
    get: (entry) =>
      Effect.sync(() => {
        const value = read(`${GITHUB_ROUTING_KEY_PREFIX}${entry.target.environmentId}`);
        return gitHubRoutingPermissionFor(entry, value === null ? [] : [value]);
      }),
    changes: Stream.callback<ReadonlyArray<StoredGitHubRoutingPermission>>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const listener = (event: Event) => {
            if (event.type === "storage") {
              const key = (event as StorageEvent).key;
              if (key !== null && !key?.startsWith(GITHUB_ROUTING_KEY_PREFIX)) return;
            }
            Queue.offerUnsafe(queue, readAll());
          };
          browser.addEventListener("storage", listener);
          browser.addEventListener(GITHUB_ROUTING_CHANGED, listener);
          Queue.offerUnsafe(queue, readAll());
          return listener;
        }),
        (listener) =>
          Effect.sync(() => {
            browser.removeEventListener("storage", listener);
            browser.removeEventListener(GITHUB_ROUTING_CHANGED, listener);
          }),
      ).pipe(Effect.asVoid),
    ),
    set: (entry, permission) => {
      const connectionKey = gitHubRoutingConnectionKey(entry);
      if (connectionKey === null)
        return Effect.fail(
          new ConnectionBlockedError({
            reason: "configuration",
            detail: "This environment does not have a saved connection endpoint.",
          }),
        );
      return write(
        entry.target.environmentId,
        permission === "off"
          ? null
          : {
              environmentId: entry.target.environmentId,
              connectionKey,
              permission,
            },
      );
    },
    forget: (environmentId) => write(environmentId, null),
  });
}

export const connectionStorageLayer = Layer.effectContext(
  Effect.gen(function* () {
    const database = yield* Effect.acquireRelease(openDatabase(), (database) =>
      Effect.sync(() => database.close()),
    );
    const catalog = yield* makeCatalogStore(makeCatalogBackend(database));
    const githubRoutingPermissions = makeBrowserGitHubRoutingPermissions();

    const targetStore = ConnectionTargetStore.of({
      list: catalog.read.pipe(
        Effect.map((document) => document.targets),
        Effect.mapError((cause) => persistenceError("list-targets", cause)),
      ),
      listDisabled: catalog.read.pipe(
        Effect.map((document) => document.disabledEnvironmentIds),
        Effect.mapError((cause) => persistenceError("list-disabled-targets", cause)),
      ),
    });
    const registrationStore = ConnectionRegistrationStore.of({
      register: (registration) =>
        catalog
          .update((document) => registerConnectionInCatalog(document, registration))
          .pipe(Effect.mapError((cause) => persistenceError("register-connection", cause))),
      remove: (target) =>
        catalog
          .update((document) => removeConnectionFromCatalog(document, target))
          .pipe(Effect.mapError((cause) => persistenceError("remove-connection", cause))),
      setEnabled: (environmentId, enabled) =>
        catalog
          .update((document) => setConnectionEnabledInCatalog(document, environmentId, enabled))
          .pipe(Effect.mapError((cause) => persistenceError("set-connection-enabled", cause))),
    });
    const profileStore = ProfileStore.make({
      get: (connectionId) =>
        catalog.read.pipe(
          Effect.map((document) =>
            Option.fromUndefinedOr(
              document.profiles.find((profile) => profile.connectionId === connectionId),
            ),
          ),
        ),
      put: (profile) =>
        catalog.update((document) => ({
          ...document,
          profiles: replaceCatalogValue(document.profiles, (value) => value.connectionId, profile),
        })),
      remove: (connectionId) =>
        catalog.update((document) => ({
          ...document,
          profiles: removeCatalogValue(
            document.profiles,
            (value) => value.connectionId,
            connectionId,
          ),
        })),
    });
    const credentialStore = CredentialStore.make({
      get: (connectionId) =>
        catalog.read.pipe(
          Effect.map((document) =>
            Option.fromUndefinedOr(
              document.credentials.find((entry) => entry.connectionId === connectionId)?.credential,
            ),
          ),
        ),
      put: (connectionId, credential) =>
        // Aldo: a machine's registration carries a placeholder that's never read
        // (aldoEnvironmentGateway has its token), and storing it rewrote the whole
        // catalog once per machine, one after another, on every directory fetch.
        isAldoConnectionId(connectionId)
          ? Effect.void
          : catalog.update((document) => ({
              ...document,
              credentials: replaceCatalogValue(
                document.credentials,
                (value) => value.connectionId,
                { connectionId, credential },
              ),
            })),
      remove: (connectionId) =>
        catalog.update((document) => ({
          ...document,
          credentials: removeCatalogValue(
            document.credentials,
            (value) => value.connectionId,
            connectionId,
          ),
        })),
    });
    const remoteTokenStore = TokenStore.make({
      get: (environmentId) =>
        catalog.read.pipe(
          Effect.map((document) =>
            Option.fromUndefinedOr(
              document.remoteDpopTokens.find((token) => token.environmentId === environmentId),
            ),
          ),
        ),
      put: (token) => catalog.update((document) => putRemoteDpopTokenInCatalog(document, token)),
      remove: (environmentId) =>
        catalog.update((document) => ({
          ...document,
          remoteDpopTokens: removeCatalogValue(
            document.remoteDpopTokens,
            (value) => value.environmentId,
            environmentId,
          ),
        })),
    });
    const cacheStore = EnvironmentCacheStore.of({
      loadShell: (environmentId) =>
        Effect.suspend(() => {
          const read = shellsRead.get(environmentId);
          shellsRead.delete(environmentId);
          return read === undefined
            ? readDatabaseValue(database, SHELL_STORE_NAME, environmentId)
            : Effect.succeed<unknown>(read);
        }).pipe(
          Effect.tap(() => Effect.promise(() => projectFaviconCache.hydrate())),
          Effect.flatMap((raw) => {
            if (typeof raw !== "string") {
              return Effect.succeedNone;
            }
            return decodeStoredShellSnapshot(raw).pipe(
              Effect.mapError((cause) => persistenceError("load-shell", cause)),
              Effect.map((stored) =>
                stored.environmentId === environmentId
                  ? Option.some(stored.snapshot)
                  : Option.none(),
              ),
            );
          }),
          Effect.mapError((cause) =>
            cause._tag === "ConnectionPersistenceError"
              ? cause
              : persistenceError("load-shell", cause),
          ),
        ),
      saveShell: (environmentId, snapshot) =>
        Effect.gen(function* () {
          const encodedSnapshot = yield* encodeShellSnapshotForCache(snapshot);
          const encoded = yield* Effect.try({
            try: () =>
              // @effect-diagnostics-next-line preferSchemaOverJson:off - the snapshot is already encoded.
              JSON.stringify({
                schemaVersion: SHELL_SNAPSHOT_CACHE_SCHEMA_VERSION,
                environmentId,
                snapshot: encodedSnapshot,
              } satisfies typeof StoredShellSnapshot.Encoded),
            catch: (cause) => persistenceError("save-shell", cause),
          });
          yield* writeDatabaseValue(database, SHELL_STORE_NAME, environmentId, encoded);
          shellsRead.delete(environmentId);
        }).pipe(
          Effect.mapError((cause) =>
            cause._tag === "ConnectionPersistenceError"
              ? cause
              : persistenceError("save-shell", cause),
          ),
        ),
      loadServerConfig: (environmentId) =>
        readDatabaseValue(database, SERVER_CONFIG_STORE_NAME, environmentId).pipe(
          Effect.flatMap((raw) => {
            if (typeof raw !== "string") {
              return Effect.succeedNone;
            }
            return decodeStoredServerConfig(raw).pipe(
              Effect.mapError((cause) => persistenceError("load-server-config", cause)),
              Effect.map((stored) =>
                stored.environmentId === environmentId ? Option.some(stored.config) : Option.none(),
              ),
            );
          }),
          Effect.mapError((cause) =>
            cause._tag === "ConnectionPersistenceError"
              ? cause
              : persistenceError("load-server-config", cause),
          ),
        ),
      saveServerConfig: (environmentId, config) =>
        Effect.gen(function* () {
          const encoded = yield* encodeStoredServerConfig({
            schemaVersion: 1,
            environmentId,
            config,
          }).pipe(Effect.mapError((cause) => persistenceError("save-server-config", cause)));
          yield* writeDatabaseValue(database, SERVER_CONFIG_STORE_NAME, environmentId, encoded);
        }).pipe(
          Effect.mapError((cause) =>
            cause._tag === "ConnectionPersistenceError"
              ? cause
              : persistenceError("save-server-config", cause),
          ),
        ),
      loadThread: (environmentId, threadId) =>
        readDatabaseValue(
          database,
          THREAD_STORE_NAME,
          threadCacheKey(environmentId, threadId),
        ).pipe(
          Effect.flatMap((raw) => {
            if (typeof raw !== "string") {
              return Effect.succeedNone;
            }
            return decodeStoredThreadSnapshot(raw).pipe(
              Effect.mapError((cause) => persistenceError("load-thread", cause)),
              Effect.map((stored) =>
                stored.environmentId === environmentId && stored.threadId === threadId
                  ? Option.some(stored.snapshot)
                  : Option.none(),
              ),
            );
          }),
          Effect.mapError((cause) =>
            cause._tag === "ConnectionPersistenceError"
              ? cause
              : persistenceError("load-thread", cause),
          ),
          // Aldo: a sleeping machine's thread opens from Aldo's copy when it's newer,
          // or when the cached one can't be read (it's reported as before if Aldo has none).
          Effect.matchEffect({
            onSuccess: (cached) => withAldoThreadDetail(database, environmentId, threadId, cached),
            onFailure: (error) =>
              withAldoThreadDetail(database, environmentId, threadId, Option.none()).pipe(
                Effect.flatMap((copy) =>
                  Option.isSome(copy) ? Effect.succeed(copy) : Effect.fail(error),
                ),
              ),
          }),
        ),
      saveThread: (environmentId, snapshot) =>
        Effect.gen(function* () {
          const encoded = yield* encodeStoredThreadSnapshot({
            schemaVersion: 4,
            environmentId,
            threadId: snapshot.thread.id,
            snapshot,
          }).pipe(Effect.mapError((cause) => persistenceError("save-thread", cause)));
          yield* writeDatabaseValue(
            database,
            THREAD_STORE_NAME,
            threadCacheKey(environmentId, snapshot.thread.id),
            encoded,
          );
        }).pipe(
          Effect.mapError((cause) =>
            cause._tag === "ConnectionPersistenceError"
              ? cause
              : persistenceError("save-thread", cause),
          ),
        ),
      loadVcsRefs: (environmentId, cwd) =>
        readDatabaseValue(database, VCS_REFS_STORE_NAME, vcsRefsCacheKey(environmentId, cwd)).pipe(
          Effect.flatMap((raw) => {
            if (typeof raw !== "string") {
              return Effect.succeedNone;
            }
            return decodeStoredVcsRefs(raw).pipe(
              Effect.mapError((cause) => persistenceError("load-vcs-refs", cause)),
              Effect.map((stored) =>
                stored.environmentId === environmentId && stored.cwd === cwd
                  ? Option.some(stored.refs)
                  : Option.none(),
              ),
            );
          }),
          Effect.mapError((cause) =>
            cause._tag === "ConnectionPersistenceError"
              ? cause
              : persistenceError("load-vcs-refs", cause),
          ),
        ),
      saveVcsRefs: (environmentId, cwd, refs) =>
        Effect.gen(function* () {
          const encoded = yield* encodeStoredVcsRefs({
            schemaVersion: 1,
            environmentId,
            cwd,
            refs,
          }).pipe(Effect.mapError((cause) => persistenceError("save-vcs-refs", cause)));
          yield* writeDatabaseValue(
            database,
            VCS_REFS_STORE_NAME,
            vcsRefsCacheKey(environmentId, cwd),
            encoded,
          );
        }).pipe(
          Effect.mapError((cause) =>
            cause._tag === "ConnectionPersistenceError"
              ? cause
              : persistenceError("save-vcs-refs", cause),
          ),
        ),
      removeVcsRefs: (environmentId, cwd) =>
        removeDatabaseValue(
          database,
          VCS_REFS_STORE_NAME,
          vcsRefsCacheKey(environmentId, cwd),
        ).pipe(Effect.mapError((cause) => persistenceError("remove-vcs-refs", cause))),
      clearVcsRefs: (environmentId) =>
        removeDatabaseValuesInRange(
          database,
          VCS_REFS_STORE_NAME,
          IDBKeyRange.bound(`${environmentId}:`, `${environmentId}:\uffff`),
        ).pipe(Effect.mapError((cause) => persistenceError("clear-vcs-refs", cause))),
      removeThread: (environmentId, threadId) =>
        removeDatabaseValue(
          database,
          THREAD_STORE_NAME,
          threadCacheKey(environmentId, threadId),
        ).pipe(Effect.mapError((cause) => persistenceError("remove-thread", cause))),
      clear: (environmentId) =>
        // Aldo: a machine whose deletion is pending keeps its cache, in case it comes back.
        aldoKeepsEnvironmentCache(environmentId)
          ? Effect.void
          : clearCachedEnvironment(database, environmentId),
    });

    return Context.make(ConnectionTargetStore, targetStore).pipe(
      Context.add(GitHubRoutingPermissions, githubRoutingPermissions),
      Context.add(ConnectionRegistrationStore, registrationStore),
      Context.add(ProfileStore.ConnectionProfileStore, profileStore),
      Context.add(CredentialStore.ConnectionCredentialStore, credentialStore),
      Context.add(TokenStore.RemoteDpopAccessTokenStore, remoteTokenStore),
      Context.add(EnvironmentCacheStore, cacheStore),
    );
  }),
);

/**
 * Aldo: the thread as Aldo's copy has it when that's newer than the cached one
 * (for a machine that isn't connected; aldo/threadDetails.ts), and cached from
 * then on. A copy that doesn't decode, or isn't newer, leaves the cache as it was.
 */
function withAldoThreadDetail(
  database: IDBDatabase,
  environmentId: EnvironmentId,
  threadId: ThreadId,
  cached: Option.Option<OrchestrationThreadDetailSnapshot>,
) {
  const cachedSequence = Option.match(cached, {
    onNone: () => null,
    onSome: (snapshot) => snapshot.snapshotSequence,
  });
  return Effect.promise(() => aldoThreadDetail(environmentId, threadId, cachedSequence)).pipe(
    Effect.flatMap((copy) =>
      copy === null
        ? Effect.succeed(cached)
        : decodeThreadDetailSnapshot(copy).pipe(
            Effect.flatMap((snapshot) =>
              snapshot.thread.id !== threadId || snapshot.snapshotSequence <= (cachedSequence ?? -1)
                ? Effect.succeed(cached)
                : encodeStoredThreadSnapshot({
                    schemaVersion: 4,
                    environmentId,
                    threadId,
                    snapshot,
                  }).pipe(
                    Effect.flatMap((encoded) =>
                      writeDatabaseValue(
                        database,
                        THREAD_STORE_NAME,
                        threadCacheKey(environmentId, threadId),
                        encoded,
                      ),
                    ),
                    // Shown even if it couldn't be cached.
                    Effect.ignore,
                    Effect.as(Option.some(snapshot)),
                  ),
            ),
            Effect.orElseSucceed(() => cached),
          ),
    ),
  );
}

function clearCachedEnvironment(database: IDBDatabase, environmentId: EnvironmentId) {
  shellsRead.delete(environmentId);
  return Effect.all(
    [
      Effect.promise(() => projectFaviconCache.clearEnvironment(environmentId)),
      removeDatabaseValue(database, SHELL_STORE_NAME, environmentId),
      removeDatabaseValuesInRange(
        database,
        THREAD_STORE_NAME,
        IDBKeyRange.bound(`${environmentId}:`, `${environmentId}:\uffff`),
      ),
      removeDatabaseValue(database, SERVER_CONFIG_STORE_NAME, environmentId),
      removeDatabaseValuesInRange(
        database,
        VCS_REFS_STORE_NAME,
        IDBKeyRange.bound(`${environmentId}:`, `${environmentId}:\uffff`),
      ),
    ],
    { concurrency: "unbounded", discard: true },
  ).pipe(Effect.mapError((cause) => persistenceError("clear-environment", cause)));
}

/** Clears an environment's cache. Aldo: a deleted machine's, which it kept while deleting it. */
export function clearEnvironmentCache(environmentId: EnvironmentId): Promise<void> {
  return Effect.runPromise(
    Effect.acquireUseRelease(
      openDatabase(),
      (database) => clearCachedEnvironment(database, environmentId),
      (database) => Effect.sync(() => database.close()),
    ),
  );
}

const decodeShellSnapshot = Schema.decodeUnknownEffect(OrchestrationShellSnapshot);
const encodeStoredShellSnapshot = Schema.encodeEffect(StoredShellSnapshotJson);
const decodeThreadDetailSnapshot = Schema.decodeUnknownEffect(OrchestrationThreadDetailSnapshot);
const decodeServerConfig = Schema.decodeUnknownEffect(ServerConfig);

/**
 * Writes an environment's cached shell snapshot and server config before the
 * environment is registered, so it opens with them. Aldo uses this to show a
 * thread's project and models before the thread's machine exists. Both go
 * through the same schemas as the cache itself.
 */
export function seedEnvironmentCache(input: {
  readonly environmentId: EnvironmentId;
  readonly shell: unknown;
  readonly serverConfig: unknown;
}): Promise<void> {
  return Effect.runPromise(
    Effect.acquireUseRelease(
      openDatabase(),
      (database) =>
        Effect.gen(function* () {
          const snapshot = yield* decodeShellSnapshot(input.shell);
          const shell = yield* encodeStoredShellSnapshot({
            schemaVersion: SHELL_SNAPSHOT_CACHE_SCHEMA_VERSION,
            environmentId: input.environmentId,
            snapshot,
          });
          yield* writeDatabaseValue(database, SHELL_STORE_NAME, input.environmentId, shell);
          shellsRead.set(input.environmentId, shell);
          if (input.serverConfig !== null) {
            const config = yield* decodeServerConfig(input.serverConfig);
            const stored = yield* encodeStoredServerConfig({
              schemaVersion: 1,
              environmentId: input.environmentId,
              config,
            });
            yield* writeDatabaseValue(
              database,
              SERVER_CONFIG_STORE_NAME,
              input.environmentId,
              stored,
            );
          }
        }),
      (database) => Effect.sync(() => database.close()),
    ),
  );
}

/**
 * Aldo: writes the server config given for each environment that has none
 * cached (a sleeping machine this browser never connected to), so its threads
 * open with models to send with; a cached one, from the machine itself, is
 * kept, with the providers the given one lists that it lacks added (its T3
 * started before they shipped, and gets them when it starts again), and the
 * user's `settings` that Aldo keeps over its own (it gets those as it wakes).
 * Checked and written in one transaction. Returns the environments written,
 * and the ones whose cached config was kept as it was.
 */
export function seedMissingServerConfigs(
  configs: ReadonlyMap<EnvironmentId, unknown>,
  settings: Readonly<Record<string, unknown>> = {},
): Promise<{ readonly written: EnvironmentId[]; readonly kept: EnvironmentId[] }> {
  return Effect.runPromise(
    Effect.acquireUseRelease(
      openDatabase(),
      (database) =>
        Effect.gen(function* () {
          const encoded = new Map<EnvironmentId, string>();
          for (const [environmentId, raw] of configs) {
            const config = yield* decodeServerConfig(raw).pipe(Effect.option);
            if (Option.isNone(config)) continue;
            const stored = yield* encodeStoredServerConfig({
              schemaVersion: 1,
              environmentId,
              config: config.value,
            }).pipe(Effect.option);
            if (Option.isSome(stored)) encoded.set(environmentId, stored.value);
          }
          return yield* Effect.callback<
            { written: EnvironmentId[]; kept: EnvironmentId[] },
            ConnectionTransientError
          >((resume) => {
            const written: EnvironmentId[] = [];
            const kept: EnvironmentId[] = [];
            const transaction = database.transaction(SERVER_CONFIG_STORE_NAME, "readwrite");
            transaction.addEventListener("error", () => {
              resume(
                Effect.fail(
                  catalogError("write", transaction.error ?? "Unknown IndexedDB write error"),
                ),
              );
            });
            transaction.addEventListener("complete", () => {
              resume(Effect.succeed({ written, kept }));
            });
            const store = transaction.objectStore(SERVER_CONFIG_STORE_NAME);
            for (const [environmentId, value] of encoded) {
              const request = store.get(environmentId);
              request.addEventListener("success", () => {
                const next =
                  request.result === undefined
                    ? value
                    : withAldoTemplate(request.result, value, settings);
                if (next === null) {
                  kept.push(environmentId);
                  return;
                }
                store.put(next, environmentId);
                written.push(environmentId);
              });
            }
          });
        }),
      (database) => Effect.sync(() => database.close()),
    ),
  );
}

/** A cached shell as stored, read without decoding it (aldo/shells.ts compares many at once). */
export interface CachedShellSummary {
  readonly sequence: number;
  readonly threadCount: number;
  /** The stored (encoded) snapshot. */
  readonly snapshot: unknown;
}

function summarizeStoredShell(
  raw: unknown,
  environmentId: EnvironmentId,
): CachedShellSummary | null {
  if (typeof raw !== "string") return null;
  try {
    const stored = JSON.parse(raw) as {
      schemaVersion?: unknown;
      environmentId?: unknown;
      snapshot?: { snapshotSequence?: unknown; threads?: unknown };
    };
    const sequence = stored.snapshot?.snapshotSequence;
    const threads = stored.snapshot?.threads;
    if (
      stored.schemaVersion !== SHELL_SNAPSHOT_CACHE_SCHEMA_VERSION ||
      stored.environmentId !== environmentId ||
      typeof sequence !== "number" ||
      !Array.isArray(threads)
    ) {
      return null;
    }
    return { sequence, threadCount: threads.length, snapshot: stored.snapshot };
  } catch {
    return null;
  }
}

/**
 * The shells cached for these environments, in one read. Aldo compares their
 * sequences with the copies it keeps of its machines' shells, and the
 * machines' first loads take them from here (shellsRead).
 */
export function readCachedShells(
  environmentIds: ReadonlyArray<EnvironmentId>,
): Promise<Map<EnvironmentId, CachedShellSummary>> {
  return Effect.runPromise(
    Effect.acquireUseRelease(
      openDatabase(),
      (database) =>
        Effect.callback<Map<EnvironmentId, CachedShellSummary>, ConnectionTransientError>(
          (resume) => {
            const shells = new Map<EnvironmentId, CachedShellSummary>();
            const transaction = database.transaction(SHELL_STORE_NAME, "readonly");
            transaction.addEventListener("error", () => {
              resume(
                Effect.fail(
                  catalogError("read", transaction.error ?? "Unknown IndexedDB read error"),
                ),
              );
            });
            transaction.addEventListener("complete", () => {
              resume(Effect.succeed(shells));
            });
            const store = transaction.objectStore(SHELL_STORE_NAME);
            for (const environmentId of environmentIds) {
              const request = store.get(environmentId);
              request.addEventListener("success", () => {
                const shell = summarizeStoredShell(request.result, environmentId);
                if (shell) shells.set(environmentId, shell);
                if (typeof request.result === "string")
                  shellsRead.set(environmentId, request.result);
              });
            }
          },
        ),
      (database) => Effect.sync(() => database.close()),
    ),
  );
}
