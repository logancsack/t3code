import { it } from "@effect/vitest";
import {
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { describe, expect } from "vite-plus/test";

import { HubThreadMachineStateSqliteLive } from "../persistence/Layers/HubThreadMachineState.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as ProviderSessionRuntime from "../persistence/ProviderSessionRuntime.ts";
import { RunnerCursorStore } from "../persistence/Services/HubThreadMachineState.ts";
import { make as makeRegistry } from "./RemoteSessionRegistry.ts";

const threadId = ThreadId.make("thread-registry");
const provider = ProviderDriverKind.make("claudeAgent");
const instanceId = ProviderInstanceId.make("claudeAgent");

const TestLayer = Layer.mergeAll(
  HubThreadMachineStateSqliteLive,
  ProviderSessionRuntime.layer,
).pipe(Layer.provideMerge(SqlitePersistenceMemory));

const lifecycleEvent = (
  type: "turn.started" | "turn.completed" | "session.exited",
  createdAt: string,
): ProviderRuntimeEvent =>
  ({
    type,
    eventId: EventId.make(`${type}-${createdAt}`),
    provider,
    providerInstanceId: instanceId,
    threadId,
    turnId: TurnId.make("turn-1"),
    createdAt,
    payload: type === "turn.completed" ? { state: "completed" } : {},
  }) as ProviderRuntimeEvent;

describe("RemoteSessionRegistry", () => {
  it.effect("seeds live sessions from persisted bindings with the last reconciled boot", () =>
    Effect.gen(function* () {
      const rows = yield* ProviderSessionRuntime.ProviderSessionRuntimeRepository;
      yield* rows.upsert({
        threadId,
        providerName: provider,
        providerInstanceId: instanceId,
        adapterKey: provider,
        runtimeMode: "full-access",
        status: "running",
        lastSeenAt: "2026-09-25T00:00:00.000Z",
        resumeCursor: { resume: "session-1" },
        runtimePayload: { cwd: "/workspace/t/thread-registry", activeTurnId: "turn-1" },
      });
      yield* rows.upsert({
        threadId: ThreadId.make("thread-stopped"),
        providerName: provider,
        providerInstanceId: instanceId,
        adapterKey: provider,
        runtimeMode: "full-access",
        status: "stopped",
        lastSeenAt: "2026-09-25T00:00:00.000Z",
        resumeCursor: null,
        runtimePayload: null,
      });
      yield* (yield* RunnerCursorStore).saveAll([
        { threadId, outboxId: "runner-1", bootId: "boot-7", ackedSequence: 3, updatedAt: "t" },
      ]);

      const registry = yield* makeRegistry;
      const records = yield* registry.list;
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        threadId,
        instanceId,
        bootId: "boot-7",
        session: {
          status: "running",
          cwd: "/workspace/t/thread-registry",
          activeTurnId: "turn-1",
          resumeCursor: { resume: "session-1" },
        },
      });
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("tracks turns and ignores the exit of a session that was already replaced", () =>
    Effect.gen(function* () {
      const registry = yield* makeRegistry;
      yield* registry.upsert({
        threadId,
        instanceId,
        provider,
        bootId: "boot-1",
        session: {
          provider,
          providerInstanceId: instanceId,
          status: "ready",
          runtimeMode: "full-access",
          threadId,
          createdAt: "2026-09-25T00:00:10.000Z",
          updatedAt: "2026-09-25T00:00:10.000Z",
        },
      });
      yield* registry.applyEvent(lifecycleEvent("turn.started", "2026-09-25T00:00:11.000Z"));
      expect(Option.getOrThrow(yield* registry.get(threadId)).session).toMatchObject({
        status: "running",
        activeTurnId: "turn-1",
      });
      yield* registry.applyEvent(lifecycleEvent("turn.completed", "2026-09-25T00:00:12.000Z"));
      const settled = Option.getOrThrow(yield* registry.get(threadId)).session;
      expect(settled.status).toBe("ready");
      expect(settled.activeTurnId).toBeUndefined();

      // The previous session's exit, emitted before this session started.
      yield* registry.applyEvent(lifecycleEvent("session.exited", "2026-09-25T00:00:09.000Z"));
      expect(Option.isSome(yield* registry.get(threadId))).toBe(true);
      yield* registry.applyEvent(lifecycleEvent("session.exited", "2026-09-25T00:00:13.000Z"));
      expect(Option.isNone(yield* registry.get(threadId))).toBe(true);
    }).pipe(Effect.provide(TestLayer)),
  );
});
