/**
 * MachineDirectory - where a hub finds each thread's machine and runner.
 *
 * The platform (not T3) creates, pauses, resumes and retires thread machines
 * and exposes each runner to the hub through an authenticated tunnel. The hub
 * asks the directory at `T3CODE_HUB_MACHINES_URL`:
 *
 *   POST /threads/{threadId}/machine          ensure; resume or recreate when `wake`
 *   GET  /threads/{threadId}/machine          current state; never wakes
 *   POST /threads/{threadId}/machine/idle     nothing on the hub needs the machine
 *   POST /threads/{threadId}/machine/release  the thread was archived or deleted
 *
 * The same base URL serves the platform's machine-free lookups:
 *
 *   GET    /repositories/refs?url=<repository>  branches (GitHub App repositories)
 *   GET    /provider-homes                      stored provider sign-ins (metadata)
 *   DELETE /provider-homes/{provider}           sign a provider out everywhere
 *
 * Implementations:
 * - `layerHttp`: the documented HTTP contract (production).
 * - `makeStaticMachineDirectory`: one runner at `T3CODE_RUNNER_URL` that is
 *   always running (local development against a single `t3 runner`).
 * - `makeFakeMachineDirectory`: scriptable states for tests.
 *
 * @module hub/MachineDirectory
 */
import type { ThreadId } from "@t3tools/contracts";
import {
  ProviderHomeDeleteResponse,
  type ProviderHomeId,
  ProviderHomesResponse,
  RepositoryRefsResponse,
  type ThreadMachineEnsureRequest,
  type ThreadMachineState,
  ThreadMachineStatus,
} from "@t3tools/contracts/runner";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import { ServerConfig } from "../config.ts";

export class MachineDirectoryError extends Schema.TaggedErrorClass<MachineDirectoryError>()(
  "MachineDirectoryError",
  {
    operation: Schema.String,
    /** Empty for requests that are not about one thread. */
    threadId: Schema.String,
    status: Schema.optional(Schema.Number),
    /** The platform's error code (`{ "error": "CODE" }`), when it sent one. */
    code: Schema.optional(Schema.String),
    detail: Schema.String,
  },
) {
  override get message(): string {
    const status = this.status === undefined ? "" : ` (HTTP ${this.status})`;
    const subject = this.threadId === "" ? "" : ` for thread ${this.threadId}`;
    return `Machine directory ${this.operation} failed${subject}${status}: ${this.detail}`;
  }
}

const decodeErrorBody = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      error: Schema.optional(Schema.Unknown),
      code: Schema.optional(Schema.Unknown),
    }),
  ),
);

/** The platform's `{ "error": "CODE" }` (or `code`) from an error body, if any. */
const errorCodeOf = (body: string): string | undefined => {
  const parsed = decodeErrorBody(body);
  if (Option.isNone(parsed)) return undefined;
  const code = parsed.value.error ?? parsed.value.code;
  return typeof code === "string" && code.length > 0 ? code : undefined;
};

const isMachineDirectoryError = Schema.is(MachineDirectoryError);

export interface MachineDirectoryShape {
  /** Ensures a machine exists; resumes or recreates it when `request.wake`. */
  readonly ensure: (
    threadId: ThreadId,
    request: ThreadMachineEnsureRequest,
  ) => Effect.Effect<ThreadMachineStatus, MachineDirectoryError>;
  /** Reports the machine's state without waking it. */
  readonly status: (
    threadId: ThreadId,
  ) => Effect.Effect<ThreadMachineStatus, MachineDirectoryError>;
  /** Tells the platform no session or turn on the hub needs the machine. */
  readonly idle: (threadId: ThreadId) => Effect.Effect<void, MachineDirectoryError>;
  /** Retires the machine; the thread was archived or deleted. */
  readonly release: (threadId: ThreadId) => Effect.Effect<void, MachineDirectoryError>;
  /** A repository's branches, without any machine. */
  readonly repositoryRefs: (
    url: string,
  ) => Effect.Effect<RepositoryRefsResponse, MachineDirectoryError>;
  /** Stored provider sign-ins (versions only). */
  readonly providerHomes: Effect.Effect<ProviderHomesResponse, MachineDirectoryError>;
  /** Deletes a provider's stored sign-in; running machines sign out within seconds. */
  readonly deleteProviderHome: (
    provider: ProviderHomeId,
  ) => Effect.Effect<ProviderHomeDeleteResponse, MachineDirectoryError>;
}

export class MachineDirectory extends Context.Service<MachineDirectory, MachineDirectoryShape>()(
  "t3/hub/MachineDirectory",
) {}

const DEFAULT_REQUEST_TIMEOUT = Duration.seconds(30);

export const makeHttpMachineDirectory = (options: {
  readonly baseUrl: string;
  readonly token: string;
  readonly requestTimeout?: Duration.Input;
}) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const base = options.baseUrl.replace(/\/+$/, "");
    const timeout = options.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT;
    const url = (threadId: ThreadId, suffix = "") =>
      `${base}/threads/${encodeURIComponent(threadId)}/machine${suffix}`;

    const toDirectoryError = (operation: string, threadId: ThreadId | "") => (cause: unknown) =>
      isMachineDirectoryError(cause)
        ? cause
        : new MachineDirectoryError({
            operation,
            threadId,
            detail:
              cause && typeof cause === "object" && "message" in cause
                ? String((cause as { readonly message: unknown }).message)
                : String(cause),
          });

    const send = <A, E1, E2>(
      operation: string,
      threadId: ThreadId | "",
      request: Effect.Effect<HttpClientRequest.HttpClientRequest, E1>,
      decode: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<A, E2>,
    ): Effect.Effect<A, MachineDirectoryError> =>
      Effect.gen(function* () {
        const response = yield* request.pipe(
          Effect.map(HttpClientRequest.bearerToken(options.token)),
          Effect.flatMap(client.execute),
          Effect.mapError(toDirectoryError(operation, threadId)),
        );
        if (response.status < 200 || response.status >= 300) {
          const body = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
          const code = errorCodeOf(body);
          return yield* new MachineDirectoryError({
            operation,
            threadId,
            status: response.status,
            ...(code !== undefined ? { code } : {}),
            detail: body.slice(0, 500) || "request failed",
          });
        }
        return yield* decode(response).pipe(Effect.mapError(toDirectoryError(operation, threadId)));
      }).pipe(
        Effect.timeoutOrElse({
          duration: timeout,
          orElse: () =>
            Effect.fail(
              new MachineDirectoryError({
                operation,
                threadId,
                detail: `no response within ${Duration.format(Duration.fromInputUnsafe(timeout))}`,
              }),
            ),
        }),
      );

    const decodeStatus = HttpClientResponse.schemaBodyJson(ThreadMachineStatus);

    return MachineDirectory.of({
      ensure: (threadId, request) =>
        send(
          "ensure",
          threadId,
          HttpClientRequest.post(url(threadId)).pipe(HttpClientRequest.bodyJson(request)),
          decodeStatus,
        ),
      status: (threadId) =>
        send(
          "status",
          threadId,
          Effect.succeed(HttpClientRequest.get(url(threadId))),
          decodeStatus,
        ),
      idle: (threadId) =>
        send(
          "idle",
          threadId,
          HttpClientRequest.post(url(threadId, "/idle")).pipe(HttpClientRequest.bodyJson({})),
          () => Effect.void,
        ),
      release: (threadId) =>
        send(
          "release",
          threadId,
          HttpClientRequest.post(url(threadId, "/release")).pipe(HttpClientRequest.bodyJson({})),
          () => Effect.void,
        ),
      repositoryRefs: (repositoryUrl) =>
        send(
          "repositoryRefs",
          "",
          Effect.succeed(
            HttpClientRequest.get(
              `${base}/repositories/refs?url=${encodeURIComponent(repositoryUrl)}`,
            ),
          ),
          HttpClientResponse.schemaBodyJson(RepositoryRefsResponse),
        ),
      providerHomes: send(
        "providerHomes",
        "",
        Effect.succeed(HttpClientRequest.get(`${base}/provider-homes`)),
        HttpClientResponse.schemaBodyJson(ProviderHomesResponse),
      ),
      deleteProviderHome: (provider) =>
        send(
          "deleteProviderHome",
          "",
          Effect.succeed(
            HttpClientRequest.delete(`${base}/provider-homes/${encodeURIComponent(provider)}`),
          ),
          HttpClientResponse.schemaBodyJson(ProviderHomeDeleteResponse),
        ),
    });
  });

/**
 * Development directory: every thread resolves to one always-running runner.
 * A runner serves exactly one thread, so other threads fail its handshake with
 * a typed error rather than sharing its checkout.
 */
export const makeStaticMachineDirectory = (options: {
  readonly runnerUrl: string;
  readonly runnerToken: string | undefined;
}) =>
  MachineDirectory.of({
    ensure: () => Effect.succeed(staticStatus(options)),
    status: () => Effect.succeed(staticStatus(options)),
    idle: () => Effect.void,
    release: () => Effect.void,
    repositoryRefs: () =>
      Effect.fail(
        new MachineDirectoryError({
          operation: "repositoryRefs",
          threadId: "",
          detail: "The development runner directory has no platform to list repository refs.",
        }),
      ),
    providerHomes: Effect.succeed({ providers: [] }),
    deleteProviderHome: (provider) => Effect.succeed({ provider, deleted: false }),
  });

const staticStatus = (options: {
  readonly runnerUrl: string;
  readonly runnerToken: string | undefined;
}): ThreadMachineStatus => ({
  state: "running",
  // The static runner's token is optional in development; the protocol
  // endpoint is open when the runner has none.
  runner: { url: options.runnerUrl, token: options.runnerToken ?? "development" },
  bootId: null,
  detail: "static development runner",
});

export interface FakeMachine {
  readonly state: ThreadMachineState;
  readonly runnerUrl?: string;
  readonly runnerToken?: string;
  readonly bootId?: string | null;
  readonly detail?: string;
}

export interface FakeMachineDirectoryCall {
  readonly method: "ensure" | "status" | "idle" | "release";
  readonly threadId: ThreadId;
  readonly wake?: boolean;
}

/** A fake repository listing, or the platform error it answers with. */
export type FakeRepositoryRefs =
  | RepositoryRefsResponse
  | { readonly status: number; readonly code: string };

/**
 * Scriptable directory for tests. `onWake` decides what an ensure-with-wake
 * does to a machine (by default it becomes `running`). `repositories` answers
 * repository ref listings by URL; provider homes start empty and change with
 * `setProviderHome` and `deleteProviderHome`.
 */
export const makeFakeMachineDirectory = (options?: {
  readonly initial?: ReadonlyArray<readonly [ThreadId, FakeMachine]>;
  readonly onWake?: (threadId: ThreadId, machine: FakeMachine | undefined) => FakeMachine;
  readonly repositories?: Readonly<Record<string, FakeRepositoryRefs>>;
}) =>
  Effect.gen(function* () {
    const machines = yield* Ref.make(new Map(options?.initial ?? []));
    const calls = yield* Ref.make<ReadonlyArray<FakeMachineDirectoryCall>>([]);
    const platformCalls = yield* Ref.make<ReadonlyArray<string>>([]);
    const providerHomes = yield* Ref.make(new Map<string, number>());
    const recordPlatform = (call: string) =>
      Ref.update(platformCalls, (current) => [...current, call]);
    const record = (call: FakeMachineDirectoryCall) =>
      Ref.update(calls, (current) => [...current, call]);
    const toStatus = (machine: FakeMachine | undefined): ThreadMachineStatus =>
      machine === undefined
        ? { state: "none", runner: null, bootId: null, detail: null }
        : {
            state: machine.state,
            runner:
              machine.state === "running" && machine.runnerUrl
                ? { url: machine.runnerUrl, token: machine.runnerToken ?? "test-token" }
                : null,
            bootId: machine.bootId ?? null,
            detail: machine.detail ?? null,
          };
    const directory = MachineDirectory.of({
      ensure: (threadId, request) =>
        Effect.gen(function* () {
          yield* record({ method: "ensure", threadId, wake: request.wake });
          const current = (yield* Ref.get(machines)).get(threadId);
          if (!request.wake) return toStatus(current);
          const next =
            options?.onWake?.(threadId, current) ??
            ({ ...current, state: "running" } satisfies FakeMachine);
          yield* Ref.update(machines, (map) => new Map(map).set(threadId, next));
          return toStatus(next);
        }),
      status: (threadId) =>
        record({ method: "status", threadId }).pipe(
          Effect.andThen(Ref.get(machines)),
          Effect.map((map) => toStatus(map.get(threadId))),
        ),
      idle: (threadId) => record({ method: "idle", threadId }),
      release: (threadId) =>
        record({ method: "release", threadId }).pipe(
          Effect.andThen(
            Ref.update(machines, (map) => {
              const next = new Map(map);
              next.delete(threadId);
              return next;
            }),
          ),
        ),
      repositoryRefs: (url) =>
        Effect.gen(function* () {
          yield* recordPlatform(`repositoryRefs ${url}`);
          const answer = options?.repositories?.[url];
          if (answer === undefined) {
            return yield* new MachineDirectoryError({
              operation: "repositoryRefs",
              threadId: "",
              status: 404,
              code: "REPOSITORY_NOT_FOUND",
              detail: `{"error":"REPOSITORY_NOT_FOUND"}`,
            });
          }
          if ("status" in answer) {
            return yield* new MachineDirectoryError({
              operation: "repositoryRefs",
              threadId: "",
              status: answer.status,
              code: answer.code,
              detail: `{"error":"${answer.code}"}`,
            });
          }
          return answer;
        }),
      providerHomes: recordPlatform("providerHomes").pipe(
        Effect.andThen(Ref.get(providerHomes)),
        Effect.map((homes) => ({
          providers: [...homes].map(([provider, version]) => ({
            provider,
            version,
            updatedAt: null,
          })),
        })),
      ),
      deleteProviderHome: (provider) =>
        recordPlatform(`deleteProviderHome ${provider}`).pipe(
          Effect.andThen(
            Ref.modify(providerHomes, (homes) => {
              const next = new Map(homes);
              const deleted = next.delete(provider);
              return [{ provider, deleted }, next] as const;
            }),
          ),
        ),
    });
    return {
      directory,
      calls: Ref.get(calls),
      platformCalls: Ref.get(platformCalls),
      setProviderHome: (provider: string, version: number) =>
        Ref.update(providerHomes, (homes) => new Map(homes).set(provider, version)),
      set: (threadId: ThreadId, machine: FakeMachine) =>
        Ref.update(machines, (map) => new Map(map).set(threadId, machine)),
      get: (threadId: ThreadId) => Ref.get(machines).pipe(Effect.map((map) => map.get(threadId))),
    };
  });

/**
 * The configured directory: HTTP when `T3CODE_HUB_MACHINES_URL` is set, else
 * the static development runner at `T3CODE_RUNNER_URL`.
 */
export const layer = Layer.effect(
  MachineDirectory,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    if (config.hub?.machinesUrl && config.hub.machinesToken) {
      return yield* makeHttpMachineDirectory({
        baseUrl: config.hub.machinesUrl,
        token: config.hub.machinesToken,
      });
    }
    if (config.runnerUrl) {
      return makeStaticMachineDirectory({
        runnerUrl: config.runnerUrl,
        runnerToken: config.runnerToken,
      });
    }
    return yield* Effect.die(
      new Error(
        "Hub mode requires T3CODE_HUB_MACHINES_URL and T3CODE_HUB_MACHINES_TOKEN, or T3CODE_RUNNER_URL for development.",
      ),
    );
  }),
);
