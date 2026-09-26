/**
 * HubProviderSignIn - subscription sign-in when the server is a hub.
 *
 * A hub runs no provider CLI. Starting a provider sign-in in Settings runs the
 * provider's own login command, through T3's unchanged auth connector, on the
 * machine of the reserved thread `aldo-provider-sign-in` (a blank project, no
 * repository, checkout `/workspace/t/aldo-provider-sign-in`):
 *
 * 1. `start` answers at once with a session that is starting a machine; a
 *    background fiber records the provider's stored sign-in version, ensures
 *    and wakes the sign-in machine, pushes the instance's settings, and
 *    starts the connector there (`runner.auth.start`). The session mirrors the
 *    runner's session (prompts, URLs, codes, fields) as it progresses;
 *    `submit` and `cancel` are forwarded. Flows that finish in a browser on the
 *    machine carry `workspaceBrowserUrl`.
 * 2. When the login command succeeds, the session stays `verifying` until the
 *    platform lists the provider's stored sign-in at a higher version (the
 *    machine's supervisor uploads the CLI's files within about 20 s), then
 *    succeeds; the instance's provider status is refreshed on the machine.
 * 3. Once no sign-in is active the sign-in machine is reported idle. Agent
 *    sessions never run on it (the remote provider driver refuses them).
 *
 * Sign-out deletes the stored sign-in (`DELETE provider-homes/{provider}`);
 * running machines drop the provider's files within about 15 s.
 *
 * @module hub/HubProviderSignIn
 */
import {
  AuthConnectorError,
  type AuthConnectorKind,
  type AuthConnectorSession,
  type AuthConnectorStartInput,
  defaultInstanceIdForDriver,
  ProjectId,
  PROVIDER_SIGN_IN_THREAD_ID,
  ProviderDriverKind,
  type ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import {
  type ProviderHomeId,
  RUNNER_PROTOCOL_PROVIDER_SETTINGS,
  ThreadMachineUnavailableError,
} from "@t3tools/contracts/runner";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { authConnectorFlow } from "../authConnector/AuthConnectorManager.ts";
import { ServerConfig } from "../config.ts";
import { ProviderSignInControls, type ProviderSignInControlsShape } from "../serverModeHooks.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { HubProviderSnapshots } from "./HubProviderSnapshots.ts";
import { MachineDirectory } from "./MachineDirectory.ts";
import { effectiveInstanceSettings } from "./RemoteProviderDriver.ts";
import {
  RunnerConnectionPool,
  type RunnerConnection,
  type ThreadMachineContext,
} from "./RunnerConnectionPool.ts";

export const SIGN_IN_THREAD_ID = ThreadId.make(PROVIDER_SIGN_IN_THREAD_ID);
const SIGN_IN_CONTEXT: ThreadMachineContext = {
  projectId: ProjectId.make(PROVIDER_SIGN_IN_THREAD_ID),
  repository: null,
  branch: null,
  providerInstanceId: null,
};
export const DEFAULT_THREAD_BROWSER_URL_TEMPLATE = "/_devpc/threads/{threadId}/browser";

/** Provider connectors whose sign-in is stored for thread machines, and their drivers. */
const PROVIDER_CONNECTORS: Partial<
  Record<AuthConnectorKind, { readonly home: ProviderHomeId; readonly driver: string }>
> = {
  claude: { home: "claude", driver: "claudeAgent" },
  codex: { home: "codex", driver: "codex" },
  opencode: { home: "opencode", driver: "opencode" },
  grok: { home: "grok", driver: "grok" },
  cursor: { home: "cursor", driver: "cursor" },
  "prime-agent": { home: "prime", driver: "primeAgent" },
  muse: { home: "muse", driver: "muse" },
};

const connectorForHome = (home: string): AuthConnectorKind | undefined =>
  (
    Object.entries(PROVIDER_CONNECTORS) as ReadonlyArray<
      readonly [AuthConnectorKind, { readonly home: ProviderHomeId }]
    >
  ).find(([, entry]) => entry.home === home)?.[0];

const SESSION_TTL_MINUTES = 15;
const TERMINAL_RETENTION = Duration.minutes(5);

export interface HubProviderSignInOptions {
  /** How often the runner's session is read while it is active. */
  readonly pollInterval?: Duration.Input;
  /** How often stored sign-ins are listed while waiting for the upload. */
  readonly storePollInterval?: Duration.Input;
  /** How long to wait for the stored sign-in after the login succeeded. */
  readonly storeTimeout?: Duration.Input;
}

interface HubSignInSession {
  snapshot: AuthConnectorSession;
  runnerSessionId: string | null;
  fiber: Fiber.Fiber<void> | null;
  terminal: boolean;
}

const isThreadMachineUnavailable = Schema.is(ThreadMachineUnavailableError);
const isAuthConnectorError = Schema.is(AuthConnectorError);

const describe = (cause: unknown): string =>
  cause && typeof cause === "object" && "message" in cause
    ? String((cause as { readonly message: unknown }).message)
    : String(cause);

const failure = (operation: string, detail: string) =>
  new AuthConnectorError({ operation, detail });

export const make = (options: HubProviderSignInOptions = {}) =>
  Effect.gen(function* () {
    const pool = yield* RunnerConnectionPool;
    const directory = yield* MachineDirectory;
    const snapshots = yield* HubProviderSnapshots;
    const serverSettings = yield* ServerSettingsService;
    const config = yield* ServerConfig;
    const crypto = yield* Crypto.Crypto;
    const scope = yield* Effect.scope;
    const pollInterval = Duration.fromInputUnsafe(options.pollInterval ?? "1 second");
    const storePollInterval = Duration.fromInputUnsafe(options.storePollInterval ?? "2 seconds");
    const storeTimeout = Duration.fromInputUnsafe(options.storeTimeout ?? "2 minutes");
    const browserUrl = (
      config.hub?.threadBrowserUrlTemplate ?? DEFAULT_THREAD_BROWSER_URL_TEMPLATE
    ).replaceAll("{threadId}", encodeURIComponent(PROVIDER_SIGN_IN_THREAD_ID));

    const sessions = new Map<string, HubSignInSession>();

    const update = (session: HubSignInSession, patch: Partial<AuthConnectorSession>) => {
      session.snapshot = { ...session.snapshot, ...patch };
    };

    /** The hub's view of a runner session: the hub's id, and the machine's browser when needed. */
    const mirror = (session: HubSignInSession, remote: AuthConnectorSession) => {
      session.snapshot = {
        ...remote,
        id: session.snapshot.id,
        workspaceBrowserUrl: remote.flow === "browser" ? browserUrl : null,
      };
    };

    const fail = (session: HubSignInSession, message: string) =>
      update(session, {
        status: "failed",
        stage: "error",
        fields: [],
        verificationUrl: null,
        userCode: null,
        message,
      });

    const storedVersion = (home: ProviderHomeId) =>
      directory.providerHomes.pipe(
        Effect.map(
          (homes) => homes.providers.find((entry) => entry.provider === home)?.version ?? 0,
        ),
      );

    /** A call on the sign-in machine's runner; never wakes it. */
    const onSignInRunner = <A, E>(
      operation: string,
      f: (connection: RunnerConnection) => Effect.Effect<A, E>,
    ) => pool.use(SIGN_IN_THREAD_ID, { wake: false, operation: `auth.${operation}` }, f);

    const activeCount = () => [...sessions.values()].filter((session) => !session.terminal).length;

    /** Ends a session; the machine is reported idle once no sign-in is active. */
    const finish = (id: string, session: HubSignInSession) =>
      Effect.gen(function* () {
        if (session.terminal) return;
        session.terminal = true;
        yield* pool.setBusy(SIGN_IN_THREAD_ID, `sign-in:${id}`, false);
        if (activeCount() === 0) yield* pool.idle(SIGN_IN_THREAD_ID);
        yield* Effect.sleep(TERMINAL_RETENTION).pipe(
          Effect.andThen(Effect.sync(() => sessions.delete(id))),
          Effect.forkIn(scope),
        );
      });

    /** After a successful login: read the provider's status again on the machine. */
    const refreshProviderStatus = (instanceId: ProviderInstanceId, driver: string) =>
      onSignInRunner("refreshStatus", (connection) =>
        connection.client["runner.provider.getCapabilities"]({ instanceId, refresh: true }),
      ).pipe(
        Effect.flatMap((result) => snapshots.put({ ...result.snapshot, instanceId })),
        Effect.catchCause(() =>
          markAuthUnknown(driver, "Signed in; checked when a thread machine starts."),
        ),
      );

    const markAuthUnknown = (driver: string, message: string) =>
      Effect.gen(function* () {
        for (const snapshot of yield* snapshots.all) {
          if (snapshot.driver !== driver) continue;
          yield* snapshots.put({ ...snapshot, auth: { status: "unknown" }, message });
        }
      });

    const run = (
      id: string,
      session: HubSignInSession,
      input: AuthConnectorStartInput,
      provider: { readonly home: ProviderHomeId; readonly driver: string },
      instanceId: ProviderInstanceId,
    ) =>
      Effect.gen(function* () {
        const baseline = yield* storedVersion(provider.home);
        const started = yield* pool.use(
          SIGN_IN_THREAD_ID,
          { wake: true, operation: "auth.start", context: SIGN_IN_CONTEXT },
          (connection) =>
            Effect.gen(function* () {
              if (connection.hello.protocolVersion < RUNNER_PROTOCOL_PROVIDER_SETTINGS) {
                return yield* failure(
                  "start",
                  "The sign-in machine runs a runner too old for provider sign-in.",
                );
              }
              const settings = yield* effectiveInstanceSettings(serverSettings, instanceId).pipe(
                Effect.orElseSucceed(() => undefined),
              );
              if (settings !== undefined) {
                yield* connection.client["runner.provider.configure"]({
                  instances: { [instanceId]: settings },
                }).pipe(Effect.ignore);
              }
              return yield* connection.client["runner.auth.start"](input);
            }),
        );
        session.runnerSessionId = started.id;
        mirror(session, started);

        let current = started;
        while (current.status === "starting" || current.status === "waiting") {
          yield* Effect.sleep(pollInterval);
          current = yield* onSignInRunner("get", (connection) =>
            connection.client["runner.auth.get"]({ sessionId: started.id }),
          );
          if (current.status !== "succeeded") mirror(session, current);
        }
        if (current.status !== "succeeded") return;

        update(session, {
          status: "starting",
          stage: "verifying",
          fields: [],
          message: "Saving your sign-in…",
        });
        const deadline = (yield* Clock.currentTimeMillis) + Duration.toMillis(storeTimeout);
        while ((yield* storedVersion(provider.home)) <= baseline) {
          if ((yield* Clock.currentTimeMillis) >= deadline) {
            return fail(
              session,
              "The sign-in finished on the machine but was not saved. Try again.",
            );
          }
          yield* Effect.sleep(storePollInterval);
        }
        yield* refreshProviderStatus(instanceId, provider.driver);
        mirror(session, current);
        update(session, { stage: "complete", message: "Signed in." });
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() =>
            fail(
              session,
              isAuthConnectorError(error)
                ? error.detail
                : isThreadMachineUnavailable(error)
                  ? `The sign-in machine is unavailable: ${error.detail}`
                  : `Sign-in failed: ${describe(error)}`,
            ),
          ),
        ),
        Effect.ensuring(Effect.suspend(() => finish(id, session))),
      );

    const sessionOf = (
      operation: string,
      sessionId: string,
    ): Effect.Effect<HubSignInSession, AuthConnectorError> => {
      const session = sessions.get(sessionId);
      return session
        ? Effect.succeed(session)
        : Effect.fail(failure(operation, "This connection attempt no longer exists. Start again."));
    };

    const start: ProviderSignInControlsShape["start"] = (input) =>
      Effect.gen(function* () {
        const provider = PROVIDER_CONNECTORS[input.connector];
        if (provider === undefined) {
          return yield* failure(
            "start",
            "This sign-in is not available here yet; thread machines store provider sign-ins only.",
          );
        }
        const id = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
        const now = yield* DateTime.now;
        const session: HubSignInSession = {
          snapshot: {
            id,
            connector: input.connector,
            method: input.method,
            status: "starting",
            flow: authConnectorFlow(input),
            stage: "preparing",
            message: "Starting a machine for sign-in…",
            verificationUrl: null,
            userCode: null,
            fields: [],
            expiresAt: DateTime.formatIso(DateTime.add(now, { minutes: SESSION_TTL_MINUTES })),
            workspaceBrowserUrl: null,
          },
          runnerSessionId: null,
          fiber: null,
          terminal: false,
        };
        sessions.set(id, session);
        yield* pool.setBusy(SIGN_IN_THREAD_ID, `sign-in:${id}`, true);
        const instanceId =
          input.providerInstanceId ??
          defaultInstanceIdForDriver(ProviderDriverKind.make(provider.driver));
        session.fiber = yield* run(id, session, input, provider, instanceId).pipe(
          Effect.forkIn(scope),
        );
        return session.snapshot;
      });

    const submit: ProviderSignInControlsShape["submit"] = (input) =>
      Effect.gen(function* () {
        const session = yield* sessionOf("submit", input.sessionId);
        if (session.runnerSessionId === null || session.snapshot.status !== "waiting") {
          return yield* failure("submit", "This connection attempt is not waiting for input.");
        }
        const runnerSessionId = session.runnerSessionId;
        const next = yield* onSignInRunner("submit", (connection) =>
          connection.client["runner.auth.submit"]({ ...input, sessionId: runnerSessionId }),
        ).pipe(
          Effect.mapError((error) =>
            isAuthConnectorError(error)
              ? error
              : failure("submit", "The sign-in machine is no longer running. Start again."),
          ),
        );
        if (next.status !== "succeeded") mirror(session, next);
        return session.snapshot;
      });

    const cancel: ProviderSignInControlsShape["cancel"] = (sessionId) =>
      Effect.gen(function* () {
        const session = yield* sessionOf("cancel", sessionId);
        if (session.terminal) return session.snapshot;
        const runnerSessionId = session.runnerSessionId;
        if (runnerSessionId !== null) {
          yield* onSignInRunner("cancel", (connection) =>
            connection.client["runner.auth.cancel"]({ sessionId: runnerSessionId }),
          ).pipe(Effect.ignore);
        }
        if (session.fiber) yield* Fiber.interrupt(session.fiber);
        update(session, {
          status: "cancelled",
          stage: "error",
          fields: [],
          verificationUrl: null,
          userCode: null,
          message: "Connection cancelled.",
        });
        yield* finish(sessionId, session);
        return session.snapshot;
      });

    const directoryFailure = (operation: string) => (error: { readonly message: string }) =>
      failure(operation, `Stored provider sign-ins are unavailable: ${error.message}`);

    return {
      start,
      get: (sessionId) =>
        sessionOf("get", sessionId).pipe(Effect.map((session) => session.snapshot)),
      submit,
      cancel,
      list: directory.providerHomes.pipe(
        Effect.map((homes) => ({
          signIns: homes.providers.flatMap((entry) => {
            const connector = connectorForHome(entry.provider);
            return connector === undefined
              ? []
              : [{ connector, version: entry.version, updatedAt: entry.updatedAt ?? null }];
          }),
        })),
        Effect.mapError(directoryFailure("listProviderSignIns")),
      ),
      signOut: ({ connector }) =>
        Effect.gen(function* () {
          const provider = PROVIDER_CONNECTORS[connector];
          if (provider === undefined) {
            return yield* failure("signOutProvider", "This provider has no stored sign-in.");
          }
          const result = yield* directory
            .deleteProviderHome(provider.home)
            .pipe(Effect.mapError(directoryFailure("signOutProvider")));
          yield* markAuthUnknown(
            provider.driver,
            "Signed out; checked when a thread machine starts.",
          );
          return { connector, signedOut: result.deleted };
        }),
    } satisfies ProviderSignInControlsShape;
  });

export const layer = Layer.effect(ProviderSignInControls, make());
