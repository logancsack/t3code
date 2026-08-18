import { CommandId, EventId, ThreadId, type OrchestrationEvent } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { describe, expect, it } from "vite-plus/test";

import {
  isBootstrapCleanupDeletion,
  logCleanupCauseUnlessInterrupted,
} from "./ThreadDeletionReactor.ts";

describe("logCleanupCauseUnlessInterrupted", () => {
  const threadId = ThreadId.make("thread-deletion-reactor-test");

  it("swallows ordinary cleanup failures", async () => {
    const exit = await Effect.runPromiseExit(
      logCleanupCauseUnlessInterrupted({
        effect: Effect.fail("cleanup failed"),
        message: "thread deletion cleanup skipped provider session stop",
        threadId,
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("preserves interrupt causes", async () => {
    const exit = await Effect.runPromiseExit(
      logCleanupCauseUnlessInterrupted({
        effect: Effect.interrupt,
        message: "thread deletion cleanup skipped provider session stop",
        threadId,
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
  });
});

describe("isBootstrapCleanupDeletion", () => {
  const makeDeletion = (
    commandId: string,
  ): Extract<OrchestrationEvent, { type: "thread.deleted" }> => ({
    sequence: 1,
    eventId: EventId.make(`event-${commandId}`),
    type: "thread.deleted",
    aggregateKind: "thread",
    aggregateId: ThreadId.make("thread-bootstrap-cleanup"),
    occurredAt: "2026-08-18T00:00:00.000Z",
    commandId: CommandId.make(commandId),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: {
      threadId: ThreadId.make("thread-bootstrap-cleanup"),
      deletedAt: "2026-08-18T00:00:00.000Z",
    },
  });

  it("skips only server bootstrap cleanup deletions", () => {
    expect(isBootstrapCleanupDeletion(makeDeletion("server:bootstrap-thread-delete:retry"))).toBe(
      true,
    );
    expect(isBootstrapCleanupDeletion(makeDeletion("client-delete"))).toBe(false);
  });
});
