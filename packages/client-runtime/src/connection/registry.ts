import { EnvironmentId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as ClientCapabilities from "../platform/capabilities.ts";
import {
  type ConnectionCatalogEntry,
  type ConnectionRegistration,
  type PlatformConnectionRegistration,
  type PrimaryConnectionRegistration,
  SshConnectionProfile,
  connectionRegistrationCatalogEntry,
} from "./catalog.ts";
import * as ConnectionCredentialStore from "./credentialStore.ts";
import * as ConnectionProfileStore from "./profileStore.ts";
import * as Connectivity from "./connectivity.ts";
import type {
  ConnectionAttemptError,
  ConnectionTarget,
  NetworkStatus,
  SupervisorConnectionState,
} from "./model.ts";
import { ConnectionBlockedError } from "./model.ts";
import * as Persistence from "../platform/persistence.ts";
import * as EnvironmentSupervisor from "./supervisor.ts";
import * as ConnectionDriver from "./driver.ts";
import * as ConnectionWakeups from "./wakeups.ts";
import {
  GitHubRoutingPermissions,
  gitHubRoutingConnectionKey,
} from "./githubRoutingPermissions.ts";

const isSshConnectionProfile = Schema.is(SshConnectionProfile);

export class EnvironmentNotRegisteredError extends Schema.TaggedError<EnvironmentNotRegisteredError>()(
  "EnvironmentNotRegisteredError",
  {
    environmentId: EnvironmentId,
  },
) {
  override get message(): string {
    return `Environment ${this.environmentId} is not registered.`;
  }
}

export class PlatformEnvironmentRemovalError extends Schema.TaggedError<PlatformEnvironmentRemovalError>()(
  "PlatformEnvironmentRemovalError",
  {
    environmentId: EnvironmentId,
  },
) {
  override get message(): string {
    return `Platform-managed environment ${this.environmentId} cannot be removed.`;
  }
}

export class EnvironmentRegistry extends Context.Service<
  EnvironmentRegistry,
  {
    readonly entries: SubscriptionRef.SubscriptionRef<
      ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>
    >;
    readonly networkStatus: SubscriptionRef.SubscriptionRef<NetworkStatus>;
    /**
     * Platform environments the host says are asleep that nothing has started
     * (reconcilePlatform's `asleep`): `run` and the like start one, so what
     * only concerns running ones passes these over.
     */
    readonly dormant: SubscriptionRef.SubscriptionRef<ReadonlySet<EnvironmentId>>;
    readonly start: Effect.Effect<void>;
    readonly register: (
      registration: ConnectionRegistration,
    ) => Effect.Effect<void, Persistence.ConnectionPersistenceError>;
    readonly registerPlatform: (registration: PrimaryConnectionRegistration) => Effect.Effect<void>;
    /**
     * Installs the platform environments the host reports, and removes the
     * ones it no longer does. `asleep`: the ones it says are asleep. Nothing
     * starts for those until something needs it to (followStream).
     */
    readonly reconcilePlatform: (
      registrations: ReadonlyArray<PlatformConnectionRegistration>,
      asleep?: ReadonlySet<EnvironmentId>,
    ) => Effect.Effect<void>;
    readonly remove: (
      environmentId: EnvironmentId,
    ) => Effect.Effect<
      void,
      | Persistence.ConnectionPersistenceError
      | ConnectionAttemptError
      | EnvironmentNotRegisteredError
      | PlatformEnvironmentRemovalError
    >;
    readonly removeRelayEnvironments: () => Effect.Effect<
      void,
      | Persistence.ConnectionPersistenceError
      | ConnectionAttemptError
      | PlatformEnvironmentRemovalError
    >;
    readonly retryNow: (environmentId: EnvironmentId) => Effect.Effect<void>;
    /**
     * Switches a saved environment on or off. Off drops the socket, stops the
     * retry ladder, and persists so the next launch stays off. Registration,
     * credentials, and cache are untouched.
     */
    readonly setEnabled: (
      environmentId: EnvironmentId,
      enabled: boolean,
    ) => Effect.Effect<
      void,
      | EnvironmentNotRegisteredError
      | Persistence.ConnectionPersistenceError
      | ConnectionBlockedError
    >;
    readonly setCompatibility: (
      environmentId: EnvironmentId,
      error: ConnectionBlockedError | null,
    ) => Effect.Effect<void, Persistence.ConnectionPersistenceError>;
    readonly state: (
      environmentId: EnvironmentId,
    ) => Effect.Effect<SupervisorConnectionState, EnvironmentNotRegisteredError>;
    readonly stateChanges: (
      environmentId: EnvironmentId,
    ) => Stream.Stream<SupervisorConnectionState, EnvironmentNotRegisteredError>;
    readonly run: <A, E, R>(
      environmentId: EnvironmentId,
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<
      A,
      E | EnvironmentNotRegisteredError,
      Exclude<R, EnvironmentSupervisor.EnvironmentSupervisor>
    >;
    readonly runStream: <A, E, R>(
      environmentId: EnvironmentId,
      stream: Stream.Stream<A, E, R>,
    ) => Stream.Stream<
      A,
      E | EnvironmentNotRegisteredError,
      Exclude<R, EnvironmentSupervisor.EnvironmentSupervisor>
    >;
    /**
     * `stream` in the environment while it's registered, started again when
     * its entry changes. A dormant environment (one reconcilePlatform was told
     * is asleep that nothing has started) follows `whileDormant` instead, if
     * given, until it starts; following one without it starts it.
     */
    readonly followStream: <A, E, R, E2 = never, R2 = never>(
      environmentId: EnvironmentId,
      stream: Stream.Stream<A, E, R>,
      whileDormant?: Stream.Stream<A, E2, R2>,
    ) => Stream.Stream<A, E | E2, Exclude<R, EnvironmentSupervisor.EnvironmentSupervisor> | R2>;
  }
>()("@t3tools/client-runtime/connection/registry/EnvironmentRegistry") {}

interface EnvironmentServiceScope {
  readonly entry: ConnectionCatalogEntry;
  readonly supervisor: EnvironmentSupervisor.EnvironmentSupervisor["Service"];
  readonly scope: Scope.Closeable;
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const registryScope = yield* Scope.Scope;
  const storage = yield* Persistence.ConnectionTargetStore;
  const registrations = yield* Persistence.ConnectionRegistrationStore;
  const cache = yield* Persistence.EnvironmentCacheStore;
  const ownedDataCleanup = yield* Persistence.EnvironmentOwnedDataCleanup;
  const profiles = yield* ConnectionProfileStore.ConnectionProfileStore;
  const credentials = yield* ConnectionCredentialStore.ConnectionCredentialStore;
  const githubRoutingPermissions = yield* GitHubRoutingPermissions;
  const connectivity = yield* Connectivity.Connectivity;
  const driver = yield* ConnectionDriver.ConnectionDriver;
  const wakeups = yield* ConnectionWakeups.ConnectionWakeups;
  const ssh = yield* ClientCapabilities.SshEnvironmentGateway;
  const persistedTargets = yield* storage.list;
  const disabledEnvironmentIds = new Set(yield* storage.listDisabled);
  const initialEntries = new Map(
    yield* Effect.forEach(
      persistedTargets,
      Effect.fn("EnvironmentRegistry.loadCatalogEntry")(function* (target) {
        const profile =
          target._tag === "BearerConnectionTarget" || target._tag === "SshConnectionTarget"
            ? yield* profiles.get(target.connectionId)
            : Option.none();
        return [
          target.environmentId,
          {
            target,
            profile,
            enabled: !disabledEnvironmentIds.has(target.environmentId),
          } satisfies ConnectionCatalogEntry,
        ] as const;
      }),
      { concurrency: "unbounded" },
    ),
  );
  const entries =
    yield* SubscriptionRef.make<ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>>(initialEntries);
  const networkStatus = yield* SubscriptionRef.make(yield* connectivity.status);
  const serviceScopes = yield* SubscriptionRef.make<
    ReadonlyMap<EnvironmentId, EnvironmentServiceScope>
  >(new Map());
  const platformEnvironmentIds = yield* Ref.make<ReadonlySet<EnvironmentId>>(new Set());
  const persistedTargetsByEnvironment = yield* Ref.make<
    ReadonlyMap<EnvironmentId, ConnectionTarget>
  >(new Map(persistedTargets.map((target) => [target.environmentId, target])));
  interface LeaseLock {
    readonly semaphore: Semaphore.Semaphore;
    readonly users: number;
  }

  const leaseLocks = yield* Ref.make<ReadonlyMap<EnvironmentId, LeaseLock>>(new Map());
  /**
   * The registration each platform environment was last installed from, and
   * the entry it installed: reported again unchanged, it needs nothing, so a
   * host poll that changes nothing doesn't lock and check every environment.
   */
  const installedPlatform = new Map<
    EnvironmentId,
    {
      readonly registration: PlatformConnectionRegistration;
      readonly entry: ConnectionCatalogEntry;
    }
  >();
  /** The platform environments the host said are asleep when it last reported them. */
  let asleep: ReadonlySet<EnvironmentId> = new Set();
  /**
   * Those of them with no runtime started: dormant. What can show one from
   * its cache does (followStream's `whileDormant`), so hundreds of sleeping
   * environments run nothing until one is needed: a request, a retry, a
   * stream that can't.
   */
  const dormant = yield* SubscriptionRef.make<ReadonlySet<EnvironmentId>>(new Set());
  const syncDormant = Effect.gen(function* () {
    const scopes = yield* SubscriptionRef.get(serviceScopes);
    const current = yield* SubscriptionRef.get(dormant);
    const next = new Set([...asleep].filter((environmentId) => !scopes.has(environmentId)));
    if (
      next.size !== current.size ||
      [...next].some((environmentId) => !current.has(environmentId))
    ) {
      yield* SubscriptionRef.set(dormant, next);
    }
  });
  const leaseLocksGuard = yield* Semaphore.make(1);
  const started = yield* Ref.make(false);

  const withLeaseLock = <A, E, R>(
    environmentId: EnvironmentId,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> =>
    Effect.acquireUseRelease(
      leaseLocksGuard.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* Ref.get(leaseLocks);
          const existing = current.get(environmentId);
          if (existing !== undefined) {
            yield* Ref.set(
              leaseLocks,
              new Map(current).set(environmentId, {
                semaphore: existing.semaphore,
                users: existing.users + 1,
              }),
            );
            return existing.semaphore;
          }
          const semaphore = yield* Semaphore.make(1);
          yield* Ref.set(leaseLocks, new Map(current).set(environmentId, { semaphore, users: 1 }));
          return semaphore;
        }),
      ),
      (semaphore) => semaphore.withPermits(1)(effect),
      (semaphore) =>
        leaseLocksGuard.withPermits(1)(
          Ref.update(leaseLocks, (current) => {
            const existing = current.get(environmentId);
            if (existing === undefined || existing.semaphore !== semaphore) {
              return current;
            }
            const next = new Map(current);
            if (existing.users === 1) {
              next.delete(environmentId);
            } else {
              next.set(environmentId, {
                semaphore,
                users: existing.users - 1,
              });
            }
            return next;
          }),
        ),
    ).pipe(Effect.withSpan("EnvironmentRegistry.withLeaseLock"));

  const getEntry = Effect.fn("EnvironmentRegistry.getEntry")(function* (
    environmentId: EnvironmentId,
  ) {
    const entry = (yield* SubscriptionRef.get(entries)).get(environmentId);
    if (entry === undefined) {
      return yield* new EnvironmentNotRegisteredError({
        environmentId,
      });
    }
    return entry;
  });

  const closeServiceScope = Effect.fn("EnvironmentRegistry.closeServiceScope")(function* (
    environmentId: EnvironmentId,
  ) {
    const current = yield* SubscriptionRef.get(serviceScopes);
    const lease = current.get(environmentId);
    if (lease === undefined) {
      return;
    }
    const next = new Map(current);
    next.delete(environmentId);
    yield* SubscriptionRef.set(serviceScopes, next);
    yield* Scope.close(lease.scope, Exit.void);
  });

  const createServiceScope = Effect.fn("EnvironmentRegistry.createServiceScope")(
    (entry: ConnectionCatalogEntry) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const environmentId = entry.target.environmentId;
          const scope = yield* Scope.fork(registryScope);
          const supervisor = yield* EnvironmentSupervisor.make(entry, {
            initiallyDesired: false,
          }).pipe(
            Effect.provideService(Connectivity.Connectivity, connectivity),
            Effect.provideService(ConnectionDriver.ConnectionDriver, driver),
            Effect.provideService(ConnectionWakeups.ConnectionWakeups, wakeups),
            Scope.provide(scope),
            Effect.onError(() => Scope.close(scope, Exit.void)),
          );
          if (entry.enabled) {
            yield* supervisor.connect;
          }
          yield* SubscriptionRef.update(serviceScopes, (current) => {
            const next = new Map(current);
            next.set(environmentId, { entry, supervisor, scope });
            return next;
          });
          // Started: what showed it from its cache while dormant follows it now.
          yield* syncDormant;
          yield* SubscriptionRef.changes(supervisor.state).pipe(
            Stream.runForEach((state) =>
              state.phase === "blocked" && state.lastFailure?.reason === "unsupported"
                ? setCompatibility(environmentId, state.lastFailure).pipe(
                    Effect.catch((error) =>
                      Effect.logWarning("Could not disable an unsupported environment.", {
                        environmentId,
                        error,
                      }),
                    ),
                  )
                : Effect.void,
            ),
            Effect.forkIn(scope),
          );
          return supervisor;
        }),
      ),
  );

  const acquireSupervisor = Effect.fn("EnvironmentRegistry.acquireSupervisor")(function* (
    environmentId: EnvironmentId,
  ) {
    // A runtime already running its entry needs no lock while nothing else
    // holds it: every request and stream for an environment comes through
    // here, often for all of them at once.
    const running = (yield* SubscriptionRef.get(serviceScopes)).get(environmentId);
    if (
      running !== undefined &&
      running.entry === (yield* SubscriptionRef.get(entries)).get(environmentId) &&
      !(yield* Ref.get(leaseLocks)).has(environmentId)
    ) {
      return running.supervisor;
    }
    return yield* withLeaseLock(
      environmentId,
      Effect.gen(function* () {
        const entry = yield* getEntry(environmentId);
        const existing = (yield* SubscriptionRef.get(serviceScopes)).get(environmentId);
        if (existing !== undefined) {
          if (Equal.equals(existing.entry, entry)) {
            return existing.supervisor;
          }
          yield* closeServiceScope(environmentId);
        }
        return yield* createServiceScope(entry);
      }),
    );
  });

  const run: EnvironmentRegistry["Service"]["run"] = Effect.fn("EnvironmentRegistry.run")(
    function* <A, E, R>(environmentId: EnvironmentId, effect: Effect.Effect<A, E, R>) {
      const supervisor = yield* acquireSupervisor(environmentId);
      return yield* Effect.provideService(
        effect,
        EnvironmentSupervisor.EnvironmentSupervisor,
        supervisor,
      );
    },
  );

  const runStream: EnvironmentRegistry["Service"]["runStream"] = <A, E, R>(
    environmentId: EnvironmentId,
    stream: Stream.Stream<A, E, R>,
  ) =>
    Stream.unwrap(
      acquireSupervisor(environmentId).pipe(
        Effect.map((supervisor) =>
          Stream.provideService(stream, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
        ),
      ),
    );

  const changesOf = <A>(ref: SubscriptionRef.SubscriptionRef<A>) =>
    Stream.concat(Stream.fromEffect(SubscriptionRef.get(ref)), SubscriptionRef.changes(ref));

  const followStream: EnvironmentRegistry["Service"]["followStream"] = <
    A,
    E,
    R,
    E2 = never,
    R2 = never,
  >(
    environmentId: EnvironmentId,
    stream: Stream.Stream<A, E, R>,
    whileDormant?: Stream.Stream<A, E2, R2>,
  ) => {
    type Followed = Stream.Stream<
      A,
      E | E2,
      Exclude<R, EnvironmentSupervisor.EnvironmentSupervisor> | R2
    >;
    const running: Followed = Stream.unwrap(
      acquireSupervisor(environmentId).pipe(
        Effect.match({
          onFailure: (): Followed => Stream.empty,
          onSuccess: (supervisor): Followed =>
            Stream.provideService(stream, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
        }),
      ),
    );
    const registered: Followed =
      whileDormant === undefined
        ? running
        : changesOf(dormant).pipe(
            Stream.map((current) => current.has(environmentId)),
            Stream.changes,
            Stream.switchMap((isDormant): Followed => (isDormant ? whileDormant : running)),
          );
    return changesOf(entries).pipe(
      Stream.map((current) => Option.fromUndefinedOr(current.get(environmentId))),
      Stream.changes,
      Stream.switchMap(
        Option.match({
          onNone: () => Stream.empty,
          onSome: () => registered,
        }),
      ),
    );
  };

  const start = Effect.gen(function* () {
    if (yield* Ref.getAndSet(started, true)) {
      return;
    }
    yield* Effect.forEach(
      persistedTargets,
      (target) =>
        acquireSupervisor(target.environmentId).pipe(
          Effect.catchTag("EnvironmentNotRegisteredError", () => Effect.void),
        ),
      {
        concurrency: "unbounded",
        discard: true,
      },
    );
  }).pipe(Effect.withSpan("EnvironmentRegistry.start"));

  /** Whether an environment is installed and running as this entry describes. */
  const runsAs = Effect.fn("EnvironmentRegistry.runsAs")(function* (entry: ConnectionCatalogEntry) {
    const environmentId = entry.target.environmentId;
    const previous = (yield* SubscriptionRef.get(entries)).get(environmentId);
    const existingScope = (yield* SubscriptionRef.get(serviceScopes)).get(environmentId);
    return (
      previous !== undefined &&
      Equal.equals(previous, entry) &&
      existingScope !== undefined &&
      Equal.equals(existingScope.entry, entry)
    );
  });

  const installEntryLocked = Effect.fn("EnvironmentRegistry.installEntryLocked")(function* (
    entry: ConnectionCatalogEntry,
    options?: { readonly retainEquivalentRuntime?: boolean },
  ) {
    const target = entry.target;
    if (options?.retainEquivalentRuntime === true && (yield* runsAs(entry))) {
      return;
    }

    yield* closeServiceScope(target.environmentId);
    yield* SubscriptionRef.update(entries, (current) => {
      const next = new Map(current);
      next.set(target.environmentId, entry);
      return next;
    });
    yield* createServiceScope(entry);
  });

  const register = Effect.fn("EnvironmentRegistry.register")(function* (
    registration: ConnectionRegistration,
  ) {
    const registered = connectionRegistrationCatalogEntry(registration);
    const environmentId = registered.target.environmentId;
    yield* withLeaseLock(
      environmentId,
      Effect.gen(function* () {
        if ((yield* Ref.get(platformEnvironmentIds)).has(environmentId)) {
          return;
        }
        // Editing a saved environment must preserve its disabled state.
        const previous = (yield* SubscriptionRef.get(entries)).get(environmentId);
        const entry: ConnectionCatalogEntry =
          previous === undefined
            ? registered
            : {
                ...registered,
                enabled: previous.enabled,
                ...(previous.unsupportedReason !== undefined &&
                gitHubRoutingConnectionKey(previous) === gitHubRoutingConnectionKey(registered)
                  ? { unsupportedReason: previous.unsupportedReason }
                  : {}),
              };
        if (
          previous !== undefined &&
          gitHubRoutingConnectionKey(previous) !== gitHubRoutingConnectionKey(entry)
        ) {
          yield* githubRoutingPermissions.forget(environmentId).pipe(
            Effect.mapError(
              (error) =>
                new Persistence.ConnectionPersistenceError({
                  operation: "register-connection",
                  message: error.message,
                }),
            ),
          );
        }
        yield* registrations.register(registration);
        yield* Ref.update(persistedTargetsByEnvironment, (current) => {
          const next = new Map(current);
          next.set(environmentId, registration.target);
          return next;
        });
        yield* installEntryLocked(entry);
      }),
    );
  });

  /**
   * Installs a platform environment. With `batch`, its entry is added there
   * instead of to the catalog, for reconcilePlatform to install with the rest.
   */
  const installPlatformRegistration = Effect.fn("EnvironmentRegistry.installPlatformRegistration")(
    function* (
      registration: PlatformConnectionRegistration,
      batch?: Array<ConnectionCatalogEntry>,
    ) {
      const registered = connectionRegistrationCatalogEntry(registration);
      const target = registered.target;
      return yield* withLeaseLock(
        target.environmentId,
        Effect.gen(function* () {
          const previous = (yield* SubscriptionRef.get(entries)).get(target.environmentId);
          const entry: ConnectionCatalogEntry =
            previous?.unsupportedReason !== undefined &&
            gitHubRoutingConnectionKey(previous) === gitHubRoutingConnectionKey(registered)
              ? { ...registered, enabled: false, unsupportedReason: previous.unsupportedReason }
              : registered;
          const persistedTarget = (yield* Ref.get(persistedTargetsByEnvironment)).get(
            target.environmentId,
          );
          if (
            persistedTarget !== undefined ||
            (previous !== undefined &&
              gitHubRoutingConnectionKey(previous) !== gitHubRoutingConnectionKey(entry))
          ) {
            const revoked = yield* githubRoutingPermissions.forget(target.environmentId).pipe(
              Effect.tapError((error) =>
                Effect.logWarning(
                  "Could not clear GitHub routing permission for a platform environment.",
                  {
                    environmentId: target.environmentId,
                    error,
                  },
                ),
              ),
              Effect.exit,
            );
            if (Exit.isFailure(revoked)) return false;
          }
          if (!(yield* Ref.get(platformEnvironmentIds)).has(target.environmentId)) {
            yield* Ref.update(platformEnvironmentIds, (current) => {
              const next = new Set(current);
              next.add(target.environmentId);
              return next;
            });
          }

          // Secondary desktop-local backends (e.g. a parallel WSL backend) live
          // on their own loopback origin, so they authenticate with a bearer
          // token instead of the primary's same-origin cookie. Stash it where
          // the resolver's bearer broker looks it up.
          if (registration._tag === "BearerConnectionRegistration") {
            yield* credentials.put(registration.target.connectionId, registration.credential).pipe(
              Effect.catch((error) =>
                Effect.logWarning("Could not store the platform bearer credential.", {
                  environmentId: target.environmentId,
                  error,
                }),
              ),
            );
          }

          if (persistedTarget !== undefined) {
            yield* registrations.remove(persistedTarget).pipe(
              Effect.tap(() =>
                Ref.update(persistedTargetsByEnvironment, (current) => {
                  const next = new Map(current);
                  next.delete(target.environmentId);
                  return next;
                }),
              ),
              Effect.catch((error) =>
                Effect.logWarning(
                  "Could not remove a persisted registration shadowed by a platform environment.",
                  {
                    environmentId: target.environmentId,
                    error,
                  },
                ),
              ),
            );
          }

          if (batch === undefined) {
            yield* installEntryLocked(entry, { retainEquivalentRuntime: true });
          } else if (!(yield* runsAs(entry))) {
            yield* closeServiceScope(target.environmentId);
            batch.push(entry);
          }
          return true;
        }),
      );
    },
  );

  // Tear down a platform-managed environment that the host no longer reports
  // (e.g. the user turned the parallel WSL backend off). Platform environments
  // bypass the user-facing `remove` guard since they are reconciled from the
  // bootstrap rather than removed by hand.
  const removePlatformEnvironment = Effect.fn("EnvironmentRegistry.removePlatformEnvironment")(
    function* (environmentId: EnvironmentId) {
      yield* withLeaseLock(
        environmentId,
        Effect.gen(function* () {
          const entry = (yield* SubscriptionRef.get(entries)).get(environmentId);
          const revoked = yield* githubRoutingPermissions.forget(environmentId).pipe(
            Effect.tapError((error) =>
              Effect.logWarning(
                "Could not clear GitHub routing permission after platform removal.",
                {
                  environmentId,
                  error,
                },
              ),
            ),
            Effect.exit,
          );
          if (Exit.isFailure(revoked)) return;
          installedPlatform.delete(environmentId);
          yield* Ref.update(platformEnvironmentIds, (current) => {
            const next = new Set(current);
            next.delete(environmentId);
            return next;
          });
          yield* closeServiceScope(environmentId);
          yield* SubscriptionRef.update(entries, (current) => {
            const next = new Map(current);
            next.delete(environmentId);
            return next;
          });
          if (entry !== undefined && entry.target._tag === "BearerConnectionTarget") {
            yield* credentials.remove(entry.target.connectionId).pipe(
              Effect.catch((error) =>
                Effect.logWarning("Could not clear the platform bearer credential.", {
                  environmentId,
                  error,
                }),
              ),
            );
          }
          yield* Effect.all(
            [
              cache.clear(environmentId).pipe(
                Effect.catch((error) =>
                  Effect.logWarning("Could not clear cached environment data after removal.", {
                    environmentId,
                    error,
                  }),
                ),
              ),
              ownedDataCleanup.clear(environmentId),
            ],
            { concurrency: "unbounded", discard: true },
          );
        }),
      );
    },
  );

  const registerPlatform = Effect.fn("EnvironmentRegistry.registerPlatform")(function* (
    registration: PrimaryConnectionRegistration,
  ) {
    yield* installPlatformRegistration(registration);
  });

  // Reconcile the full set of platform-managed environments against what the
  // host currently reports: add/refresh the desired ones and tear down any
  // platform environment that disappeared (WSL toggled off, distro switched).
  const reconcilePlatform = Effect.fn("EnvironmentRegistry.reconcilePlatform")(function* (
    platformRegistrations: ReadonlyArray<PlatformConnectionRegistration>,
    reportedAsleep: ReadonlySet<EnvironmentId> = new Set(),
  ) {
    const desiredIds = new Set(
      platformRegistrations.map((registration) => registration.target.environmentId),
    );
    const currentPlatformIds = yield* Ref.get(platformEnvironmentIds);
    yield* Effect.forEach(
      currentPlatformIds,
      (environmentId) =>
        desiredIds.has(environmentId) ? Effect.void : removePlatformEnvironment(environmentId),
      { discard: true },
    );
    // The new and changed environments join the catalog in one update: a host
    // that reports many at once (one per thread, in Aldo) otherwise changed the
    // catalog, and everything reading it, once per environment, which took
    // seconds for a few hundred.
    const currentEntries = yield* SubscriptionRef.get(entries);
    const currentScopes = yield* SubscriptionRef.get(serviceScopes);
    const persisted = yield* Ref.get(persistedTargetsByEnvironment);
    const runsUnchanged = (registration: PlatformConnectionRegistration) => {
      const environmentId = registration.target.environmentId;
      const installed = installedPlatform.get(environmentId);
      const entry = currentEntries.get(environmentId);
      const scope = currentScopes.get(environmentId);
      return (
        installed !== undefined &&
        installed.registration === registration &&
        entry === installed.entry &&
        // Running as installed, or dormant and still asleep.
        (scope === undefined
          ? reportedAsleep.has(environmentId)
          : Equal.equals(scope.entry, entry)) &&
        currentPlatformIds.has(environmentId) &&
        !persisted.has(environmentId)
      );
    };
    const batch: Array<ConnectionCatalogEntry> = [];
    const installed: Array<PlatformConnectionRegistration> = [];
    yield* Effect.forEach(
      platformRegistrations,
      (registration) =>
        runsUnchanged(registration)
          ? Effect.void
          : installPlatformRegistration(registration, batch).pipe(
              Effect.map((done) => {
                if (done) installed.push(registration);
              }),
            ),
      { discard: true },
    );
    // Dormant before they join the catalog, so what follows them from then on
    // shows them from their cache rather than starting them.
    asleep = new Set([...reportedAsleep].filter((environmentId) => desiredIds.has(environmentId)));
    yield* syncDormant;
    if (batch.length > 0) {
      yield* SubscriptionRef.update(entries, (current) => {
        const next = new Map(current);
        for (const entry of batch) next.set(entry.target.environmentId, entry);
        return next;
      });
      // Each runtime starts as installEntryLocked starts one, unless a stream
      // following the catalog has started it already, or it's asleep.
      yield* Effect.forEach(
        batch.filter((entry) => !asleep.has(entry.target.environmentId)),
        (entry) =>
          acquireSupervisor(entry.target.environmentId).pipe(
            Effect.catchTag("EnvironmentNotRegisteredError", () => Effect.void),
          ),
        { discard: true },
      );
    }
    const installedEntries = yield* SubscriptionRef.get(entries);
    for (const registration of installed) {
      const entry = installedEntries.get(registration.target.environmentId);
      if (entry !== undefined) {
        installedPlatform.set(registration.target.environmentId, { registration, entry });
      }
    }
  });

  const remove = Effect.fn("EnvironmentRegistry.remove")(function* (environmentId: EnvironmentId) {
    return yield* withLeaseLock(
      environmentId,
      Effect.gen(function* () {
        if ((yield* Ref.get(platformEnvironmentIds)).has(environmentId)) {
          return yield* new PlatformEnvironmentRemovalError({
            environmentId,
          });
        }
        const target = (yield* getEntry(environmentId)).target;
        const profile =
          target._tag === "BearerConnectionTarget" || target._tag === "SshConnectionTarget"
            ? yield* profiles.get(target.connectionId)
            : Option.none();

        yield* githubRoutingPermissions.forget(environmentId);
        yield* registrations.remove(target);
        yield* Ref.update(persistedTargetsByEnvironment, (current) => {
          const next = new Map(current);
          next.delete(environmentId);
          return next;
        });
        yield* closeServiceScope(environmentId);
        yield* SubscriptionRef.update(entries, (current) => {
          const next = new Map(current);
          next.delete(environmentId);
          return next;
        });
        yield* Effect.all(
          [
            cache.clear(environmentId).pipe(
              Effect.catch((error) =>
                Effect.logWarning("Could not clear cached environment data after removal.", {
                  environmentId,
                  error,
                }),
              ),
            ),
            ownedDataCleanup.clear(environmentId),
          ],
          { concurrency: "unbounded", discard: true },
        );

        if (
          target._tag === "SshConnectionTarget" &&
          Option.isSome(profile) &&
          isSshConnectionProfile(profile.value)
        ) {
          yield* ssh.disconnect(profile.value.target).pipe(
            Effect.tapError((error) =>
              Effect.logWarning("Could not disconnect the managed SSH environment.", {
                environmentId,
                error,
              }),
            ),
            Effect.ignore,
          );
        }
      }),
    );
  });

  const removeRelayEnvironments = Effect.fn("EnvironmentRegistry.removeRelayEnvironments")(
    function* () {
      const relayEnvironmentIds = [...(yield* SubscriptionRef.get(entries)).values()]
        .filter((entry) => entry.target._tag === "RelayConnectionTarget")
        .map((entry) => entry.target.environmentId);

      yield* Effect.forEach(
        relayEnvironmentIds,
        (environmentId) =>
          remove(environmentId).pipe(
            Effect.catchTag("EnvironmentNotRegisteredError", () => Effect.void),
          ),
        {
          concurrency: "unbounded",
          discard: true,
        },
      );
    },
  );

  const retryNow = (environmentId: EnvironmentId) =>
    acquireSupervisor(environmentId).pipe(
      Effect.flatMap((supervisor) => supervisor.retryNow),
      Effect.catchTag("EnvironmentNotRegisteredError", () => Effect.void),
      Effect.withSpan("EnvironmentRegistry.retryNow"),
    );
  const setEnabled = Effect.fn("EnvironmentRegistry.setEnabled")(function* (
    environmentId: EnvironmentId,
    enabled: boolean,
  ) {
    yield* withLeaseLock(
      environmentId,
      Effect.gen(function* () {
        const entry = yield* getEntry(environmentId);
        if (enabled && entry.unsupportedReason !== undefined) {
          return yield* new ConnectionBlockedError({
            reason: "unsupported",
            detail: entry.unsupportedReason,
          });
        }
        if (entry.enabled === enabled) {
          return;
        }
        // Platform-managed environments are reconciled from the host and are
        // never persisted, so only user-saved ones write the flag.
        if (!(yield* Ref.get(platformEnvironmentIds)).has(environmentId)) {
          yield* registrations.setEnabled(environmentId, enabled);
        }
        const next: ConnectionCatalogEntry = { ...entry, enabled };
        // Update the lease in place so the supervisor keeps its generation and
        // durable streams; `installEntryLocked` would tear it down instead.
        const lease = (yield* SubscriptionRef.get(serviceScopes)).get(environmentId);
        if (lease !== undefined) {
          yield* SubscriptionRef.update(serviceScopes, (current) => {
            const nextScopes = new Map(current);
            nextScopes.set(environmentId, { ...lease, entry: next });
            return nextScopes;
          });
        }
        yield* SubscriptionRef.update(entries, (current) => {
          const nextEntries = new Map(current);
          nextEntries.set(environmentId, next);
          return nextEntries;
        });
        if (lease !== undefined) {
          yield* enabled ? lease.supervisor.connect : lease.supervisor.disconnect;
        } else if (enabled) {
          yield* createServiceScope(next);
        }
        // The supervisor only owns the RPC session. A managed SSH backend and
        // its tunnel outlive it, so switching off tears those down as well.
        if (
          !enabled &&
          entry.target._tag === "SshConnectionTarget" &&
          Option.isSome(entry.profile) &&
          isSshConnectionProfile(entry.profile.value)
        ) {
          yield* ssh.disconnect(entry.profile.value.target).pipe(
            Effect.tapError((error) =>
              Effect.logWarning("Could not disconnect the switched-off SSH environment.", {
                environmentId,
                error,
              }),
            ),
            Effect.ignore,
          );
        }
      }),
    );
  });

  const state = Effect.fn("EnvironmentRegistry.state")(function* (environmentId: EnvironmentId) {
    const supervisor = yield* acquireSupervisor(environmentId);
    return yield* SubscriptionRef.get(supervisor.state);
  });
  const stateChanges = (environmentId: EnvironmentId) =>
    followStream(
      environmentId,
      Stream.unwrap(
        EnvironmentSupervisor.EnvironmentSupervisor.pipe(
          Effect.map((supervisor) => SubscriptionRef.changes(supervisor.state)),
        ),
      ),
    );

  yield* Effect.addFinalizer(() =>
    SubscriptionRef.get(serviceScopes).pipe(
      Effect.flatMap((current) =>
        Effect.forEach(current.values(), (lease) => Scope.close(lease.scope, Exit.void), {
          concurrency: "unbounded",
          discard: true,
        }),
      ),
    ),
  );
  yield* connectivity.changes.pipe(
    Stream.runForEach((status) => SubscriptionRef.set(networkStatus, status)),
    Effect.forkScoped,
  );

  const setCompatibility = Effect.fn("EnvironmentRegistry.setCompatibility")(function* (
    environmentId: EnvironmentId,
    error: ConnectionBlockedError | null,
  ) {
    yield* withLeaseLock(
      environmentId,
      Effect.gen(function* () {
        const entry = (yield* SubscriptionRef.get(entries)).get(environmentId);
        if (entry === undefined || entry.unsupportedReason === (error?.message ?? undefined))
          return;
        const { unsupportedReason: _previousReason, ...rest } = entry;
        const next: ConnectionCatalogEntry =
          error === null ? rest : { ...rest, enabled: false, unsupportedReason: error.message };
        if (
          error !== null &&
          entry.enabled &&
          !(yield* Ref.get(platformEnvironmentIds)).has(environmentId)
        ) {
          yield* registrations.setEnabled(environmentId, false);
        }
        const lease = (yield* SubscriptionRef.get(serviceScopes)).get(environmentId);
        if (lease !== undefined) {
          yield* SubscriptionRef.update(serviceScopes, (current) =>
            new Map(current).set(environmentId, { ...lease, entry: next }),
          );
          if (error !== null) yield* lease.supervisor.disconnect;
        }
        yield* SubscriptionRef.update(entries, (current) =>
          new Map(current).set(environmentId, next),
        );
      }),
    );
  });

  return EnvironmentRegistry.of({
    entries,
    networkStatus,
    dormant,
    start,
    register,
    registerPlatform,
    reconcilePlatform,
    remove,
    removeRelayEnvironments,
    retryNow,
    setEnabled,
    setCompatibility,
    state,
    stateChanges,
    run,
    runStream,
    followStream,
  });
});

export const layer = Layer.effect(EnvironmentRegistry, make);
