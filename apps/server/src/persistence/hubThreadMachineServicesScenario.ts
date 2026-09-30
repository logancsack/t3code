/**
 * One scenario over the stores behind the hub's thread-machine services
 * (migration 051 on Postgres, first-use tables on SQLite): machine states,
 * provider snapshots, and MCP credentials. Shared by the SQLite and Postgres
 * store tests so both implementations answer identically.
 *
 * @module hubThreadMachineServicesScenario
 */
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import {
  McpCredentialStore,
  ProviderSnapshotStore,
  ThreadMachineStatusStore,
} from "./Services/HubThreadMachineState.ts";

const snapshot = (label: string): ServerProvider => ({
  instanceId: ProviderInstanceId.make("claudeAgent"),
  driver: ProviderDriverKind.make("claudeAgent"),
  enabled: true,
  installed: true,
  version: label,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-09-26T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
});

/** Writes one row of each kind labelled `label`. */
export const writeThreadMachineServices = (label: string) =>
  Effect.gen(function* () {
    const threadId = ThreadId.make("thread-services");
    const states = yield* ThreadMachineStatusStore;
    yield* states.put({
      threadId,
      state: "starting",
      detail: `starting ${label}`,
      bootId: null,
      updatedAt: "t1",
    });
    yield* states.put({
      threadId,
      state: "running",
      detail: null,
      bootId: `boot-${label}`,
      updatedAt: "t2",
    });
    yield* (yield* ProviderSnapshotStore).put({
      instanceId: ProviderInstanceId.make("claudeAgent"),
      snapshot: snapshot(label),
      updatedAt: "t2",
    });
    const credentials = yield* McpCredentialStore;
    for (const token of ["a", "b"]) {
      yield* credentials.put({
        tokenHash: `${label}-${token}`,
        environmentId: "env",
        threadId,
        providerSessionId: `session-${token}`,
        providerInstanceId: "claudeAgent",
        capabilities: ["preview", "review"],
        issuedAt: 1_700_000_000_000,
        lastAliveAt: 1_700_000_000_000,
      });
    }
    yield* credentials.touch([`${label}-a`], 1_700_000_600_000);
    yield* credentials.remove([`${label}-b`]);
  });

/** What `writeThreadMachineServices(label)` left, as plain values. */
export const readThreadMachineServices = Effect.gen(function* () {
  const states = yield* (yield* ThreadMachineStatusStore).list();
  const snapshots = yield* (yield* ProviderSnapshotStore).list();
  const credentials = yield* (yield* McpCredentialStore).list();
  return {
    states: states.map((row) => [row.threadId, row.state, row.bootId]),
    snapshots: snapshots.map((row) => [row.instanceId, row.snapshot.version]),
    credentials: credentials.map((row) => [
      row.tokenHash,
      row.capabilities,
      row.issuedAt,
      row.lastAliveAt,
    ]),
  };
});

export const expectedThreadMachineServices = (label: string) => ({
  states: [["thread-services", "running", `boot-${label}`]],
  snapshots: [["claudeAgent", label]],
  credentials: [[`${label}-a`, ["preview", "review"], 1_700_000_000_000, 1_700_000_600_000]],
});
