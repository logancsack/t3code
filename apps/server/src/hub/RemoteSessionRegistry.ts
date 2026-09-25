/**
 * RemoteSessionRegistry - the hub's answer to "does this thread have a
 * provider session?" without asking (or waking) a machine.
 *
 * A session started on a thread's runner stays live on that machine while it
 * is paused or saved; the hub treats it as resumable. The registry records
 * every remote session the hub started, the runner boot that hosts it, and
 * its active turn, updated from the delivered event stream. After a hub
 * restart it is seeded from the persisted session directory rows that were
 * still active, with the boot the hub last reconciled.
 *
 * A session disappears only when its runner reports it exited, the hub stops
 * it, or boot reconciliation finds the runner restarted without it.
 *
 * @module hub/RemoteSessionRegistry
 */
import {
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type RuntimeMode,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { RunnerCursorStore } from "../persistence/Services/HubThreadMachineState.ts";
import {
  ProviderSessionRuntimeRepository,
  type ProviderSessionRuntime,
} from "../persistence/ProviderSessionRuntime.ts";

export interface RemoteSessionRecord {
  readonly threadId: ThreadId;
  readonly instanceId: ProviderInstanceId;
  readonly provider: ProviderDriverKind;
  readonly session: ProviderSession;
  /** Runner boot hosting the session; null when unknown (seeded without a cursor). */
  readonly bootId: string | null;
}

export interface RemoteSessionRegistryShape {
  readonly get: (threadId: ThreadId) => Effect.Effect<Option.Option<RemoteSessionRecord>>;
  readonly listForInstance: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ReadonlyArray<RemoteSessionRecord>>;
  readonly list: Effect.Effect<ReadonlyArray<RemoteSessionRecord>>;
  readonly upsert: (record: RemoteSessionRecord) => Effect.Effect<void>;
  readonly remove: (threadId: ThreadId) => Effect.Effect<void>;
  /** Tracks status and active turn from a delivered runtime event. */
  readonly applyEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  /** Marks every session of a thread as hosted by `bootId`. */
  readonly adoptBoot: (threadId: ThreadId, bootId: string) => Effect.Effect<void>;
}

export class RemoteSessionRegistry extends Context.Service<
  RemoteSessionRegistry,
  RemoteSessionRegistryShape
>()("t3/hub/RemoteSessionRegistry") {}

const readPayloadString = (payload: unknown, key: string): string | undefined => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
};

/** Rebuilds the live-session view of a persisted, still-active binding. */
export const sessionFromRuntimeRow = (row: ProviderSessionRuntime): ProviderSession | null => {
  if (row.providerInstanceId === null) return null;
  if (row.status !== "starting" && row.status !== "running") return null;
  const cwd = readPayloadString(row.runtimePayload, "cwd");
  const model = readPayloadString(row.runtimePayload, "model");
  const activeTurnId = readPayloadString(row.runtimePayload, "activeTurnId");
  return {
    provider: row.providerName as ProviderDriverKind,
    providerInstanceId: row.providerInstanceId,
    status: activeTurnId ? "running" : row.status === "starting" ? "connecting" : "ready",
    runtimeMode: row.runtimeMode as RuntimeMode,
    ...(cwd ? { cwd } : {}),
    ...(model ? { model } : {}),
    threadId: row.threadId,
    ...(row.resumeCursor !== null ? { resumeCursor: row.resumeCursor } : {}),
    ...(activeTurnId ? { activeTurnId: TurnId.make(activeTurnId) } : {}),
    createdAt: row.lastSeenAt,
    updatedAt: row.lastSeenAt,
  };
};

export const make = Effect.gen(function* () {
  const runtimeRows = yield* ProviderSessionRuntimeRepository;
  const cursors = yield* RunnerCursorStore;
  const records = new Map<ThreadId, RemoteSessionRecord>();

  const seed = yield* Effect.cached(
    Effect.gen(function* () {
      const rows = yield* runtimeRows.list();
      const bootByThread = new Map(
        (yield* cursors.list()).map((cursor) => [cursor.threadId, cursor.bootId] as const),
      );
      for (const row of rows) {
        const session = sessionFromRuntimeRow(row);
        if (!session || !session.providerInstanceId || records.has(row.threadId)) continue;
        records.set(row.threadId, {
          threadId: row.threadId,
          instanceId: session.providerInstanceId,
          provider: session.provider,
          session,
          bootId: bootByThread.get(row.threadId) ?? null,
        });
      }
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("remote session registry could not read persisted sessions", {
          cause: String(cause).slice(0, 400),
        }),
      ),
    ),
  );

  const update = (threadId: ThreadId, f: (record: RemoteSessionRecord) => RemoteSessionRecord) =>
    Effect.sync(() => {
      const current = records.get(threadId);
      if (current) records.set(threadId, f(current));
    });

  return RemoteSessionRegistry.of({
    get: (threadId) => seed.pipe(Effect.map(() => Option.fromNullishOr(records.get(threadId)))),
    listForInstance: (instanceId) =>
      seed.pipe(
        Effect.map(() =>
          [...records.values()].filter((record) => record.instanceId === instanceId),
        ),
      ),
    list: seed.pipe(Effect.map(() => [...records.values()])),
    upsert: (record) =>
      seed.pipe(
        Effect.andThen(
          Effect.sync(() => {
            records.set(record.threadId, record);
          }),
        ),
      ),
    remove: (threadId) =>
      seed.pipe(
        Effect.andThen(
          Effect.sync(() => {
            records.delete(threadId);
          }),
        ),
      ),
    applyEvent: (event) =>
      seed.pipe(
        Effect.andThen(() => {
          switch (event.type) {
            case "session.exited":
              return Effect.sync(() => {
                const current = records.get(event.threadId);
                if (current && current.instanceId === event.providerInstanceId) {
                  records.delete(event.threadId);
                }
              });
            case "turn.started":
              return update(event.threadId, (record) => ({
                ...record,
                session: {
                  ...record.session,
                  status: "running",
                  ...(event.turnId ? { activeTurnId: event.turnId } : {}),
                  updatedAt: event.createdAt,
                },
              }));
            case "turn.completed":
            case "turn.aborted":
              return update(event.threadId, (record) => {
                const { activeTurnId: _activeTurnId, ...session } = record.session;
                return {
                  ...record,
                  session: { ...session, status: "ready", updatedAt: event.createdAt },
                };
              });
            default:
              return Effect.void;
          }
        }),
      ),
    adoptBoot: (threadId, bootId) => update(threadId, (record) => ({ ...record, bootId })),
  });
});

export const layer = Layer.effect(RemoteSessionRegistry, make);
